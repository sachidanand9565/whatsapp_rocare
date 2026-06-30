/**
 * POST /api/admin/workspaces/[id]/impersonate — "Open Panel" (super-admin only)
 * Generates a short-lived handoff code for the project's owner, scoped to this
 * workspace. Frontend opens /auth/sso?code=... to enter that project's dashboard
 * without a password. Reuses the existing SSO handoff flow.
 */
import { NextRequest } from 'next/server';
import { requireSuperAdmin } from '@/lib/admin';
import { signHandoffCode } from '@/lib/auth';
import { query } from '@/lib/db';
import { apiSuccess, apiError } from '@/lib/utils';
import { RowDataPacket } from 'mysql2';

type Params = { params: { id: string } };

export async function POST(req: NextRequest, { params }: Params) {
  try {
    await requireSuperAdmin(req);
    const id = Number(params.id);
    if (!id) return apiError('Invalid id');

    // Resolve the workspace owner + their membership role on this workspace
    const rows = await query<RowDataPacket[]>(
      `SELECT w.id AS workspace_id, ou.id AS owner_id, ou.email AS owner_email, ou.is_active,
              COALESCE(wm.role, 'admin') AS role
       FROM workspaces w
       JOIN users ou ON ou.id = w.owner_id
       LEFT JOIN workspace_members wm ON wm.workspace_id = w.id AND wm.user_id = ou.id
       WHERE w.id = ? LIMIT 1`,
      [id]
    );
    if (rows.length === 0) return apiError('Project not found', 404);
    const r = rows[0];
    if (!r.is_active) return apiError('Owner account is disabled', 400);

    const handoffCode = signHandoffCode({
      userId:      r.owner_id as number,
      email:       r.owner_email as string,
      role:        r.role as string,
      workspaceId: r.workspace_id as number,
    });

    return apiSuccess({ handoffCode });
  } catch (err) {
    if (err instanceof Error && err.message === 'UNAUTHORIZED') return apiError('Unauthorized', 401);
    if (err instanceof Error && err.message === 'FORBIDDEN')    return apiError('Forbidden — super admin only', 403);
    console.error('[admin/workspaces/[id]/impersonate]', err);
    return apiError('Server error', 500);
  }
}
