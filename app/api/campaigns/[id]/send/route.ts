/**
 * POST /api/campaigns/[id]/send
 * API Campaign endpoint — send a single WhatsApp template message.
 *
 * AiSensy-compatible body:
 * {
 *   "apiKey": "<bearer-token>",          // alternative to Authorization header
 *   "destination": "919876543210",
 *   "templateParams": ["John"],           // positional variables (index 1, 2, …)
 *   "paramsFallbackValue": { "FirstName": "user" },
 *   "userName": "My Brand",              // optional, stored for reference
 *   "source": "landing-page",            // optional
 *   "media": {}, "buttons": [], ...      // ignored — template config comes from DB
 * }
 *
 * Legacy body (still supported):
 * { phone: "919876543210", variables?: { "1": "John" } }
 *
 * BULK mode — same URL, pass a "messages" array instead of a single destination:
 * {
 *   "apiKey": "ws_...",
 *   "media": { "url": "https://example.com/offer.jpg" },   // optional — default header media for the whole batch
 *   "messages": [
 *     { "destination": "919876543210", "templateParams": ["John"] },
 *     { "destination": "919876543211", "templateParams": ["Priya"],
 *       "media": { "id": "123456789" } }                    // optional — per-message override (uploaded media id)
 *   ]
 * }
 * Media omitted → campaign's saved header media (or template default) is used.
 * Rows are queued as pending campaign_contacts and sent by the campaign-process
 * cron in parallel batches — one request queues up to 5000 messages.
 */
import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { query, execute, insert } from '@/lib/db';
import { apiSuccess, apiError, normalizePhone, utcNow } from '@/lib/utils';
import { sendTemplateMessage } from '@/lib/whatsapp';
import { resolveCampaignId } from '@/lib/resolveCampaign';
import { RowDataPacket } from 'mysql2';

const MAX_BULK_MESSAGES = 5000;
const INSERT_CHUNK      = 500;

interface BulkMedia { id?: string; url?: string; link?: string }

interface BulkRow {
  destination?:    string;
  phone?:          string;
  templateParams?: string[];
  variables?:      Record<string, string>;
  contactName?:    string;
  media?:          BulkMedia;   // per-message header media override
}

/** "media_id:<id>" or a direct URL — the format buildComponents understands */
function mediaToHeaderContent(media?: BulkMedia): string {
  if (!media) return '';
  if (media.id) return `media_id:${media.id}`;
  return media.url || media.link || '';
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    // Support apiKey in body as alternative to Authorization header
    let payload: Awaited<ReturnType<typeof requireAuth>>;
    let rawBody: Record<string, unknown>;
    try {
      rawBody = await req.clone().json() as Record<string, unknown>;
    } catch {
      rawBody = {};
    }

    const incomingKey = rawBody.apiKey as string | undefined;
    if (incomingKey?.startsWith('ws_')) {
      // Permanent workspace API key
      const wsRows = await query<RowDataPacket[]>(
        'SELECT id, owner_id FROM workspaces WHERE api_key = ? AND is_active = 1 LIMIT 1',
        [incomingKey]
      );
      if (wsRows.length === 0) return apiError('Invalid API key', 401);
      payload = {
        userId:      wsRows[0].owner_id as number,
        email:       '',
        role:        'admin',
        workspaceId: wsRows[0].id as number,
      };
    } else if (incomingKey) {
      // Legacy JWT token
      const syntheticReq = new Request(req.url, {
        method:  req.method,
        headers: { ...Object.fromEntries(req.headers), authorization: `Bearer ${incomingKey}` },
        body:    JSON.stringify(rawBody),
      });
      payload = await requireAuth(syntheticReq as unknown as NextRequest);
    } else {
      payload = await requireAuth(req);
    }

    // Accept a numeric ID, a legacy encrypted token, or the campaign NAME
    const campaignId = await resolveCampaignId(params.id, payload.workspaceId);
    if (!campaignId) return apiError('Campaign not found — use the campaign name (URL-encoded) or its ID in the URL', 404);

    // ── Load campaign + template ─────────────────────────────
    const rows = await query<RowDataPacket[]>(
      `SELECT c.*, t.name as template_name, t.language,
              t.body_text, t.header_type, t.header_content, t.footer_text, t.buttons,
              w.access_token, w.phone_number_id
       FROM campaigns c
       JOIN templates t  ON t.id = c.template_id
       JOIN workspaces w ON w.id = c.workspace_id
       WHERE c.id = ? AND c.workspace_id = ? AND c.campaign_type = 'api'`,
      [campaignId, payload.workspaceId]
    );

    if (rows.length === 0) return apiError('API campaign not found', 404);

    const campaign = rows[0];

    if (campaign.status === 'paused') {
      return apiError('Campaign is inactive — activate it before sending messages', 403);
    }

    const accessToken   = (campaign.access_token   as string) || process.env.WHATSAPP_ACCESS_TOKEN || '';
    const phoneNumberId = (campaign.phone_number_id as string) || process.env.PHONE_NUMBER_ID      || '';

    if (!accessToken || !phoneNumberId) return apiError('WhatsApp credentials not configured', 400);

    // ── BULK mode: "messages" array → queue for cron, no per-message HTTP ──
    if (Array.isArray(rawBody.messages)) {
      // Top-level "media" acts as the default header media for every message
      // that doesn't carry its own override.
      return queueBulk(
        campaignId, payload.workspaceId,
        rawBody.messages as BulkRow[],
        rawBody.media as BulkMedia | undefined
      );
    }

    // ── Parse request body (AiSensy format + legacy format) ──
    const body = rawBody as {
      // AiSensy-style
      destination?:        string;
      templateParams?:     string[];
      paramsFallbackValue?: Record<string, string>;
      buttonPayloads?:     string[];   // e.g. ["accept_123", "reject_123"]
      // Legacy style
      phone?:              string;
      variables?:          Record<string, string>;
    };

    const rawPhone = body.destination || body.phone;
    if (!rawPhone) return apiError('destination (or phone) is required', 400);

    const normalizedPhone = normalizePhone(rawPhone);
    if (!normalizedPhone) return apiError('Invalid phone number', 400);

    // Build positional variables map { "1": val, "2": val, … }
    let variables: Record<string, string> = body.variables || {};
    if (body.templateParams && body.templateParams.length > 0) {
      variables = {};
      body.templateParams.forEach((v, i) => { variables[String(i + 1)] = v; });
    }

    // Apply fallback values for any variable still equal to its placeholder token
    if (body.paramsFallbackValue) {
      for (const [k, fallback] of Object.entries(body.paramsFallbackValue)) {
        for (const [idx, val] of Object.entries(variables)) {
          if (val === `$${k}` || val === '') variables[idx] = fallback;
        }
      }
    }

    // ── Resolve contact name ──────────────────────────────────
    const explicitName  = (rawBody.contactName as string) || null;
    const firstParam    = body.templateParams?.[0];
    const autoName      = (firstParam && !firstParam.startsWith('$')) ? firstParam : null;
    const contactName   = explicitName || autoName || null;

    // ── Upsert contact in a single round trip (race-condition safe) ─
    // ON DUPLICATE KEY UPDATE id=LAST_INSERT_ID(id) lets us read back the row's id
    // without a separate SELECT, and only fills in name if it was previously empty.
    const contactId = await insert(
      `INSERT INTO contacts (workspace_id, phone, name, source, opted_in)
       VALUES (?, ?, ?, ?, 1)
       ON DUPLICATE KEY UPDATE
         id   = LAST_INSERT_ID(id),
         name = IF(name IS NULL OR name = '', VALUES(name), name)`,
      [payload.workspaceId, normalizedPhone, contactName, 'api_campaign']
    );

    // ── Respect opt-out: never send templates to opted-out contacts ──
    const optRows = await query<RowDataPacket[]>(
      'SELECT opted_in FROM contacts WHERE id = ? LIMIT 1',
      [contactId]
    );
    if (optRows.length > 0 && Number(optRows[0].opted_in) === 0) {
      return apiError('Contact has opted out — message not sent', 403);
    }

    // ── Build template components ────────────────────────────
    const components: object[] = [];
    if (variables && Object.keys(variables).length > 0) {
      const sortedKeys = Object.keys(variables).sort((a, b) => Number(a) - Number(b));
      components.push({
        type: 'body',
        parameters: sortedKeys.map((k) => ({ type: 'text', text: variables[k] })),
      });
    }
    // Button payloads — pass lead_id per button e.g. ["accept_123", "reject_123"]
    if (Array.isArray(body.buttonPayloads) && body.buttonPayloads.length > 0) {
      body.buttonPayloads.forEach((pl, idx) => {
        components.push({
          type: 'button', sub_type: 'quick_reply', index: String(idx),
          parameters: [{ type: 'payload', payload: pl }],
        });
      });
    }

    // ── Send via Meta API ────────────────────────────────────
    const result = await sendTemplateMessage(
      accessToken,
      phoneNumberId,
      normalizedPhone,
      campaign.template_name as string,
      (campaign.language as string) || 'en',
      components,
    );

    const wamid = (result?.messages as Record<string, unknown>[])?.[0]?.id as string | undefined;

    // Build body with variables replaced
    let bodyText = (campaign.body_text as string) || '';
    if (variables && bodyText) {
      for (const [k, v] of Object.entries(variables)) {
        bodyText = bodyText.replace(new RegExp(`\\{\\{${k}\\}\\}`, 'g'), v);
      }
    }

    // Parse buttons
    let buttons: unknown[] = [];
    try { buttons = JSON.parse((campaign.buttons as string) || '[]'); } catch { buttons = []; }

    // Store full template structure as JSON so inbox can render it properly
    const templateContent = JSON.stringify({
      __type:         'template',
      template_name:  campaign.template_name,
      header_type:    campaign.header_type    || 'NONE',
      header_content: campaign.header_content || '',
      body:           bodyText,
      footer:         campaign.footer_text    || '',
      buttons,
      workspace_id:   payload.workspaceId,
    });

    // ── Store message row + bump campaign counters in parallel ─
    // (counter update doesn't depend on the message id, so it doesn't need to wait)
    const t = utcNow();
    const [msgId] = await Promise.all([
      insert(
        `INSERT INTO messages
           (workspace_id, contact_id, wamid, direction, type, content, campaign_id, status, sent_at, created_at)
         VALUES (?, ?, ?, 'outbound', 'template', ?, ?, 'sent', ?, ?)`,
        [payload.workspaceId, contactId, wamid || null, templateContent, campaignId, t, t]
      ),
      execute(
        `UPDATE campaigns
         SET sent_count = sent_count + 1, total_contacts = total_contacts + 1
         WHERE id = ?`,
        [campaignId]
      ),
    ]);

    // ── Add campaign_contacts entry (enables contact list + status tracking) ─
    await insert(
      `INSERT INTO campaign_contacts (campaign_id, contact_id, message_id, status, sent_at)
       VALUES (?, ?, ?, 'sent', ?)
       ON DUPLICATE KEY UPDATE message_id = VALUES(message_id), status = 'sent', sent_at = ?`,
      [campaignId, contactId, msgId, t, t]
    );

    return apiSuccess({ sent: true, phone: normalizedPhone, wamid });

  } catch (err: unknown) {
    if (err instanceof Error && err.message === 'UNAUTHORIZED') return apiError('Unauthorized', 401);
    console.error('[campaign/send]', err);
    return apiError('Failed to send message', 500);
  }
}

/**
 * Bulk path: validate + dedupe rows, bulk-upsert contacts, queue pending
 * campaign_contacts with per-row variables, mark the campaign running.
 * The campaign-process cron then sends everything in parallel batches.
 */
async function queueBulk(campaignId: number, workspaceId: number, messages: BulkRow[], defaultMedia?: BulkMedia) {
  if (messages.length === 0) return apiError('messages array is empty', 400);
  if (messages.length > MAX_BULK_MESSAGES) {
    return apiError(`Too many messages — max ${MAX_BULK_MESSAGES} per request`, 400);
  }

  // ── Validate + dedupe rows (last occurrence of a phone wins) ─
  const rowsByPhone = new Map<string, { phone: string; name: string | null; vars: Record<string, string> }>();
  const invalid: string[] = [];
  for (const m of messages) {
    const rawPhone = m.destination || m.phone;
    const phone = rawPhone ? normalizePhone(rawPhone) : null;
    if (!phone) { invalid.push(String(rawPhone || '')); continue; }

    let vars: Record<string, string> = m.variables || {};
    if (m.templateParams && m.templateParams.length > 0) {
      vars = {};
      m.templateParams.forEach((v, i) => { vars[String(i + 1)] = v; });
    }
    // Header media override travels with the row as _header_media (send-time
    // priority: this → campaign's saved media → template default). Internal
    // key — never leaks into body params (buildComponents filters non-numeric).
    const headerMedia = mediaToHeaderContent(m.media) || mediaToHeaderContent(defaultMedia);
    if (headerMedia) vars._header_media = headerMedia;
    const firstParam = m.templateParams?.[0];
    const autoName   = (firstParam && !firstParam.startsWith('$')) ? firstParam : null;
    rowsByPhone.set(phone, { phone, name: m.contactName || autoName || null, vars });
  }

  const rows = Array.from(rowsByPhone.values());
  if (rows.length === 0) return apiError('No valid phone numbers in messages', 400);

  // ── Bulk upsert contacts, then map phone → id ────────────
  for (let i = 0; i < rows.length; i += INSERT_CHUNK) {
    const chunk = rows.slice(i, i + INSERT_CHUNK);
    await execute(
      `INSERT INTO contacts (workspace_id, phone, name, source, opted_in)
       VALUES ${chunk.map(() => '(?, ?, ?, ?, 1)').join(',')}
       ON DUPLICATE KEY UPDATE
         name = IF(name IS NULL OR name = '', VALUES(name), name)`,
      chunk.flatMap((r) => [workspaceId, r.phone, r.name, 'api_campaign'])
    );
  }

  const phones = rows.map((r) => r.phone);
  const contactIdByPhone = new Map<string, number>();
  for (let i = 0; i < phones.length; i += INSERT_CHUNK) {
    const chunk = phones.slice(i, i + INSERT_CHUNK);
    const found = await query<RowDataPacket[]>(
      `SELECT id, phone FROM contacts
       WHERE workspace_id = ? AND phone IN (${chunk.map(() => '?').join(',')})`,
      [workspaceId, ...chunk]
    );
    for (const c of found) contactIdByPhone.set(c.phone as string, c.id as number);
  }

  // ── Bulk queue campaign_contacts with per-row variables ──
  // API campaigns are reusable pipes — re-submitting a phone ALWAYS re-queues
  // it, even if it was sent before (recurring reminders to the same list is
  // the whole point). Previous per-row status/error is overwritten; historical
  // send counters on the campaign row survive.
  let queued = 0;
  const now = utcNow();
  for (let i = 0; i < rows.length; i += INSERT_CHUNK) {
    const chunk = rows.slice(i, i + INSERT_CHUNK).filter((r) => contactIdByPhone.has(r.phone));
    if (chunk.length === 0) continue;
    await execute(
      `INSERT INTO campaign_contacts (campaign_id, contact_id, status, variables)
       VALUES ${chunk.map(() => "(?, ?, 'pending', ?)").join(',')}
       ON DUPLICATE KEY UPDATE
         variables = VALUES(variables),
         status    = 'pending',
         error     = NULL,
         sent_at   = NULL`,
      chunk.flatMap((r) => [campaignId, contactIdByPhone.get(r.phone), JSON.stringify(r.vars)])
    );
    queued += chunk.length;
  }

  // ── Mark campaign running so the cron picks it up ────────
  const pendingRows = await query<RowDataPacket[]>(
    `SELECT COUNT(*) as cnt FROM campaign_contacts WHERE campaign_id = ? AND status = 'pending'`,
    [campaignId]
  );
  const pending = Number(pendingRows[0]?.cnt || 0);

  await execute(
    `UPDATE campaigns
     SET status = 'running',
         started_at = COALESCE(started_at, ?),
         total_contacts = (SELECT COUNT(*) FROM campaign_contacts WHERE campaign_id = ?)
     WHERE id = ?`,
    [now, campaignId, campaignId]
  );

  return apiSuccess({
    queued,
    pending,
    invalid: invalid.length,
    message: `${pending} messages queued — sending starts within a minute`,
  });
}
