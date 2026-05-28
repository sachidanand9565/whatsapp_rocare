/**
 * PATCH  /api/agents/[id]  — update agent role or status (admin only)
 * DELETE /api/agents/[id]  — remove agent from workspace (admin only)
 */
import { NextRequest } from 'next/server';
import { requireAuth, hashPassword } from '@/lib/auth';
import { query } from '@/lib/db';
import { apiSuccess, apiError } from '@/lib/utils';

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: NextRequest, ctx: Ctx) {
  try {
    const payload = requireAuth(req);
    if (payload.role !== 'admin') return apiError('Admin only', 403);

    const { id } = await ctx.params;
    const agentId = Number(id);
    const { role, is_active, password } = await req.json();

    if (role && !['manager', 'agent'].includes(role)) return apiError('Invalid role');

    if (role) {
      await query('UPDATE users SET role = ? WHERE id = ?', [role, agentId]);
      await query(
        'UPDATE workspace_members SET role = ? WHERE user_id = ? AND workspace_id = ?',
        [role, agentId, payload.workspaceId]
      );
    }

    if (typeof is_active === 'number') {
      await query('UPDATE users SET is_active = ? WHERE id = ?', [is_active, agentId]);
    }

    if (password && password.trim()) {
      const hashed = await hashPassword(password.trim());
      await query(
        'UPDATE users SET password = ?, plain_password = ? WHERE id = ?',
        [hashed, password.trim(), agentId]
      );
    }

    return apiSuccess({ updated: true });
  } catch (err: unknown) {
    if (err instanceof Error && err.message === 'UNAUTHORIZED') return apiError('Unauthorized', 401);
    return apiError('Server error', 500);
  }
}

export async function DELETE(req: NextRequest, ctx: Ctx) {
  try {
    const payload = requireAuth(req);
    if (payload.role !== 'admin') return apiError('Admin only', 403);

    const { id } = await ctx.params;
    const agentId = Number(id);

    // Remove from workspace (keeps user account but removes workspace access)
    await query(
      'DELETE FROM workspace_members WHERE user_id = ? AND workspace_id = ?',
      [agentId, payload.workspaceId]
    );

    // Deactivate the user account
    await query('UPDATE users SET is_active = 0 WHERE id = ?', [agentId]);

    return apiSuccess({ deleted: true });
  } catch (err: unknown) {
    if (err instanceof Error && err.message === 'UNAUTHORIZED') return apiError('Unauthorized', 401);
    return apiError('Server error', 500);
  }
}
