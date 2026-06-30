/**
 * GET /api/campaign-settings  — get campaign-level settings
 * PUT /api/campaign-settings  — update campaign-level settings
 */
import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { query, execute } from '@/lib/db';
import { apiSuccess, apiError } from '@/lib/utils';
import { RowDataPacket } from 'mysql2';

export async function GET(req: NextRequest) {
  try {
    const payload = await requireAuth(req);
    const rows = await query<RowDataPacket[]>(
      'SELECT auto_pause_campaigns FROM workspaces WHERE id = ?',
      [payload.workspaceId]
    );
    if (rows.length === 0) return apiError('Workspace not found', 404);
    return apiSuccess({ auto_pause_campaigns: rows[0].auto_pause_campaigns ?? 1 });
  } catch (err: unknown) {
    if (err instanceof Error && err.message === 'UNAUTHORIZED') return apiError('Unauthorized', 401);
    return apiError('Server error', 500);
  }
}

export async function PUT(req: NextRequest) {
  try {
    const payload = await requireAuth(req);
    if (payload.role !== 'admin') return apiError('Admin only', 403);
    const { auto_pause_campaigns } = await req.json();
    await execute(
      'UPDATE workspaces SET auto_pause_campaigns = ? WHERE id = ?',
      [auto_pause_campaigns ? 1 : 0, payload.workspaceId]
    );
    return apiSuccess({ updated: true });
  } catch (err: unknown) {
    if (err instanceof Error && err.message === 'UNAUTHORIZED') return apiError('Unauthorized', 401);
    return apiError('Server error', 500);
  }
}
