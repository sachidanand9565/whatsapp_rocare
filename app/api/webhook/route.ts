/**
 * GET  /api/webhook  — Meta webhook verification
 * POST /api/webhook  — Receive incoming messages & status updates
 */
import { NextRequest, NextResponse } from 'next/server';
import { query, insert, execute } from '@/lib/db';
import { parseWebhookBody, markAsRead, callAction, sendTemplateMessage, TemplateStatusUpdate, IncomingCall } from '@/lib/whatsapp';
import { normalizePhone, utcNow, unixToUtc } from '@/lib/utils';
import { RowDataPacket } from 'mysql2';
import { emitSSE } from '@/lib/sse';
import { enqueueFlowJob } from '@/lib/queue';

// ---- GET: Verify webhook with Meta ----
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const mode      = searchParams.get('hub.mode');
  const token     = searchParams.get('hub.verify_token');
  const challenge = searchParams.get('hub.challenge');

  if (mode !== 'subscribe' || !token || !challenge) {
    return new NextResponse('Forbidden', { status: 403 });
  }

  // 1️⃣ Check ENV variable first (works without DB)
  const envToken = process.env.VERIFY_TOKEN;
  if (envToken && token === envToken) {
    return new NextResponse(challenge, { status: 200 });
  }

  // 2️⃣ Fallback: check DB for multi-tenant workspaces
  try {
    const ws = await query<RowDataPacket[]>(
      'SELECT id FROM workspaces WHERE verify_token = ? AND is_active = 1 LIMIT 1',
      [token]
    );
    if (ws.length > 0) {
      return new NextResponse(challenge, { status: 200 });
    }
  } catch {
    // DB not available — already checked ENV above
  }

  return new NextResponse('Forbidden', { status: 403 });
}

// ---- POST: Handle incoming messages ----
export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return new NextResponse('Bad Request', { status: 400 });
  }

  // Identify workspace by phoneNumberId
  const {
    messages, statuses, phoneNumberId, wabaId, profileNames, templateStatusUpdates, calls, echoes,
    syncedContacts, historyMessages, historyProgress,
  } = parseWebhookBody(body);

  let workspaceId: number | null = null;
  let workspaceAccessToken = '';
  let workspaceApiKey = '';
  let workspacePhone = '';   // business number digits — used to orient coexistence history
  let activeWebhooks: { url: string; secret: string | null }[] = [];
  if (phoneNumberId) {
    const ws = await query<RowDataPacket[]>(
      'SELECT id, access_token, api_key, phone_display FROM workspaces WHERE phone_number_id = ? AND is_active = 1 LIMIT 1',
      [phoneNumberId]
    );
    if (ws.length > 0) {
      workspaceId = ws[0].id as number;
      workspaceAccessToken = ws[0].access_token as string || '';
      workspaceApiKey = (ws[0].api_key as string) || '';
      workspacePhone = String(ws[0].phone_display || '').replace(/\D/g, '');
      // Fetch all active custom webhooks for this workspace
      try {
        const hooks = await query<RowDataPacket[]>(
          'SELECT url, secret FROM chatbot_webhooks WHERE workspace_id = ? AND is_active = 1',
          [workspaceId]
        );
        activeWebhooks = hooks.map((h) => ({ url: h.url as string, secret: h.secret as string | null }));
      } catch { /* table may not exist yet */ }
    }
  }

  // Base URL of this deployment (for building media_url links in webhook payloads)
  const fwdProto = req.headers.get('x-forwarded-proto') || 'https';
  const fwdHost  = req.headers.get('x-forwarded-host') || req.headers.get('host') || '';
  const baseUrl  = fwdHost ? `${fwdProto}://${fwdHost}` : '';

  // Log raw payload — fire-and-forget so it doesn't delay the flow reply
  void insert(
    'INSERT INTO webhook_logs (workspace_id, event_type, payload) VALUES (?, ?, ?)',
    [workspaceId, 'webhook', JSON.stringify(body)]
  ).catch(() => {});

  if (!workspaceId) return NextResponse.json({ received: true });

  // ---- Process inbound messages ----
  for (const msg of messages) {
    // Cheap dedup check first (indexed point lookup on the unique wamid column).
    // Meta retries webhook delivery on slow/timeout responses, so the same message
    // can arrive multiple times; without this, every retry redid the full contact
    // upsert + lead-creation + opt-in pipeline below only to have the eventual
    // message INSERT IGNORE be a no-op anyway.
    if (msg.wamid) {
      const dup = await query<RowDataPacket[]>('SELECT 1 FROM messages WHERE wamid = ? LIMIT 1', [msg.wamid]);
      if (dup.length > 0) continue;
    }

    const phone       = normalizePhone(msg.from);
    const profileName = profileNames[msg.from] || profileNames[phone] || null;

    let contactId: number;
    // INSERT IGNORE is race-condition safe against concurrent campaign sends
    await execute(
      'INSERT IGNORE INTO contacts (workspace_id, phone, name, source, opted_in) VALUES (?, ?, ?, ?, 1)',
      [workspaceId, phone, profileName || null, 'inbound']
    );
    // Re-query to get the actual id (whether just inserted or already existed)
    const contactRow = await query<RowDataPacket[]>(
      'SELECT id, name FROM contacts WHERE workspace_id = ? AND phone = ? LIMIT 1',
      [workspaceId, phone]
    );
    contactId = contactRow[0].id as number;

    if (profileName && !contactRow[0].name) {
      await execute(
        "UPDATE contacts SET name = ? WHERE id = ? AND (name IS NULL OR name = '')",
        [profileName, contactId]
      );
    }
    // If resolved contact messages again → reopen to active inbox
    await execute(
      "UPDATE contacts SET chat_status = 'open', intervened_by = NULL WHERE id = ? AND chat_status = 'resolved'",
      [contactId]
    );

    // Auto-create lead if this phone doesn't already have one for this workspace
    try {
      const existingLead = await query<RowDataPacket[]>(
        'SELECT id FROM leads WHERE workspace_id = ? AND phone = ? LIMIT 1',
        [workspaceId, phone]
      );
      if (existingLead.length === 0) {
        const leadName = profileName || contactRow[0].name || null;
        const now = utcNow();
        const leadId = await insert(
          `INSERT INTO leads (workspace_id, contact_id, name, phone, source, stage, created_at, updated_at)
           VALUES (?, ?, ?, ?, 'whatsapp', 'new', ?, ?)`,
          [workspaceId, contactId, leadName, phone, now, now]
        );
        await insert(
          `INSERT INTO lead_activities (lead_id, type, description, done_by, created_at) VALUES (?, ?, ?, ?, ?)`,
          [leadId, 'message', 'Lead auto-created from WhatsApp message', null, utcNow()]
        );
      }
    } catch { /* never fail webhook on lead error */ }

    // Auto opt-out: if user sends STOP/UNSUBSCRIBE → mark opted_in = 0
    if (msg.type === 'text' && msg.text) {
      const lower = msg.text.trim().toLowerCase();
      const optOutWords = ['stop'];
      const optInWords  = ['start', 'subscribe', 'opt in', 'optin', 'yes'];
      if (optOutWords.some((w) => lower === w || lower.startsWith(w + ' '))) {
        await execute('UPDATE contacts SET opted_in = 0 WHERE id = ?', [contactId]);
      } else if (optInWords.some((w) => lower === w || lower.startsWith(w + ' '))) {
        await execute('UPDATE contacts SET opted_in = 1 WHERE id = ?', [contactId]);
      }
    }

    // Extract readable content based on message type
    let content = '';
    let mediaId = '';           // set for media types — used to build media_url for webhooks
    let mediaMime = '';
    let mediaCaption = '';
    let mediaFilename = '';
    if (msg.type === 'text')     content = msg.text || '';
    else if (msg.type === 'button') content = msg.button?.text || msg.button?.payload || 'Button reply';
    else if (msg.type === 'image') {
      const d = msg.image as Record<string, unknown> | undefined;
      mediaId = String(d?.id || ''); mediaMime = String(d?.mime_type || ''); mediaCaption = String(d?.caption || '');
      content = JSON.stringify({ __type: 'media', media_id: d?.id, mime_type: d?.mime_type, caption: d?.caption, workspace_id: workspaceId });
    } else if (msg.type === 'audio') {
      const d = msg.audio as Record<string, unknown> | undefined;
      mediaId = String(d?.id || ''); mediaMime = String(d?.mime_type || '');
      content = JSON.stringify({ __type: 'media', media_id: d?.id, mime_type: d?.mime_type, workspace_id: workspaceId });
    } else if (msg.type === 'video') {
      const d = msg.video as Record<string, unknown> | undefined;
      mediaId = String(d?.id || ''); mediaMime = String(d?.mime_type || ''); mediaCaption = String(d?.caption || '');
      content = JSON.stringify({ __type: 'media', media_id: d?.id, mime_type: d?.mime_type, caption: d?.caption, workspace_id: workspaceId });
    } else if (msg.type === 'document') {
      const d = msg.document as Record<string, unknown> | undefined;
      mediaId = String(d?.id || ''); mediaMime = String(d?.mime_type || ''); mediaCaption = String(d?.caption || ''); mediaFilename = String(d?.filename || '');
      content = JSON.stringify({ __type: 'media', media_id: d?.id, mime_type: d?.mime_type, filename: d?.filename, caption: d?.caption, workspace_id: workspaceId });
    } else if (msg.type === 'sticker') {
      const d = msg.sticker as Record<string, unknown> | undefined;
      mediaId = String(d?.id || ''); mediaMime = String(d?.mime_type || 'image/webp');
      content = JSON.stringify({ __type: 'media', media_id: d?.id, mime_type: d?.mime_type || 'image/webp', workspace_id: workspaceId });
    } else if (msg.type === 'location') {
      const d = msg.location as Record<string, unknown> | undefined;
      content = JSON.stringify({ __type: 'location', latitude: d?.latitude, longitude: d?.longitude, name: d?.name, address: d?.address });
    } else if (msg.type === 'contacts') {
      const list = msg.contacts as Record<string, unknown>[] | undefined;
      content = JSON.stringify({ __type: 'contacts', contacts: list });
    } else if (msg.type === 'interactive') content = msg.interactiveReply?.title || '📋 Interactive reply';
    else if (msg.type === 'unsupported') {
      // Meta sends type:"unsupported" (code 131051 is a generic catch-all) when the
      // recipient's WhatsApp client sent back something the Cloud API webhook schema
      // doesn't recognize — e.g. tapping a template button/quick-reply on an older
      // WhatsApp app version, a poll, view-once media, etc. Meta does not include the
      // real content in these cases, so there is nothing to recover or render.
      content = '⚠️ Received a message type WhatsApp could not deliver details for (often a button tap or unsupported content on the sender\'s app). No content was provided by WhatsApp.';
    }
    else content = `⚠️ Unsupported message type: ${msg.type}`;

    // Store message (try with replied_to_wamid, fallback without)
    const msgSentAt = unixToUtc(msg.timestamp);
    const msgNow    = utcNow();
    let insertedId = 0;
    try {
      insertedId = await insert(
        `INSERT IGNORE INTO messages
           (workspace_id, contact_id, wamid, replied_to_wamid, direction, type, content, status, sent_at, created_at)
         VALUES (?, ?, ?, ?, 'inbound', ?, ?, 'delivered', ?, ?)`,
        [workspaceId, contactId, msg.wamid, msg.replied_to_wamid || null, msg.type, content, msgSentAt, msgNow]
      );
    } catch {
      // fallback: insert without replied_to_wamid (column may not exist yet)
      insertedId = await insert(
        `INSERT IGNORE INTO messages
           (workspace_id, contact_id, wamid, direction, type, content, status, sent_at, created_at)
         VALUES (?, ?, ?, 'inbound', ?, ?, 'delivered', ?, ?)`,
        [workspaceId, contactId, msg.wamid, msg.type, content, msgSentAt, msgNow]
      );
    }

    // ── De-duplication ──────────────────────────────────────────
    // INSERT IGNORE returns 0 for a duplicate wamid. Meta RETRIES webhook delivery
    // (esp. when a reply is slow), so the same button/list reply can arrive multiple
    // times. Without this guard the flow advances repeatedly → duplicate lists / repeated
    // steps. Process each message exactly once.
    if (msg.wamid && !insertedId) continue;

    // Denormalized last-activity (powers fast Inbox/History list ordering & filtering)
    await execute(
      'UPDATE contacts SET last_message_at = ?, last_inbound_at = ? WHERE id = ?',
      [msgNow, msgNow, contactId]
    ).catch(() => {});

    // Notify connected inbox clients instantly via SSE
    emitSSE({ type: 'new_message', workspaceId, contactId, direction: 'inbound' });

    // Auto read receipt when chatbot webhook is active (bot will reply, not a human agent)
    if (activeWebhooks.length > 0 && workspaceAccessToken && phoneNumberId && msg.wamid) {
      markAsRead(workspaceAccessToken, phoneNumberId, msg.wamid).catch(() => {});
    }

    // ---- CRM Integration: fire on template button reply ----
    if (msg.type === 'button' && msg.button?.payload && msg.replied_to_wamid && workspaceId) {
      fireCrmIntegration(workspaceId, msg.replied_to_wamid, msg.button, contactId, phone).catch(() => {});
    }

    // ---- Forward to all active custom chatbot webhooks (non-blocking) ----
    if (activeWebhooks.length > 0) {
      // If user replied to a template button, fetch original template content from DB
      let repliedTemplate: Record<string, unknown> | null = null;
      if (msg.type === 'button' && msg.replied_to_wamid) {
        try {
          const origRows = await query<RowDataPacket[]>(
            `SELECT content, type FROM messages
             WHERE wamid = ? AND workspace_id = ? LIMIT 1`,
            [msg.replied_to_wamid, workspaceId]
          );
          if (origRows.length > 0 && origRows[0].type === 'template') {
            const parsed = JSON.parse(origRows[0].content as string);
            if (parsed?.__type === 'template') {
              repliedTemplate = {
                template_name:  parsed.template_name,
                header_type:    parsed.header_type,
                header_content: parsed.header_content,
                body:           parsed.body,
                footer:         parsed.footer,
                buttons:        parsed.buttons,
              };
            }
          }
        } catch { /* ignore parse errors */ }
      }

      const fwdPayload = {
        event:        'message.received',
        workspace_id: workspaceId,
        contact:      { id: contactId, phone, name: profileName || null },
        message: {
          wamid:            msg.wamid,
          type:             msg.type,
          content,
          ...(mediaId
            ? {
                media_id:  mediaId,
                mime_type: mediaMime || null,
                ...(mediaCaption  ? { caption: mediaCaption }   : {}),
                ...(mediaFilename ? { filename: mediaFilename } : {}),
                ...(baseUrl && workspaceApiKey
                  ? { media_url: `${baseUrl}/api/media/${mediaId}?workspaceId=${workspaceId}&key=${workspaceApiKey}` }
                  : {}),
              }
            : {}),
          ...(msg.type === 'button' && msg.button
            ? {
                button_text:    msg.button.text,
                button_payload: msg.button.payload,
              }
            : {}),
          timestamp:        msg.timestamp,
          replied_to_wamid: msg.replied_to_wamid || null,
          ...(repliedTemplate ? { replied_template: repliedTemplate } : {}),
        },
      };
      for (const hook of activeWebhooks) {
        forwardToCustomWebhook(hook.url, hook.secret, fwdPayload);
      }
    }

    // ---- Flow Engine / Chatbot: handed off to the Flow Worker (workers/flow-worker.ts) ----
    // These previously ran inline here and called Meta's Send API synchronously,
    // which risked delaying the webhook response past Meta's retry timeout.
    // Handles both text messages and interactive button clicks.
    if (msg.type === 'text' && msg.text) {
      await enqueueFlowJob({
        workspaceId, contactId, phone,
        userMessage:   msg.text,
        accessToken:   workspaceAccessToken || '',
        phoneNumberId: phoneNumberId || '',
        incomingWamid: msg.wamid,
        msgType:       'text',
      }).catch(() => {});
    } else if (msg.type === 'button' && msg.button) {
      // Template quick reply button clicked
      const buttonText    = msg.button.text    || '';
      const buttonPayload = msg.button.payload || buttonText;
      await enqueueFlowJob({
        workspaceId, contactId, phone,
        userMessage:   buttonText,
        accessToken:   workspaceAccessToken || '',
        phoneNumberId: phoneNumberId || '',
        buttonPayload,
        contextWamid:  msg.replied_to_wamid,
        incomingWamid: msg.wamid,
        msgType:       'button',
      }).catch(() => {});
    } else if (msg.type === 'interactive' && msg.interactiveReply) {
      // Interactive button_message / list_message reply — resume active flow
      const replyTitle = msg.interactiveReply.title || '';
      const replyId    = msg.interactiveReply.id    || replyTitle;
      await enqueueFlowJob({
        workspaceId, contactId, phone,
        userMessage:   replyTitle,
        accessToken:   workspaceAccessToken || '',
        phoneNumberId: phoneNumberId || '',
        buttonPayload: replyId,
        contextWamid:  msg.replied_to_wamid,
        incomingWamid: msg.wamid,
        msgType:       'interactive',
      }).catch(() => {});
    }
  }

  // ---- Coexistence echoes: messages the business sent from the phone's ----
  // ---- WhatsApp Business App — mirror them into the panel as outbound  ----
  for (const echo of echoes) {
    if (!echo.wamid) continue;
    const dup = await query<RowDataPacket[]>('SELECT 1 FROM messages WHERE wamid = ? LIMIT 1', [echo.wamid]);
    if (dup.length > 0) continue;

    const phone = normalizePhone(echo.to);
    if (!phone) continue;

    await execute(
      'INSERT IGNORE INTO contacts (workspace_id, phone, source, opted_in) VALUES (?, ?, ?, 1)',
      [workspaceId, phone, 'inbound']
    );
    const contactRow = await query<RowDataPacket[]>(
      'SELECT id FROM contacts WHERE workspace_id = ? AND phone = ? LIMIT 1',
      [workspaceId, phone]
    );
    if (contactRow.length === 0) continue;
    const contactId = contactRow[0].id as number;

    let content = '';
    if (echo.type === 'text') content = echo.text || '';
    else {
      const media = (echo.image || echo.video || echo.document || echo.audio || echo.sticker) as Record<string, unknown> | undefined;
      if (media) {
        content = JSON.stringify({
          __type: 'media', media_id: media.id, mime_type: media.mime_type,
          caption: media.caption, filename: media.filename, workspace_id: workspaceId,
        });
      } else {
        content = echo.text || `[${echo.type}]`;
      }
    }

    const echoSentAt = unixToUtc(echo.timestamp);
    const echoNow    = utcNow();
    await insert(
      `INSERT IGNORE INTO messages
         (workspace_id, contact_id, wamid, direction, type, content, status, sent_at, created_at)
       VALUES (?, ?, ?, 'outbound', ?, ?, 'sent', ?, ?)`,
      [workspaceId, contactId, echo.wamid, echo.type, content, echoSentAt, echoNow]
    );
    await execute('UPDATE contacts SET last_message_at = ? WHERE id = ?', [echoNow, contactId]).catch(() => {});
    emitSSE({ type: 'new_message', workspaceId, contactId, direction: 'outbound' });
  }

  // ---- Coexistence: contacts synced from the WhatsApp Business App ----
  // (field = smb_app_state_sync — after the onboarding sync request, and again
  // whenever the business edits contacts in the app)
  if (workspaceId && syncedContacts.length > 0) {
    let added = 0;
    for (const c of syncedContacts) {
      const phone = normalizePhone(c.phone);
      if (!phone) continue;
      if (c.action === 'remove') continue; // keep the contact + its chats; app deletion shouldn't wipe panel history
      const name = c.full_name || c.first_name || null;
      await execute(
        `INSERT INTO contacts (workspace_id, phone, name, source, opted_in)
         VALUES (?, ?, ?, 'whatsapp_app', 1)
         ON DUPLICATE KEY UPDATE name = IF(name IS NULL OR name = '' OR name = phone, VALUES(name), name)`,
        [workspaceId, phone, name]
      ).catch(() => {});
      added++;
    }
    console.log(`[coexistence] contacts sync: ${added} contacts upserted for workspace ${workspaceId}`);
  }

  // ---- Coexistence: chat history from the WhatsApp Business App ----
  // (field = history — chunks arrive over minutes after the onboarding sync
  // request; each message is inserted once, keyed by wamid)
  if (workspaceId && historyMessages.length > 0) {
    let inserted = 0;
    for (const h of historyMessages) {
      if (!h.wamid) continue;
      // Business number sent it → outbound; otherwise inbound from the customer
      const fromDigits = String(h.from || '').replace(/\D/g, '');
      const isOutbound = !!workspacePhone && fromDigits === workspacePhone;
      const customer   = normalizePhone(isOutbound ? h.to : h.from);
      if (!customer) continue;

      await execute(
        'INSERT IGNORE INTO contacts (workspace_id, phone, source, opted_in) VALUES (?, ?, ?, 1)',
        [workspaceId, customer, 'whatsapp_app']
      );
      const cRow = await query<RowDataPacket[]>(
        'SELECT id FROM contacts WHERE workspace_id = ? AND phone = ? LIMIT 1',
        [workspaceId, customer]
      );
      if (cRow.length === 0) continue;
      const cId = cRow[0].id as number;

      let content = '';
      if (h.type === 'text') content = h.text || '';
      else {
        const media = (h.image || h.video || h.document || h.audio || h.sticker) as Record<string, unknown> | undefined;
        content = media
          ? JSON.stringify({ __type: 'media', media_id: media.id, mime_type: media.mime_type, caption: media.caption, filename: media.filename, workspace_id: workspaceId })
          : (h.text || `[${h.type}]`);
      }
      const st = (h.status || '').toUpperCase();
      const status = st === 'READ' || st === 'PLAYED' ? 'read'
        : st === 'DELIVERED' ? 'delivered'
        : st === 'ERROR' ? 'failed'
        : isOutbound ? 'sent' : 'delivered';
      const at = unixToUtc(h.timestamp);
      const r = await insert(
        `INSERT IGNORE INTO messages
           (workspace_id, contact_id, wamid, direction, type, content, status, sent_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [workspaceId, cId, h.wamid, isOutbound ? 'outbound' : 'inbound', h.type, content, status, at, at]
      ).catch(() => 0);
      if (r) {
        inserted++;
        // Only move last_message_at forward — history must not override newer live activity
        await execute(
          `UPDATE contacts SET last_message_at = GREATEST(COALESCE(last_message_at, '1970-01-01'), ?),
             last_inbound_at = IF(?, GREATEST(COALESCE(last_inbound_at, '1970-01-01'), ?), last_inbound_at)
           WHERE id = ?`,
          [at, isOutbound ? 0 : 1, at, cId]
        ).catch(() => {});
      }
    }
    console.log(`[coexistence] history chunk phase=${historyProgress?.phase} #${historyProgress?.chunk_order} progress=${historyProgress?.progress}% → ${inserted}/${historyMessages.length} messages inserted (workspace ${workspaceId})`);
    // Refresh inbox lists once per chunk rather than per message
    emitSSE({ type: 'new_message', workspaceId, direction: 'inbound' });
  }

  // ---- WhatsApp Business Calling API events (field = "calls") ----
  // connect   → call is ringing. Phase 1 has no WebRTC softphone, so we notify
  //             the inbox (SSE) and REJECT the call so the customer's phone
  //             doesn't ring into a void; the terminate event then logs it as
  //             a missed call and the auto-callback (if enabled) fires.
  // terminate → final record: COMPLETED (answered, with duration) or FAILED
  //             (missed / rejected / unanswered).
  for (const call of calls) {
    if (!workspaceId) continue;
    const isBusinessInitiated = call.direction === 'BUSINESS_INITIATED';
    // Customer's number is `from` on user-initiated calls, `to` on business-initiated
    const phone = normalizePhone(isBusinessInitiated ? call.to : call.from);
    if (!phone || !call.call_id) continue;

    // Upsert contact (also stores the caller's WhatsApp profile name if new)
    await execute(
      'INSERT IGNORE INTO contacts (workspace_id, phone, name, source, opted_in) VALUES (?, ?, ?, ?, 1)',
      [workspaceId, phone, call.profileName || null, 'inbound']
    );
    const contactRow = await query<RowDataPacket[]>(
      'SELECT id, name FROM contacts WHERE workspace_id = ? AND phone = ? LIMIT 1',
      [workspaceId, phone]
    );
    if (contactRow.length === 0) continue;
    const contactId = contactRow[0].id as number;
    const msgDirection = isBusinessInitiated ? 'outbound' : 'inbound';

    if (call.event === 'connect') {
      // Ringing — tell open inbox tabs right away
      emitSSE({
        type: 'incoming_call', workspaceId, contactId,
        callId: call.call_id, callerPhone: phone,
        callerName: (contactRow[0].name as string) || call.profileName || phone,
      });
      // No softphone yet → reject so it becomes a clean missed call on both ends
      if (!isBusinessInitiated && workspaceAccessToken && phoneNumberId) {
        callAction(workspaceAccessToken, phoneNumberId, call.call_id, 'reject')
          .catch((e) => console.warn('[calls] reject failed:', (e as Error)?.message));
      }
      continue;
    }

    if (call.event === 'terminate') {
      const answered = call.status === 'COMPLETED' && (call.duration || 0) > 0;
      const callContent = JSON.stringify({
        __type:    'call',
        status:    answered ? 'answered' : 'missed',
        call_id:   call.call_id,
        direction: isBusinessInitiated ? 'outbound' : 'inbound',
        duration:  call.duration || 0,
      });
      const callAt = unixToUtc(call.start_time || call.timestamp);
      await insert(
        `INSERT INTO messages
           (workspace_id, contact_id, wamid, direction, type, content, status, sent_at, created_at)
         VALUES (?, ?, ?, ?, 'call', ?, 'delivered', ?, ?)
         ON DUPLICATE KEY UPDATE content = VALUES(content)`,
        [workspaceId, contactId, `call_${call.call_id}`, msgDirection, callContent, callAt, utcNow()]
      );
      await execute(
        'UPDATE contacts SET last_message_at = ?, last_inbound_at = COALESCE(?, last_inbound_at) WHERE id = ?',
        [utcNow(), isBusinessInitiated ? null : utcNow(), contactId]
      ).catch(() => {});
      emitSSE({ type: 'call_ended', workspaceId, contactId, callId: call.call_id });
      emitSSE({ type: 'new_message', workspaceId, contactId, direction: msgDirection });

      // Missed inbound call → optional auto-callback template so the agent
      // can reply even outside the 24h window (configured in Settings → Calling)
      if (!answered && !isBusinessInitiated && workspaceAccessToken && phoneNumberId) {
        sendMissedCallAutoReply(workspaceId, contactId, phone, workspaceAccessToken, phoneNumberId)
          .catch((e) => console.warn('[calls] auto-reply failed:', (e as Error)?.message));
      }
      continue;
    }
  }

  // ---- Process status updates ----
  for (const status of statuses) {
    const now = utcNow();
    const fieldMap: Record<string, string> = {
      sent:      `status = 'sent', sent_at = '${now}'`,
      delivered: `status = 'delivered', delivered_at = '${now}'`,
      read:      `status = 'read', read_at = '${now}'`,
      failed:    "status = 'failed'",
    };
    const update = fieldMap[status.status];
    if (!update) continue;

    await execute(`UPDATE messages SET ${update} WHERE wamid = ?`, [status.wamid]);

    // Query message for contactId (SSE) + optional campaign processing
    const msgRows = await query<RowDataPacket[]>(
      'SELECT id, campaign_id, contact_id FROM messages WHERE wamid = ? LIMIT 1',
      [status.wamid]
    );
    if (msgRows.length > 0) {
      const contactId = msgRows[0].contact_id as number;

      // Push real-time tick update to inbox (delivered ✓✓ / read blue ✓✓)
      emitSSE({ type: 'status_update', workspaceId, contactId, wamid: status.wamid, status: status.status });

      // Update campaign_contacts status + campaign counters
      if (msgRows[0].campaign_id && (status.status === 'delivered' || status.status === 'read' || status.status === 'failed')) {
        const col = `${status.status}_count`;
        const msgId  = msgRows[0].id as number;
        const campId = msgRows[0].campaign_id as number;

        const statusOrder: Record<string, number> = { pending: 0, sent: 1, delivered: 2, read: 3, failed: 4 };
        const newOrder = statusOrder[status.status] ?? 0;

        const affected = await execute(
          `UPDATE campaign_contacts SET status = ?
           WHERE message_id = ? AND (
             FIELD(status, 'pending','sent','delivered','read','failed') < ?
           )`,
          [status.status, msgId, newOrder + 1]
        );

        if (affected > 0) {
          await execute(
            `UPDATE campaigns SET ${col} = ${col} + 1 WHERE id = ?`,
            [campId]
          );
          // Notify campaign detail page to refresh stats
          emitSSE({ type: 'campaign_update', workspaceId, campaignId: campId });
        }

        // Save Meta error detail to campaign_contacts.error
        if (status.status === 'failed') {
          let errText = 'Message delivery failed';
          if (status.errors?.length) {
            const e = status.errors[0] as { code?: number; title?: string; message?: string; error_data?: { details?: string } };
            const title   = e.title   || e.message || '';
            const code    = e.code    ? `(#${e.code})` : '';
            const details = (e as { error_data?: { details?: string } }).error_data?.details || '';
            errText = [title, code].filter(Boolean).join(' ') || details || 'Message delivery failed';
          }
          await execute(
            'UPDATE campaign_contacts SET error = ? WHERE message_id = ?',
            [errText, msgId]
          ).catch(() => {});
        }

        // Fire failed-message webhooks configured for this campaign
        if (status.status === 'failed') {
          fireFailedWebhooks(workspaceId!, campId, contactId, msgRows[0].id as number).catch(() => {});
        }
      }
    }
  }

  // ---- Handle template category changes (UTILITY → MARKETING) ----
  for (const tsu of templateStatusUpdates) {
    if (
      tsu.reason === 'CATEGORY_CHANGE' &&
      tsu.previousCategory.toUpperCase() === 'UTILITY' &&
      tsu.newCategory.toUpperCase() === 'MARKETING'
    ) {
      await handleTemplateCategoryChange(wabaId, tsu);
    }
  }

  return NextResponse.json({ received: true });
}

// ---- Auto-pause campaigns when template moves from UTILITY → MARKETING ----
async function handleTemplateCategoryChange(
  wabaId: string,
  tsu: TemplateStatusUpdate
) {
  if (!wabaId) return;

  const wsRows = await query<RowDataPacket[]>(
    'SELECT id, auto_pause_campaigns FROM workspaces WHERE waba_id = ? AND is_active = 1 LIMIT 1',
    [wabaId]
  );
  if (wsRows.length === 0) return;

  const wsId      = wsRows[0].id as number;
  const autoPause = wsRows[0].auto_pause_campaigns as number;

  // Always sync the category in our templates table
  await execute(
    `UPDATE templates SET category = 'MARKETING'
     WHERE workspace_id = ? AND (meta_template_id = ? OR name = ?)`,
    [wsId, tsu.templateId, tsu.templateName]
  );

  if (!autoPause) return;

  // Pause every running campaign that uses this template
  await execute(
    `UPDATE campaigns c
     JOIN templates t ON t.id = c.template_id
     SET c.status = 'paused'
     WHERE c.workspace_id = ?
       AND c.status = 'running'
       AND (t.meta_template_id = ? OR t.name = ?)`,
    [wsId, tsu.templateId, tsu.templateName]
  );
}

// ---- Forward inbound message to custom webhook URL ----
function forwardToCustomWebhook(
  url: string,
  secret: string | null,
  payload: Record<string, unknown>
) {
  const body = JSON.stringify(payload);
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };

  // Add HMAC-SHA256 signature if secret is configured
  if (secret) {
    try {
      const crypto = require('crypto') as typeof import('crypto');
      const sig = crypto.createHmac('sha256', secret).update(body).digest('hex');
      headers['X-Webhook-Signature'] = `sha256=${sig}`;
    } catch { /**/ }
  }

  // Fire-and-forget — never block inbound processing
  fetch(url, { method: 'POST', headers, body })
    .catch(() => { /* ignore errors */ });
}

// ---- Fire failed-message webhooks for campaign ----
async function fireFailedWebhooks(
  workspaceId: number,
  campaignId:  number,
  contactId:   number,
  messageId:   number,
) {
  const hooks = await query<RowDataPacket[]>(
    `SELECT fw.api_url, fw.api_method, fw.api_headers, c.name AS campaign_name,
            co.phone
     FROM failed_msg_webhooks fw
     JOIN campaigns c  ON c.id  = fw.campaign_id
     JOIN contacts  co ON co.id = ?
     WHERE fw.campaign_id = ? AND fw.workspace_id = ? AND fw.is_active = 1`,
    [contactId, campaignId, workspaceId]
  );
  if (hooks.length === 0) return;

  const payload = JSON.stringify({
    event:         'campaign_message_failed',
    campaign_id:   campaignId,
    campaign_name: hooks[0].campaign_name as string,
    phone:         hooks[0].phone as string,
    contact_id:    contactId,
    message_id:    messageId,
    status:        'failed',
    workspace_id:  workspaceId,
    failed_at:     new Date().toISOString(),
  });

  for (const hook of hooks) {
    try {
      let headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (hook.api_headers) {
        try { headers = { ...headers, ...JSON.parse(hook.api_headers as string) }; } catch { /* ignore */ }
      }
      const method = (hook.api_method as string) || 'POST';
      fetch(hook.api_url as string, {
        method,
        headers,
        body: method === 'GET' ? undefined : payload,
      }).catch(() => {});
    } catch { /* ignore */ }
  }
}

// ---- Missed-call auto-reply (Settings → Calling) ----
// Sends the workspace's configured template after a missed inbound call so the
// agent can follow up even when the 24h window is closed. Throttled to one
// auto-reply per contact per hour so a customer who calls 5 times doesn't get
// 5 templates.
async function sendMissedCallAutoReply(
  workspaceId: number, contactId: number, phone: string,
  accessToken: string, phoneNumberId: string
) {
  const ws = await query<RowDataPacket[]>(
    'SELECT missed_call_template, missed_call_template_lang FROM workspaces WHERE id = ? LIMIT 1',
    [workspaceId]
  ).catch(() => [] as RowDataPacket[]); // columns may not exist before migration
  const tplName = ws[0]?.missed_call_template as string | null;
  if (!tplName) return;
  const tplLang = (ws[0]?.missed_call_template_lang as string) || 'en';

  const recent = await query<RowDataPacket[]>(
    `SELECT id FROM messages
     WHERE workspace_id = ? AND contact_id = ? AND direction = 'outbound' AND type = 'template'
       AND content LIKE ? AND created_at >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL 1 HOUR)
     LIMIT 1`,
    [workspaceId, contactId, `%"template_name":"${tplName}"%`]
  );
  if (recent.length > 0) return;

  const tplRows = await query<RowDataPacket[]>(
    'SELECT body_text, header_type, header_content, footer_text, buttons FROM templates WHERE workspace_id = ? AND name = ? LIMIT 1',
    [workspaceId, tplName]
  );
  const tplDef = tplRows[0];
  const result = await sendTemplateMessage(accessToken, phoneNumberId, phone, tplName, tplLang, []);
  const wamid = (result?.messages as { id?: string }[] | undefined)?.[0]?.id || null;

  let buttons: unknown[] = [];
  try { buttons = JSON.parse((tplDef?.buttons as string) || '[]'); } catch { buttons = []; }
  const content = JSON.stringify({
    __type:         'template',
    template_name:  tplName,
    header_type:    tplDef?.header_type || 'NONE',
    header_content: tplDef?.header_content || '',
    body:           (tplDef?.body_text as string) || `[Template: ${tplName}]`,
    footer:         tplDef?.footer_text || '',
    buttons,
    workspace_id:   workspaceId,
  });
  const t = utcNow();
  await insert(
    `INSERT INTO messages (workspace_id, contact_id, wamid, direction, type, content, status, sent_at, created_at)
     VALUES (?, ?, ?, 'outbound', 'template', ?, 'sent', ?, ?)`,
    [workspaceId, contactId, wamid, content, t, t]
  );
  emitSSE({ type: 'new_message', workspaceId, contactId, direction: 'outbound' });
}

// ---- Fire CRM integration on template button reply ----
async function fireCrmIntegration(
  workspaceId: number,
  repliedToWamid: string,
  button: { text: string; payload: string },
  contactId: number,
  phone: string
) {
  // Find original message content from replied wamid
  const msgRows = await query<RowDataPacket[]>(
    'SELECT content FROM messages WHERE wamid = ? AND workspace_id = ? LIMIT 1',
    [repliedToWamid, workspaceId]
  );
  if (msgRows.length === 0) return;

  let templateName = '';
  let templateContent: Record<string, unknown> | null = null;
  try {
    const parsed = JSON.parse(msgRows[0].content as string);
    templateName = parsed?.template_name || '';
    if (parsed?.__type === 'template') {
      templateContent = {
        template_name:  parsed.template_name,
        header_type:    parsed.header_type,
        header_content: parsed.header_content,
        body:           parsed.body,
        footer:         parsed.footer,
        buttons:        parsed.buttons,
      };
    }
  } catch { return; }
  if (!templateName) return;

  // Get active CRM integrations for this template
  const crms = await query<RowDataPacket[]>(
    'SELECT * FROM crm_integrations WHERE workspace_id = ? AND template_name = ? AND is_active = 1',
    [workspaceId, templateName]
  );
  if (crms.length === 0) return;

  const crmPayload = JSON.stringify({
    event:             'template_button_reply',
    template_name:     templateName,
    button_text:       button.text,
    button_payload:    button.payload,
    contact:           { id: contactId, phone },
    workspace_id:      workspaceId,
    ...(templateContent ? { template: templateContent } : {}),
  });

  for (const crm of crms) {
    try {
      let headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (crm.api_headers) {
        try { headers = { ...headers, ...JSON.parse(crm.api_headers as string) }; } catch { /* ignore bad JSON */ }
      }
      const method = (crm.api_method as string) || 'POST';
      fetch(crm.api_url as string, {
        method,
        headers,
        body: method === 'GET' ? undefined : crmPayload,
      }).catch(() => {});
    } catch { /* ignore */ }
  }
}

// Chatbot rule matching moved to lib/chatbot.ts — now runs in workers/chatbot-worker.ts,
// reached only when the Flow Worker finds no active/matching flow for the message.
