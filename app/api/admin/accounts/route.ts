/**
 * GET /api/admin/accounts — accounts (workspace owners) with project counts (super-admin)
 * Query: ?search=
 * An "account" = a user who owns one or more workspaces (projects).
 */
import { NextRequest } from 'next/server';
import { requireSuperAdmin } from '@/lib/admin';
import { query } from '@/lib/db';
import { apiSuccess, apiError } from '@/lib/utils';
import { RowDataPacket } from 'mysql2';

export async function GET(req: NextRequest) {
  try {
    await requireSuperAdmin(req);
    const search = new URL(req.url).searchParams.get('search') || '';

    let where = '';
    const params: unknown[] = [];
    if (search) { where = ' AND (u.name LIKE ? OR u.email LIKE ?)'; params.push(`%${search}%`, `%${search}%`); }

    const rows = await query<RowDataPacket[]>(
      `SELECT u.id, u.name, u.email, u.is_active, u.created_at,
              COUNT(w.id) AS projects,
              COALESCE(SUM(w.is_active), 0) AS active_projects,
              COALESCE(SUM((SELECT COUNT(*) FROM messages m WHERE m.workspace_id = w.id AND m.direction='outbound')), 0) AS messages_sent
       FROM users u
       JOIN workspaces w ON w.owner_id = u.id
       WHERE 1=1 ${where}
       GROUP BY u.id, u.name, u.email, u.is_active, u.created_at
       ORDER BY projects DESC, u.created_at DESC
       LIMIT 1000`,
      params
    );

    return apiSuccess(rows);
  } catch (err) {
    if (err instanceof Error && err.message === 'UNAUTHORIZED') return apiError('Unauthorized', 401);
    if (err instanceof Error && err.message === 'FORBIDDEN')    return apiError('Forbidden — super admin only', 403);
    console.error('[admin/accounts]', err);
    return apiError('Server error', 500);
  }
}
