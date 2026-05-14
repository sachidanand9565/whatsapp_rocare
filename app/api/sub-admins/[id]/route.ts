/**
 * PATCH  /api/sub-admins/[id]  — update workspace assignments / toggle active
 * DELETE /api/sub-admins/[id]  — remove sub-admin
 */
import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { query, insert, execute } from '@/lib/db';
import { apiSuccess, apiError } from '@/lib/utils';
import { RowDataPacket } from 'mysql2';

type Ctx = { params: { id: string } };

async function getAdminWorkspaceIds(userId: number): Promise<number[]> {
  const rows = await query<RowDataPacket[]>(
    `SELECT workspace_id FROM workspace_members WHERE user_id = ? AND role = 'admin'`,
    [userId]
  );
  return rows.map((r) => r.workspace_id as number);
}

export async function PATCH(req: NextRequest, { params }: Ctx) {
  try {
    const payload      = requireAuth(req);
    const subAdminId   = Number(params.id);
    const workspaceIds = await getAdminWorkspaceIds(payload.userId);
    if (workspaceIds.length === 0) return apiError('Unauthorized', 403);

    const { assigned_workspace_ids, is_active, workspace_role } = await req.json();

    // Toggle active status
    if (typeof is_active === 'number') {
      await execute('UPDATE users SET is_active = ? WHERE id = ? AND role = ?', [is_active, subAdminId, 'sub_admin']);
    }

    // Update workspace assignments
    if (Array.isArray(assigned_workspace_ids)) {
      const allowed = (assigned_workspace_ids as number[]).filter((id) => workspaceIds.includes(id));

      // Remove from all admin-managed workspaces first
      if (workspaceIds.length > 0) {
        await execute(
          `DELETE FROM workspace_members WHERE user_id = ? AND workspace_id IN (${workspaceIds.map(() => '?').join(',')})`,
          [subAdminId, ...workspaceIds]
        );
      }

      // Re-insert selected workspaces
      const role = workspace_role || 'admin';
      for (const wsId of allowed) {
        await insert(
          'INSERT IGNORE INTO workspace_members (workspace_id, user_id, role) VALUES (?, ?, ?)',
          [wsId, subAdminId, role]
        );
      }
    }

    return apiSuccess({ updated: true });
  } catch (err) {
    if (err instanceof Error && err.message === 'UNAUTHORIZED') return apiError('Unauthorized', 401);
    console.error('[sub-admins PATCH]', err);
    return apiError('Server error', 500);
  }
}

export async function DELETE(req: NextRequest, { params }: Ctx) {
  try {
    const payload      = requireAuth(req);
    const subAdminId   = Number(params.id);
    const workspaceIds = await getAdminWorkspaceIds(payload.userId);
    if (workspaceIds.length === 0) return apiError('Unauthorized', 403);

    // Remove from admin's workspaces
    if (workspaceIds.length > 0) {
      await execute(
        `DELETE FROM workspace_members WHERE user_id = ? AND workspace_id IN (${workspaceIds.map(() => '?').join(',')})`,
        [subAdminId, ...workspaceIds]
      );
    }

    // Check if user has any remaining workspace memberships
    const remaining = await query<RowDataPacket[]>(
      'SELECT 1 FROM workspace_members WHERE user_id = ? LIMIT 1',
      [subAdminId]
    );

    // Remove from sub_admins tracking table
    await execute('DELETE FROM sub_admins WHERE user_id = ?', [subAdminId]);

    // If no workspaces left, delete the user entirely
    if (remaining.length === 0) {
      await execute('DELETE FROM users WHERE id = ?', [subAdminId]);
    }

    return apiSuccess({ deleted: true });
  } catch (err) {
    if (err instanceof Error && err.message === 'UNAUTHORIZED') return apiError('Unauthorized', 401);
    console.error('[sub-admins DELETE]', err);
    return apiError('Server error', 500);
  }
}
