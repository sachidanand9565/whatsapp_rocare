/**
 * GET  /api/webhook  — Meta webhook verification
 * POST /api/webhook  — Receive incoming messages & status updates
 */
import { NextRequest, NextResponse } from 'next/server';
import { query, insert, execute } from '@/lib/db';
import { parseWebhookBody, sendTextMessage, markAsRead, sendTypingIndicator, TemplateStatusUpdate, IncomingCall } from '@/lib/whatsapp';
import { normalizePhone, utcNow, unixToUtc } from '@/lib/utils';
import { RowDataPacket } from 'mysql2';
import { emitSSE } from '@/lib/sse';
import { tryResumeFlow, tryStartFlow } from '@/lib/flow-engine';

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
  const { messages, statuses, phoneNumberId, wabaId, profileNames, templateStatusUpdates, calls } = parseWebhookBody(body);

  let workspaceId: number | null = null;
  let workspaceAccessToken = '';
  let activeWebhooks: { url: string; secret: string | null }[] = [];
  if (phoneNumberId) {
    const ws = await query<RowDataPacket[]>(
      'SELECT id, access_token FROM workspaces WHERE phone_number_id = ? AND is_active = 1 LIMIT 1',
      [phoneNumberId]
    );
    if (ws.length > 0) {
      workspaceId = ws[0].id as number;
      workspaceAccessToken = ws[0].access_token as string || '';
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

  // Log raw payload
  await insert(
    'INSERT INTO webhook_logs (workspace_id, event_type, payload) VALUES (?, ?, ?)',
    [workspaceId, 'webhook', JSON.stringify(body)]
  );

  if (!workspaceId) return NextResponse.json({ received: true });

  // ---- Process inbound messages ----
  for (const msg of messages) {
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
    if (msg.type === 'text')     content = msg.text || '';
    else if (msg.type === 'button') content = msg.button?.text || msg.button?.payload || 'Button reply';
    else if (msg.type === 'image') {
      const d = msg.image as Record<string, unknown> | undefined;
      content = JSON.stringify({ __type: 'media', media_id: d?.id, mime_type: d?.mime_type, caption: d?.caption, workspace_id: workspaceId });
    } else if (msg.type === 'audio') {
      const d = msg.audio as Record<string, unknown> | undefined;
      content = JSON.stringify({ __type: 'media', media_id: d?.id, mime_type: d?.mime_type, workspace_id: workspaceId });
    } else if (msg.type === 'video') {
      const d = msg.video as Record<string, unknown> | undefined;
      content = JSON.stringify({ __type: 'media', media_id: d?.id, mime_type: d?.mime_type, caption: d?.caption, workspace_id: workspaceId });
    } else if (msg.type === 'document') {
      const d = msg.document as Record<string, unknown> | undefined;
      content = JSON.stringify({ __type: 'media', media_id: d?.id, mime_type: d?.mime_type, filename: d?.filename, caption: d?.caption, workspace_id: workspaceId });
    } else if (msg.type === 'sticker') {
      const d = msg.sticker as Record<string, unknown> | undefined;
      content = JSON.stringify({ __type: 'media', media_id: d?.id, mime_type: d?.mime_type || 'image/webp', workspace_id: workspaceId });
    } else if (msg.type === 'location') {
      const d = msg.location as Record<string, unknown> | undefined;
      content = JSON.stringify({ __type: 'location', latitude: d?.latitude, longitude: d?.longitude, name: d?.name, address: d?.address });
    } else if (msg.type === 'contacts') {
      const list = msg.contacts as Record<string, unknown>[] | undefined;
      content = JSON.stringify({ __type: 'contacts', contacts: list });
    } else if (msg.type === 'interactive') content = msg.interactiveReply?.title || '📋 Interactive reply';
    else content = msg.type;

    // Store message (try with replied_to_wamid, fallback without)
    const msgSentAt = unixToUtc(msg.timestamp);
    const msgNow    = utcNow();
    try {
      await insert(
        `INSERT IGNORE INTO messages
           (workspace_id, contact_id, wamid, replied_to_wamid, direction, type, content, status, sent_at, created_at)
         VALUES (?, ?, ?, ?, 'inbound', ?, ?, 'delivered', ?, ?)`,
        [workspaceId, contactId, msg.wamid, msg.replied_to_wamid || null, msg.type, content, msgSentAt, msgNow]
      );
    } catch {
      // fallback: insert without replied_to_wamid (column may not exist yet)
      await insert(
        `INSERT IGNORE INTO messages
           (workspace_id, contact_id, wamid, direction, type, content, status, sent_at, created_at)
         VALUES (?, ?, ?, 'inbound', ?, ?, 'delivered', ?, ?)`,
        [workspaceId, contactId, msg.wamid, msg.type, content, msgSentAt, msgNow]
      );
    }
    
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

    // ---- Flow Engine: resume active session OR start new flow ----
    // Handles both text messages and interactive button clicks
    if (msg.type === 'text' && msg.text) {
      const token   = workspaceAccessToken || '';
      const pnId    = phoneNumberId || '';
      // Show typing indicator to user while chatbot/flow processes
      if (token && pnId && msg.wamid) {
        sendTypingIndicator(token, pnId, msg.wamid).catch(() => {});
      }
      const resumed = await tryResumeFlow(workspaceId, contactId, phone, msg.text, token, pnId).catch(() => false);
      if (!resumed) {
        const started = await tryStartFlow(workspaceId, contactId, phone, msg.text, token, pnId).catch(() => false);
        if (!started) {
          await processChatbot(workspaceId, contactId, msg.text, pnId);
        }
      }
    } else if (msg.type === 'button' && msg.button) {
      // Template quick reply button clicked
      const token         = workspaceAccessToken || '';
      const pnId          = phoneNumberId || '';
      const buttonText    = msg.button.text    || '';
      const buttonPayload = msg.button.payload || buttonText;
      if (token && pnId && msg.wamid) {
        sendTypingIndicator(token, pnId, msg.wamid).catch(() => {});
      }
      await tryResumeFlow(workspaceId, contactId, phone, buttonText, token, pnId, buttonPayload).catch(() => {});
    } else if (msg.type === 'interactive' && msg.interactiveReply) {
      // Interactive button_message / list_message reply — resume active flow
      const token      = workspaceAccessToken || '';
      const pnId       = phoneNumberId || '';
      const replyTitle = msg.interactiveReply.title || '';
      const replyId    = msg.interactiveReply.id    || replyTitle;
      if (token && pnId && msg.wamid) {
        sendTypingIndicator(token, pnId, msg.wamid).catch(() => {});
      }
      await tryResumeFlow(workspaceId, contactId, phone, replyTitle, token, pnId, replyId).catch(() => {});
    }
  }

  // ---- Process incoming WhatsApp calls ----
  for (const call of calls) {
    const phone = normalizePhone(call.from);
    if (!phone || !workspaceId) continue;

    // Upsert contact
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

    const isMissed = call.status === 'missed_call' || call.status === 'missed';
    const callContent = JSON.stringify({
      __type:  'call',
      status:  isMissed ? 'missed' : 'answered',
      call_id: call.call_id,
    });
    const callAt = unixToUtc(call.timestamp);
    await insert(
      `INSERT IGNORE INTO messages
         (workspace_id, contact_id, wamid, direction, type, content, status, sent_at, created_at)
       VALUES (?, ?, ?, 'inbound', 'call', ?, 'delivered', ?, ?)`,
      [workspaceId, contactId, `call_${call.call_id}`, callContent, callAt, utcNow()]
    );
    emitSSE({ type: 'new_message', workspaceId, contactId, direction: 'inbound' });
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

// ---- Chatbot rule matching ----
async function processChatbot(
  workspaceId: number,
  contactId: number,
  text: string,
  phoneNumberId: string
) {
  const rules = await query<RowDataPacket[]>(
    `SELECT cr.*, w.access_token FROM chatbot_rules cr
     JOIN workspaces w ON w.id = cr.workspace_id
     WHERE cr.workspace_id = ? AND cr.is_active = 1
     ORDER BY cr.priority DESC`,
    [workspaceId]
  );

  // Get contact phone for sending reply
  const contacts = await query<RowDataPacket[]>(
    'SELECT phone FROM contacts WHERE id = ?', [contactId]
  );
  if (contacts.length === 0) return;

  const phone       = contacts[0].phone as string;
  const lowerText   = text.toLowerCase().trim();

  for (const rule of rules) {
    const trigger = (rule.trigger_value as string || '').toLowerCase();
    let matched    = false;

    switch (rule.trigger_type) {
      case 'exact':      matched = lowerText === trigger; break;
      case 'keyword':    matched = lowerText.includes(trigger); break;
      case 'contains':   matched = lowerText.includes(trigger); break;
      case 'starts_with': matched = lowerText.startsWith(trigger); break;
      case 'any':        matched = true; break;
    }

    if (matched && rule.response_type === 'text' && rule.response_text) {
      const result = await sendTextMessage(
        rule.access_token as string, phoneNumberId, phone, rule.response_text as string
      );
      const wamid = result?.messages?.[0]?.id;
      if (wamid) {
        const t = utcNow();
        await insert(
          `INSERT INTO messages (workspace_id, contact_id, wamid, direction, type, content, status, sent_at, created_at)
           VALUES (?, ?, ?, 'outbound', 'text', ?, 'sent', ?, ?)`,
          [workspaceId, contactId, wamid, rule.response_text, t, t]
        );
        // Notify inbox clients so chatbot reply shows live (outbound — don't increment badge)
        emitSSE({ type: 'new_message', workspaceId, contactId, direction: 'outbound' });
      }
      break;
    }
  }
}
