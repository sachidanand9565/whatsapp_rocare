/**
 * PATCH /api/admin/users/[id] — enable/disable user, grant/revoke super-admin (super-admin only)
 *   body: { is_active?: 0|1, is_super_admin?: 0|1 }
 */
import { NextRequest } from 'next/server';
import { requireSuperAdmin } from '@/lib/admin';
import { invalidateUserTokens } from '@/lib/auth';
import { execute, query } from '@/lib/db';
import { apiSuccess, apiError } from '@/lib/utils';
import { RowDataPacket } from 'mysql2';

type Params = { params: { id: string } };

export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    const actor = await requireSuperAdmin(req);
    const id = Number(params.id);
    if (!id) return apiError('Invalid id');

    const body = await req.json() as { is_active?: number; is_super_admin?: number };
    const sets: string[] = [];
    const vals: unknown[] = [];

    if (body.is_active !== undefined) {
      if (id === actor.userId && !body.is_active) return apiError('You cannot disable your own account', 400);
      sets.push('is_active = ?'); vals.push(body.is_active ? 1 : 0);
    }
    if (body.is_super_admin !== undefined) {
      if (id === actor.userId && !body.is_super_admin) return apiError('You cannot revoke your own super-admin', 400);
      sets.push('is_super_admin = ?'); vals.push(body.is_super_admin ? 1 : 0);
    }
    if (sets.length === 0) return apiError('Nothing to update');

    vals.push(id);
    await execute(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`, vals);

    // If disabled, force-logout that user's existing tokens
    if (body.is_active === 0) invalidateUserTokens(id);

    const rows = await query<RowDataPacket[]>(
      'SELECT id, name, email, role, is_active, is_super_admin FROM users WHERE id = ? LIMIT 1', [id]
    );
    return apiSuccess(rows[0] || { id });
  } catch (err) {
    if (err instanceof Error && err.message === 'UNAUTHORIZED') return apiError('Unauthorized', 401);
    if (err instanceof Error && err.message === 'FORBIDDEN')    return apiError('Forbidden — super admin only', 403);
    console.error('[admin/users PATCH]', err);
    return apiError('Server error', 500);
  }
}
