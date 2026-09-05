/**
 * GET  /api/campaigns
 * POST /api/campaigns
 */
import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { query, insert } from '@/lib/db';
import { apiSuccess, apiError, utcNow } from '@/lib/utils';
import { RowDataPacket } from 'mysql2';

export async function GET(req: NextRequest) {
  try {
    const payload = await requireAuth(req);

    // Optional date filter (YYYY-MM-DD) — counts messages sent ON that date for each campaign
    const dateParam = req.nextUrl.searchParams.get('date');
    const isValidDate = !!dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam);

    // Subquery: accurate per-status counts from messages (every individual send)
    const statsSub = `
      LEFT JOIN (
        SELECT campaign_id,
          COALESCE(SUM(status IN ('sent','delivered','read')), 0) AS cc_sent,
          COALESCE(SUM(status IN ('delivered','read')),        0) AS cc_delivered,
          COALESCE(SUM(status = 'read'),                       0) AS cc_read,
          COALESCE(SUM(status = 'failed'),                     0) AS cc_failed
        FROM messages
        WHERE direction = 'outbound'
        ${isValidDate ? 'AND DATE(created_at) = ?' : ''}
        GROUP BY campaign_id
      ) cc_stats ON cc_stats.campaign_id = c.id`;

    const selectCols = `c.*, t.name as template_name, t.status as template_status,
      COALESCE(cc_stats.cc_sent,      0) AS cc_sent,
      COALESCE(cc_stats.cc_delivered, 0) AS cc_delivered,
      COALESCE(cc_stats.cc_read,      0) AS cc_read,
      COALESCE(cc_stats.cc_failed,    0) AS cc_failed`;

    // When filtering by date, sort by messages sent on that date (highest first)
    const orderBy = isValidDate ? 'cc_stats.cc_sent DESC, c.created_at DESC' : 'c.created_at DESC';
    const statsParams = isValidDate ? [dateParam] : [];

    // Agents only see campaigns assigned to them
    if (payload.role === 'agent') {
      const campaigns = await query<RowDataPacket[]>(
        `SELECT ${selectCols}
         FROM campaigns c
         LEFT JOIN templates t ON t.id = c.template_id
         ${statsSub}
         JOIN campaign_assignments ca ON ca.campaign_id = c.id AND ca.agent_id = ?
         WHERE c.workspace_id = ?
         ORDER BY ${orderBy}`,
        [...statsParams, payload.userId, payload.workspaceId]
      );
      return apiSuccess(campaigns);
    }

    const campaigns = await query<RowDataPacket[]>(
      `SELECT ${selectCols}
       FROM campaigns c
       LEFT JOIN templates t ON t.id = c.template_id
       ${statsSub}
       WHERE c.workspace_id = ?
       ORDER BY ${orderBy}`,
      [...statsParams, payload.workspaceId]
    );
    return apiSuccess(campaigns);
  } catch (err: unknown) {
    if (err instanceof Error && err.message === 'UNAUTHORIZED') return apiError('Unauthorized', 401);
    return apiError('Server error', 500);
  }
}

export async function POST(req: NextRequest) {
  try {
    const payload = await requireAuth(req);
    if (payload.role === 'agent') return apiError('Agents cannot create campaigns', 403);

    const { name, template_id, scheduled_at, template_vars, contact_ids, campaign_type, csv_contacts, header_media } = await req.json() as {
      name: string;
      template_id: number;
      scheduled_at?: string;
      template_vars?: Record<string, string>;
      contact_ids?: number[];
      campaign_type?: string;
      header_media?: string;
      csv_contacts?: { phone: string; name: string; vars: Record<string, string> }[];
    };

    if (!name || !template_id) return apiError('Name and template are required');

    const validTypes = ['broadcast', 'api', 'drip', 'transactional'];
    const type = validTypes.includes(campaign_type || '') ? campaign_type! : 'broadcast';

    // For CSV mode, total_contacts comes from csv_contacts length
    const totalContacts = csv_contacts?.length || contact_ids?.length || 0;

    // Campaigns are active by default — they start sending right away unless scheduled for later.
    const status = scheduled_at ? 'scheduled' : 'running';

    const id = await insert(
      `INSERT INTO campaigns (workspace_id, name, template_id, campaign_type, status, scheduled_at, started_at, template_vars, created_by, total_contacts)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        payload.workspaceId, name, template_id,
        type,
        status,
        scheduled_at || null,
        status === 'running' ? utcNow() : null,
        JSON.stringify({ ...(template_vars || {}), ...(header_media ? { _header_media: header_media } : {}) }),
        payload.userId,
        totalContacts,
      ]
    );

    // Add contacts from manual selection
    if (contact_ids && contact_ids.length > 0) {
      const values = contact_ids.map((cid) => `(${id}, ${cid})`).join(',');
      await query(`INSERT IGNORE INTO campaign_contacts (campaign_id, contact_id) VALUES ${values}`);
    }

    // Add contacts from CSV — BULK upsert + link (chunked). The old per-row
    // version ran 4 sequential queries per contact; a 500+ row CSV took minutes
    // and the AWS gateway cut the request with a 504 before it finished.
    if (csv_contacts && csv_contacts.length > 0) {
      const { normalizePhone } = await import('@/lib/utils');
      const { execute: exec } = await import('@/lib/db');

      // Normalize + dedupe (last occurrence of a phone wins)
      const byPhone = new Map<string, { phone: string; name: string | null; vars: Record<string, string> }>();
      for (const row of csv_contacts) {
        const phone = normalizePhone(row.phone);
        if (!phone) continue;
        byPhone.set(phone, { phone, name: row.name || null, vars: row.vars || {} });
      }
      const rows = Array.from(byPhone.values());

      const CHUNK = 500;
      for (let i = 0; i < rows.length; i += CHUNK) {
        const chunk = rows.slice(i, i + CHUNK);
        // Bulk upsert contacts — fills the name only where it's still empty
        await exec(
          `INSERT INTO contacts (workspace_id, phone, name, source, opted_in)
           VALUES ${chunk.map(() => '(?, ?, ?, ?, 1)').join(',')}
           ON DUPLICATE KEY UPDATE name = IF(name IS NULL OR name = '', VALUES(name), name)`,
          chunk.flatMap((r) => [payload.workspaceId, r.phone, r.name, 'csv_import'])
        );
        // phone → id in ONE query for the whole chunk
        const idRows = await query<RowDataPacket[]>(
          `SELECT id, phone FROM contacts WHERE workspace_id = ? AND phone IN (${chunk.map(() => '?').join(',')})`,
          [payload.workspaceId, ...chunk.map((r) => r.phone)]
        );
        const idByPhone = new Map(idRows.map((r) => [String(r.phone), Number(r.id)]));
        // Bulk link to the campaign with per-row vars
        // NOTE: no INSERT IGNORE — it would suppress ON DUPLICATE KEY UPDATE
        const linkable = chunk.filter((r) => idByPhone.has(r.phone));
        if (linkable.length > 0) {
          await exec(
            `INSERT INTO campaign_contacts (campaign_id, contact_id, variables)
             VALUES ${linkable.map(() => '(?, ?, ?)').join(',')}
             ON DUPLICATE KEY UPDATE variables = VALUES(variables)`,
            linkable.flatMap((r) => [id, idByPhone.get(r.phone)!, JSON.stringify(r.vars)])
          );
        }
      }

      // total_contacts was the raw CSV row count — correct it to what actually queued
      await exec(
        'UPDATE campaigns SET total_contacts = (SELECT COUNT(*) FROM campaign_contacts WHERE campaign_id = ?) WHERE id = ?',
        [id, id]
      ).catch(() => {});
    }

    return apiSuccess({ id }, 201);
  } catch (err: unknown) {
    if (err instanceof Error && err.message === 'UNAUTHORIZED') return apiError('Unauthorized', 401);
    console.error('[campaigns POST]', err);
    return apiError('Server error', 500);
  }
}
