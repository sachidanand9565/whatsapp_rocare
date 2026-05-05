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
 */
import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { query, execute, insert } from '@/lib/db';
import { apiSuccess, apiError, normalizePhone, utcNow } from '@/lib/utils';
import { sendTemplateMessage } from '@/lib/whatsapp';
import { RowDataPacket } from 'mysql2';

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    // Support apiKey in body as alternative to Authorization header
    let payload: ReturnType<typeof requireAuth>;
    let rawBody: Record<string, unknown>;
    try {
      rawBody = await req.clone().json() as Record<string, unknown>;
    } catch {
      rawBody = {};
    }

    if (rawBody.apiKey) {
      // Inject apiKey as a Bearer token so requireAuth can verify it
      const syntheticReq = new Request(req.url, {
        method:  req.method,
        headers: { ...Object.fromEntries(req.headers), authorization: `Bearer ${rawBody.apiKey}` },
        body:    JSON.stringify(rawBody),
      });
      payload = requireAuth(syntheticReq as unknown as NextRequest);
    } else {
      payload = requireAuth(req);
    }

    const campaignId = Number(params.id);

    if (!campaignId) return apiError('Invalid campaign ID', 400);

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

    const accessToken   = (campaign.access_token   as string) || process.env.WHATSAPP_ACCESS_TOKEN || '';
    const phoneNumberId = (campaign.phone_number_id as string) || process.env.PHONE_NUMBER_ID      || '';

    if (!accessToken || !phoneNumberId) return apiError('WhatsApp credentials not configured', 400);

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

    // ── Upsert contact (race-condition safe) ─────────────────
    await execute(
      'INSERT IGNORE INTO contacts (workspace_id, phone, name, source, opted_in) VALUES (?, ?, ?, ?, 1)',
      [payload.workspaceId, normalizedPhone, contactName, 'api_campaign']
    );
    const contactRow = await query<RowDataPacket[]>(
      'SELECT id, name FROM contacts WHERE workspace_id = ? AND phone = ? LIMIT 1',
      [payload.workspaceId, normalizedPhone]
    );
    const contactId = contactRow[0].id as number;
    if (contactName && !contactRow[0].name) {
      await execute(
        "UPDATE contacts SET name = ? WHERE id = ? AND (name IS NULL OR name = '')",
        [contactName, contactId]
      );
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
    });

    // ── Store message row (enables webhook delivery tracking) ─
    const t = utcNow();
    const msgId = await insert(
      `INSERT INTO messages
         (workspace_id, contact_id, wamid, direction, type, content, campaign_id, status, sent_at, created_at)
       VALUES (?, ?, ?, 'outbound', 'template', ?, ?, 'sent', ?, ?)`,
      [payload.workspaceId, contactId, wamid || null, templateContent, campaignId, t, t]
    );

    // ── Add campaign_contacts entry (enables contact list + status tracking) ─
    await insert(
      `INSERT INTO campaign_contacts (campaign_id, contact_id, message_id, status, sent_at)
       VALUES (?, ?, ?, 'sent', ?)
       ON DUPLICATE KEY UPDATE message_id = VALUES(message_id), status = 'sent', sent_at = ?`,
      [campaignId, contactId, msgId, t, t]
    );

    // ── Update campaign counters ─────────────────────────────
    await execute(
      `UPDATE campaigns
       SET sent_count = sent_count + 1, total_contacts = total_contacts + 1
       WHERE id = ?`,
      [campaignId]
    );

    return apiSuccess({ sent: true, phone: normalizedPhone, wamid });

  } catch (err: unknown) {
    if (err instanceof Error && err.message === 'UNAUTHORIZED') return apiError('Unauthorized', 401);
    console.error('[campaign/send]', err);
    return apiError('Failed to send message', 500);
  }
}
