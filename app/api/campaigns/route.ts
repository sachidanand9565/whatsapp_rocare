/**
 * GET  /api/campaigns
 * POST /api/campaigns
 */
import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { query, insert } from '@/lib/db';
import { apiSuccess, apiError } from '@/lib/utils';
import { RowDataPacket } from 'mysql2';

export async function GET(req: NextRequest) {
  try {
    const payload = requireAuth(req);

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
        GROUP BY campaign_id
      ) cc_stats ON cc_stats.campaign_id = c.id`;

    const selectCols = `c.*, t.name as template_name, t.status as template_status,
      COALESCE(cc_stats.cc_sent,      0) AS cc_sent,
      COALESCE(cc_stats.cc_delivered, 0) AS cc_delivered,
      COALESCE(cc_stats.cc_read,      0) AS cc_read,
      COALESCE(cc_stats.cc_failed,    0) AS cc_failed`;

    // Agents only see campaigns assigned to them
    if (payload.role === 'agent') {
      const campaigns = await query<RowDataPacket[]>(
        `SELECT ${selectCols}
         FROM campaigns c
         LEFT JOIN templates t ON t.id = c.template_id
         ${statsSub}
         JOIN campaign_assignments ca ON ca.campaign_id = c.id AND ca.agent_id = ?
         WHERE c.workspace_id = ?
         ORDER BY c.created_at DESC`,
        [payload.userId, payload.workspaceId]
      );
      return apiSuccess(campaigns);
    }

    const campaigns = await query<RowDataPacket[]>(
      `SELECT ${selectCols}
       FROM campaigns c
       LEFT JOIN templates t ON t.id = c.template_id
       ${statsSub}
       WHERE c.workspace_id = ?
       ORDER BY c.created_at DESC`,
      [payload.workspaceId]
    );
    return apiSuccess(campaigns);
  } catch (err: unknown) {
    if (err instanceof Error && err.message === 'UNAUTHORIZED') return apiError('Unauthorized', 401);
    return apiError('Server error', 500);
  }
}

export async function POST(req: NextRequest) {
  try {
    const payload = requireAuth(req);
    if (payload.role === 'agent') return apiError('Agents cannot create campaigns', 403);

    const { name, template_id, scheduled_at, template_vars, contact_ids, campaign_type } = await req.json();

    if (!name || !template_id) return apiError('Name and template are required');

    const validTypes = ['broadcast', 'api', 'drip', 'transactional'];
    const type = validTypes.includes(campaign_type) ? campaign_type : 'broadcast';

    const id = await insert(
      `INSERT INTO campaigns (workspace_id, name, template_id, campaign_type, status, scheduled_at, template_vars, created_by, total_contacts)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        payload.workspaceId, name, template_id,
        type,
        scheduled_at ? 'scheduled' : 'draft',
        scheduled_at || null,
        JSON.stringify(template_vars || {}),
        payload.userId,
        contact_ids?.length || 0,
      ]
    );

    // Add campaign contacts
    if (contact_ids?.length > 0) {
      const values = (contact_ids as number[]).map((cid) => `(${id}, ${cid})`).join(',');
      await query(`INSERT IGNORE INTO campaign_contacts (campaign_id, contact_id) VALUES ${values}`);
    }

    return apiSuccess({ id }, 201);
  } catch (err: unknown) {
    if (err instanceof Error && err.message === 'UNAUTHORIZED') return apiError('Unauthorized', 401);
    console.error('[campaigns POST]', err);
    return apiError('Server error', 500);
  }
}
