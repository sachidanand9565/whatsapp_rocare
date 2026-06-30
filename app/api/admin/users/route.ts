/**
 * GET /api/admin/users — list ALL users across the platform (super-admin only)
 * Query: ?search=&status=active|disabled
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
    const status = sp.get('status') || '';

    let where = ' WHERE 1=1';
    const params: unknown[] = [];
    if (search) { where += ' AND (u.name LIKE ? OR u.email LIKE ?)'; params.push(`%${search}%`, `%${search}%`); }
    if (status === 'active')   where += ' AND u.is_active = 1';
    if (status === 'disabled') where += ' AND u.is_active = 0';

    const rows = await query<RowDataPacket[]>(
      `SELECT u.id, u.name, u.email, u.role, u.is_active, u.is_super_admin, u.created_at,
              (SELECT COUNT(*) FROM workspace_members wm WHERE wm.user_id = u.id) AS workspaces,
              (SELECT GROUP_CONCAT(w.name SEPARATOR ', ')
                 FROM workspace_members wm JOIN workspaces w ON w.id = wm.workspace_id
                 WHERE wm.user_id = u.id) AS workspace_names
       FROM users u
       ${where}
       ORDER BY u.created_at DESC
       LIMIT 1000`,
      params
    );

    return apiSuccess(rows);
  } catch (err) {
    if (err instanceof Error && err.message === 'UNAUTHORIZED') return apiError('Unauthorized', 401);
    if (err instanceof Error && err.message === 'FORBIDDEN')    return apiError('Forbidden — super admin only', 403);
    console.error('[admin/users]', err);
    return apiError('Server error', 500);
  }
}
