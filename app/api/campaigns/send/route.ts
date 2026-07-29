/**
 * POST /api/campaigns/send
 * Fixed URL — AiSensy-compatible endpoint.
 * Campaign is selected by `campaignName` in the body (no ID in URL).
 *
 * Body:
 * {
 *   "apiKey":              "<your-jwt-token>",
 *   "campaignName":        "ro_service_reminder_assistant_new8",
 *   "destination":         "919876543210",
 *   "userName":            "RO CARE INDIA",          // optional
 *   "templateParams":      ["John"],                  // positional vars
 *   "source":              "landing-page",             // optional
 *   "paramsFallbackValue": { "FirstName": "user" },
 *   "media": {}, "buttons": [], "carouselCards": [], "location": {}, "attributes": {}
 * }
 */
import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { query, execute, insert } from '@/lib/db';
import { apiSuccess, apiError, normalizePhone, utcNow } from '@/lib/utils';
import { sendTemplateMessage } from '@/lib/whatsapp';
import { RowDataPacket } from 'mysql2';

export async function POST(req: NextRequest) {
  try {
    // ── Parse raw body first so we can read apiKey ────────────
    let rawBody: Record<string, unknown>;
    try {
      rawBody = await req.json() as Record<string, unknown>;
    } catch {
      return apiError('Invalid JSON body', 400);
    }

    // ── Auth: workspace api_key (ws_...) OR JWT Bearer token ────
    let payload: Awaited<ReturnType<typeof requireAuth>>;
    const incomingKey = rawBody.apiKey as string | undefined;

    if (incomingKey?.startsWith('ws_')) {
      // Permanent workspace API key — look up workspace in DB
      const wsRows = await query<RowDataPacket[]>(
        'SELECT id, owner_id FROM workspaces WHERE api_key = ? AND is_active = 1 LIMIT 1',
        [incomingKey]
      );
      if (wsRows.length === 0) return apiError('Invalid API key', 401);
      // Build a synthetic payload matching JWTPayload shape
      payload = {
        userId:      wsRows[0].owner_id as number,
        email:       '',
        role:        'admin',
        workspaceId: wsRows[0].id as number,
      };
    } else if (incomingKey) {
      // Legacy: JWT token passed as apiKey
      const syntheticReq = new Request(req.url, {
        method:  req.method,
        headers: { ...Object.fromEntries(req.headers), authorization: `Bearer ${incomingKey}` },
        body:    JSON.stringify(rawBody),
      });
      payload = await requireAuth(syntheticReq as unknown as NextRequest);
    } else {
      payload = await requireAuth(req);
    }

    // ── Validate required fields ──────────────────────────────
    const campaignName = rawBody.campaignName as string | undefined;
    const destination  = (rawBody.destination || rawBody.phone) as string | undefined;

    if (!campaignName) return apiError('campaignName is required', 400);
    if (!destination)  return apiError('destination is required', 400);

    const normalizedPhone = normalizePhone(destination);
    if (!normalizedPhone)  return apiError('Invalid phone number', 400);

    // ── Look up campaign by name ──────────────────────────────
    const rows = await query<RowDataPacket[]>(
      `SELECT c.*, t.name as template_name, t.language,
              t.body_text, t.header_type, t.header_content, t.footer_text, t.buttons,
              w.access_token, w.phone_number_id
       FROM campaigns c
       JOIN templates t  ON t.id = c.template_id
       JOIN workspaces w ON w.id = c.workspace_id
       WHERE c.name = ? AND c.workspace_id = ? AND c.campaign_type = 'api'`,
      [campaignName, payload.workspaceId]
    );

    if (rows.length === 0)
      return apiError(`API campaign "${campaignName}" not found`, 404);

    const campaign = rows[0];

    // Deactivated/finished campaign → stop sending (API bhi rukega, sirf cron nahi)
    const campStatus = String(campaign.status || '');
    if (['paused', 'completed', 'failed', 'stopped'].includes(campStatus)) {
      return apiError(`Campaign "${campaignName}" is ${campStatus} — not sending`, 409);
    }

    const accessToken   = (campaign.access_token   as string) || process.env.WHATSAPP_ACCESS_TOKEN || '';
    const phoneNumberId = (campaign.phone_number_id as string) || process.env.PHONE_NUMBER_ID      || '';

    if (!accessToken || !phoneNumberId)
      return apiError('WhatsApp credentials not configured', 400);

    // ── Build variables map ───────────────────────────────────
    // templateParams array → { "1": val, "2": val, … }
    let variables: Record<string, string> = (rawBody.variables as Record<string, string>) || {};
    const templateParams = rawBody.templateParams as string[] | undefined;
    if (templateParams && templateParams.length > 0) {
      variables = {};
      templateParams.forEach((v, i) => { variables[String(i + 1)] = v; });
    }

    // Apply fallback for placeholder tokens like "$FirstName" or empty strings
    const fallbacks = rawBody.paramsFallbackValue as Record<string, string> | undefined;
    if (fallbacks) {
      for (const [k, fallback] of Object.entries(fallbacks)) {
        for (const [idx, val] of Object.entries(variables)) {
          if (val === `$${k}` || val === '') variables[idx] = fallback;
        }
      }
    }

    // ── Resolve contact name ──────────────────────────────────
    // Priority: explicit contactName field → first templateParam (if not a $placeholder)
    const explicitName = (rawBody.contactName as string) || null;
    const firstParam   = templateParams?.[0];
    const autoName     = (firstParam && !firstParam.startsWith('$')) ? firstParam : null;
    const contactName  = explicitName || autoName || null;

    // ── Upsert contact in a single round trip (race-condition safe) ─
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

    // ── Build template components ─────────────────────────────
    const components: object[] = [];

    // Header component for IMAGE / DOCUMENT / VIDEO templates
    const headerType    = (campaign.header_type as string || '').toUpperCase();
    const headerContent = (campaign.header_content as string) || '';
    // Caller can override media via `media` field in request body
    const mediaOverride = rawBody.media as Record<string, unknown> | undefined;

    if (['IMAGE','DOCUMENT','VIDEO'].includes(headerType)) {
      const mediaType = headerType.toLowerCase() as 'image' | 'document' | 'video';
      let mediaObj: Record<string, unknown> = {};

      if (mediaOverride && Object.keys(mediaOverride).length > 0) {
        // Caller passed media — normalize: support both 'url' and 'link' keys
        const mediaUrl = (mediaOverride.url || mediaOverride.link) as string | undefined;
        const mediaId  = mediaOverride.id as string | undefined;
        if (mediaUrl) {
          mediaObj = { link: mediaUrl };
          if (mediaOverride.filename) mediaObj.filename = mediaOverride.filename as string;
        } else if (mediaId) {
          mediaObj = { id: mediaId };
        }
      } else if (headerContent) {
        // Use stored header_content (URL or media handle)
        mediaObj = headerContent.startsWith('http')
          ? { link: headerContent }
          : { id: headerContent };
      }

      if (Object.keys(mediaObj).length > 0) {
        components.push({
          type: 'header',
          parameters: [{ type: mediaType, [mediaType]: mediaObj }],
        });
      }
    }

    // Body variables
    if (Object.keys(variables).length > 0) {
      const sortedKeys = Object.keys(variables).sort((a, b) => Number(a) - Number(b));
      components.push({
        type: 'body',
        parameters: sortedKeys.map((k) => ({ type: 'text', text: variables[k] })),
      });
    }

    // Button payloads — e.g. ["accept_123", "reject_123"]
    const buttonPayloads = rawBody.buttonPayloads as string[] | undefined;
    if (Array.isArray(buttonPayloads) && buttonPayloads.length > 0) {
      buttonPayloads.forEach((pl, idx) => {
        components.push({
          type: 'button', sub_type: 'quick_reply', index: String(idx),
          parameters: [{ type: 'payload', payload: pl }],
        });
      });
    }

    // ── Send via Meta API ─────────────────────────────────────
    const result = await sendTemplateMessage(
      accessToken,
      phoneNumberId,
      normalizedPhone,
      campaign.template_name as string,
      (campaign.language as string) || 'en',
      components,
    );

    const wamid = (result?.messages as Record<string, unknown>[])?.[0]?.id as string | undefined;

    // Build rendered body text
    let bodyText = (campaign.body_text as string) || '';
    if (bodyText) {
      for (const [k, v] of Object.entries(variables)) {
        bodyText = bodyText.replace(new RegExp(`\\{\\{${k}\\}\\}`, 'g'), v);
      }
    }

    let buttons: unknown[] = [];
    try { buttons = JSON.parse((campaign.buttons as string) || '[]'); } catch { buttons = []; }

    // Resolve the actual media URL to store (so inbox can display it)
    const resolvedMediaUrl = mediaOverride
      ? ((mediaOverride.url || mediaOverride.link) as string | undefined) || ''
      : headerContent;

    const templateContent = JSON.stringify({
      __type:         'template',
      template_name:  campaign.template_name,
      header_type:    campaign.header_type    || 'NONE',
      header_content: resolvedMediaUrl || (campaign.header_content as string) || '',
      body:           bodyText,
      footer:         campaign.footer_text    || '',
      buttons,
      workspace_id:   payload.workspaceId,
    });

    // ── Persist message + bump campaign counters in parallel ──
    // (counter update doesn't depend on the message id, so it doesn't need to wait)
    const t = utcNow();
    const [msgId] = await Promise.all([
      insert(
        `INSERT INTO messages
           (workspace_id, contact_id, wamid, direction, type, content, campaign_id, status, sent_at, created_at)
         VALUES (?, ?, ?, 'outbound', 'template', ?, ?, 'sent', ?, ?)`,
        [payload.workspaceId, contactId, wamid || null, templateContent, campaign.id, t, t]
      ),
      execute(
        `UPDATE campaigns SET sent_count = sent_count + 1, total_contacts = total_contacts + 1 WHERE id = ?`,
        [campaign.id]
      ),
    ]);

    await insert(
      `INSERT INTO campaign_contacts (campaign_id, contact_id, message_id, status, sent_at)
       VALUES (?, ?, ?, 'sent', ?)
       ON DUPLICATE KEY UPDATE message_id = VALUES(message_id), status = 'sent', sent_at = ?`,
      [campaign.id, contactId, msgId, t, t]
    );

    return apiSuccess({ sent: true, phone: normalizedPhone, wamid });

  } catch (err: unknown) {
    if (err instanceof Error && err.message === 'UNAUTHORIZED') return apiError('Unauthorized', 401);

    // Extract Meta API error details if available
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const axiosErr = err as any;
    if (axiosErr?.response?.data) {
      const metaErr = axiosErr.response.data?.error;
      const msg = metaErr?.error_user_msg || metaErr?.message || 'Meta API error';
      console.error('[campaigns/send] Meta error:', JSON.stringify(axiosErr.response.data));
      return apiError(`Meta: ${msg}`, axiosErr.response.status || 500);
    }

    const msg = err instanceof Error ? err.message : String(err);
    console.error('[campaigns/send]', msg);
    return apiError(msg, 500);
  }
}
