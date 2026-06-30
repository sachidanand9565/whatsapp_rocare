/**
 * PATCH  /api/admin/workspaces/[id] — change plan / suspend-activate (super-admin)
 *   body: { plan?: 'free'|'pro'|'enterprise', is_active?: 0|1 }
 * DELETE /api/admin/workspaces/[id] — delete a workspace (super-admin)
 */
import { NextRequest } from 'next/server';
import { requireSuperAdmin } from '@/lib/admin';
import { execute, query } from '@/lib/db';
import { apiSuccess, apiError } from '@/lib/utils';
import { RowDataPacket } from 'mysql2';

const PLANS = ['free', 'pro', 'enterprise'];

type Params = { params: { id: string } };

export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    await requireSuperAdmin(req);
    const id = Number(params.id);
    if (!id) return apiError('Invalid id');

    const body = await req.json() as { plan?: string; is_active?: number };
    const sets: string[] = [];
    const vals: unknown[] = [];

    if (body.plan !== undefined) {
      if (!PLANS.includes(body.plan)) return apiError('Invalid plan');
      sets.push('plan = ?'); vals.push(body.plan);
    }
    if (body.is_active !== undefined) {
      sets.push('is_active = ?'); vals.push(body.is_active ? 1 : 0);
    }
    if (sets.length === 0) return apiError('Nothing to update');

    vals.push(id);
    await execute(`UPDATE workspaces SET ${sets.join(', ')} WHERE id = ?`, vals);

    const rows = await query<RowDataPacket[]>(
      'SELECT id, name, plan, is_active FROM workspaces WHERE id = ? LIMIT 1', [id]
    );
    return apiSuccess(rows[0] || { id });
  } catch (err) {
    if (err instanceof Error && err.message === 'UNAUTHORIZED') return apiError('Unauthorized', 401);
    if (err instanceof Error && err.message === 'FORBIDDEN')    return apiError('Forbidden — super admin only', 403);
    console.error('[admin/workspaces PATCH]', err);
    return apiError('Server error', 500);
  }
}

export async function DELETE(req: NextRequest, { params }: Params) {
  try {
    await requireSuperAdmin(req);
    const id = Number(params.id);
    if (!id) return apiError('Invalid id');
    await execute('DELETE FROM workspaces WHERE id = ?', [id]); // cascades to members/contacts/etc.
    return apiSuccess({ deleted: true });
  } catch (err) {
    if (err instanceof Error && err.message === 'UNAUTHORIZED') return apiError('Unauthorized', 401);
    if (err instanceof Error && err.message === 'FORBIDDEN')    return apiError('Forbidden — super admin only', 403);
    console.error('[admin/workspaces DELETE]', err);
    return apiError('Server error', 500);
  }
}
