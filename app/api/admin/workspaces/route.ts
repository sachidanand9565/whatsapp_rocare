/**
 * GET /api/admin/workspaces — list ALL workspaces with usage (super-admin only)
 * Query: ?search=&plan=&status=active|suspended
 */
import { NextRequest } from 'next/server';
import { requireSuperAdmin } from '@/lib/admin';
import { query } from '@/lib/db';
import { apiSuccess, apiError } from '@/lib/utils';
import { RowDataPacket } from 'mysql2';

export async function GET(req: NextRequest) {
  try {
    await requireSuperAdmin(req);
    const sp     = new URL(req.url).searchParams;
    const search = sp.get('search') || '';
    const plan   = sp.get('plan')   || '';
    const status = sp.get('status') || '';

    let where = ' WHERE 1=1';
    const params: unknown[] = [];
    if (search) { where += ' AND (w.name LIKE ? OR ou.email LIKE ? OR ou.name LIKE ?)'; params.push(`%${search}%`, `%${search}%`, `%${search}%`); }
    if (plan)   { where += ' AND w.plan = ?';   params.push(plan); }
    if (status === 'active')    where += ' AND w.is_active = 1';
    if (status === 'suspended') where += ' AND w.is_active = 0';

    const rows = await query<RowDataPacket[]>(
      `SELECT w.id, w.name, w.plan, w.is_active, w.phone_number_id, w.created_at,
              ou.id AS owner_id, ou.name AS owner_name, ou.email AS owner_email,
              (SELECT COUNT(*) FROM workspace_members wm WHERE wm.workspace_id = w.id)       AS members,
              (SELECT COUNT(*) FROM contacts c WHERE c.workspace_id = w.id)                  AS contacts,
              (SELECT COUNT(*) FROM campaigns cp WHERE cp.workspace_id = w.id)               AS campaigns,
              (SELECT COUNT(*) FROM messages m WHERE m.workspace_id = w.id AND m.direction='outbound') AS messages_sent
       FROM workspaces w
       LEFT JOIN users ou ON ou.id = w.owner_id
       ${where}
       ORDER BY w.created_at DESC
       LIMIT 1000`,
      params
    );

    return apiSuccess(rows);
  } catch (err) {
    if (err instanceof Error && err.message === 'UNAUTHORIZED') return apiError('Unauthorized', 401);
    if (err instanceof Error && err.message === 'FORBIDDEN')    return apiError('Forbidden — super admin only', 403);
    console.error('[admin/workspaces]', err);
    return apiError('Server error', 500);
  }
}
