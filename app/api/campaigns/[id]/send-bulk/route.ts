/**
 * POST /api/campaigns/[id]/send-bulk
 * Queue many messages for an API campaign in ONE request — like a broadcast.
 * Rows are inserted as pending campaign_contacts; the campaign-process cron
 * sends them in parallel batches (no per-message HTTP round trips).
 *
 * Body:
 * {
 *   "apiKey": "ws_...",                       // alternative to Authorization header
 *   "messages": [
 *     {
 *       "destination": "919876543210",
 *       "templateParams": ["John", "Order#123"],   // positional {{1}}, {{2}}, …
 *       "contactName": "John"                       // optional
 *     },
 *     ...
 *   ]
 * }
 *
 * Legacy per-row format also accepted: { phone, variables: { "1": "John" } }
 */
import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { query, execute } from '@/lib/db';
import { drainCampaign } from '@/lib/campaignProcessor';
import { resolveCampaignId } from '@/lib/resolveCampaign';
import { apiSuccess, apiError, normalizePhone, utcNow } from '@/lib/utils';
import { RowDataPacket } from 'mysql2';

const MAX_MESSAGES = 5000;
const INSERT_CHUNK = 500;

interface BulkRow {
  destination?:    string;
  phone?:          string;
  templateParams?: string[];
  variables?:      Record<string, string>;
  contactName?:    string;
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    let rawBody: Record<string, unknown>;
    try {
      rawBody = await req.clone().json() as Record<string, unknown>;
    } catch {
      return apiError('Invalid JSON body', 400);
    }

    // ── Auth: workspace API key, legacy JWT in body, or Authorization header ─
    let payload: Awaited<ReturnType<typeof requireAuth>>;
    const incomingKey = rawBody.apiKey as string | undefined;
    if (incomingKey?.startsWith('ws_')) {
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

    const messages = rawBody.messages as BulkRow[] | undefined;
    if (!Array.isArray(messages) || messages.length === 0) {
      return apiError('messages array is required', 400);
    }
    if (messages.length > MAX_MESSAGES) {
      return apiError(`Too many messages — max ${MAX_MESSAGES} per request`, 400);
    }

    // ── Load campaign ────────────────────────────────────────
    const camps = await query<RowDataPacket[]>(
      `SELECT c.status, w.access_token, w.phone_number_id
       FROM campaigns c JOIN workspaces w ON w.id = c.workspace_id
       WHERE c.id = ? AND c.workspace_id = ? AND c.campaign_type = 'api'`,
      [campaignId, payload.workspaceId]
    );
    if (camps.length === 0) return apiError('API campaign not found', 404);
    const camp = camps[0];

    if (camp.status === 'paused') {
      return apiError('Campaign is inactive — activate it before sending messages', 403);
    }
    if (!camp.access_token || !camp.phone_number_id) {
      return apiError('WhatsApp credentials not configured', 400);
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
        chunk.flatMap((r) => [payload.workspaceId, r.phone, r.name, 'api_campaign'])
      );
    }

    const phones = rows.map((r) => r.phone);
    const contactIdByPhone = new Map<string, number>();
    for (let i = 0; i < phones.length; i += INSERT_CHUNK) {
      const chunk = phones.slice(i, i + INSERT_CHUNK);
      const found = await query<RowDataPacket[]>(
        `SELECT id, phone FROM contacts
         WHERE workspace_id = ? AND phone IN (${chunk.map(() => '?').join(',')})`,
        [payload.workspaceId, ...chunk]
      );
      for (const c of found) contactIdByPhone.set(c.phone as string, c.id as number);
    }

    // ── Bulk queue campaign_contacts with per-row variables ──
    // Re-queue rows that previously failed; leave already-sent rows untouched
    // but refresh their variables so a re-submit uses the latest values.
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
           status    = IF(status = 'failed', 'pending', status)`,
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

    // Kick off sending immediately — loops batch-after-batch until the queue
    // is drained (fire-and-forget; the 60s cron remains as fallback if the
    // process restarts mid-drain).
    drainCampaign(campaignId).catch((err) => console.error('[campaign/send-bulk] drain', err));

    return apiSuccess({
      queued,
      pending,
      invalid: invalid.length,
      message: `${pending} messages queued — sending started`,
    });
  } catch (err: unknown) {
    if (err instanceof Error && err.message === 'UNAUTHORIZED') return apiError('Unauthorized', 401);
    console.error('[campaign/send-bulk]', err);
    return apiError('Failed to queue messages', 500);
  }
}
