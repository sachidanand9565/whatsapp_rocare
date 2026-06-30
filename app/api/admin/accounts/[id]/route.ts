/**
 * GET /api/admin/accounts/[id] — one account + its projects (workspaces) with stats (super-admin)
 */
import { NextRequest } from 'next/server';
import { requireSuperAdmin } from '@/lib/admin';
import { query } from '@/lib/db';
import { apiSuccess, apiError } from '@/lib/utils';
import { RowDataPacket } from 'mysql2';

type Params = { params: { id: string } };

export async function GET(req: NextRequest, { params }: Params) {
  try {
    await requireSuperAdmin(req);
    const id = Number(params.id);
    if (!id) return apiError('Invalid id');

    const users = await query<RowDataPacket[]>(
      'SELECT id, name, email, is_active, is_super_admin, created_at FROM users WHERE id = ? LIMIT 1',
      [id]
    );
    if (users.length === 0) return apiError('Account not found', 404);

    const projects = await query<RowDataPacket[]>(
      `SELECT w.id, w.name, w.plan, w.is_active, w.phone_number_id, w.created_at,
              (w.phone_number_id IS NOT NULL AND w.phone_number_id != ''
               AND w.access_token IS NOT NULL AND w.access_token != '') AS connected,
              (SELECT COUNT(*) FROM workspace_members wm WHERE wm.workspace_id = w.id) AS members,
              (SELECT COUNT(*) FROM workspace_members wm WHERE wm.workspace_id = w.id AND wm.role = 'agent') AS agents,
              (SELECT COUNT(*) FROM contacts c  WHERE c.workspace_id = w.id) AS contacts,
              (SELECT COUNT(*) FROM campaigns cp WHERE cp.workspace_id = w.id) AS campaigns,
              (SELECT COUNT(*) FROM messages m  WHERE m.workspace_id = w.id AND m.direction='outbound') AS messages_sent
       FROM workspaces w
       WHERE w.owner_id = ?
       ORDER BY w.id ASC`,
      [id]
    );

    return apiSuccess({ account: users[0], projects });
  } catch (err) {
    if (err instanceof Error && err.message === 'UNAUTHORIZED') return apiError('Unauthorized', 401);
    if (err instanceof Error && err.message === 'FORBIDDEN')    return apiError('Forbidden — super admin only', 403);
    console.error('[admin/accounts/[id]]', err);
    return apiError('Server error', 500);
  }
}
