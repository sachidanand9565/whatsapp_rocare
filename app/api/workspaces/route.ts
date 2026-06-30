/**
 * GET  /api/workspaces  — list all workspaces for current user
 * POST /api/workspaces  — create a new workspace (project)
 */
import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { query, insert } from '@/lib/db';
import { apiSuccess, apiError } from '@/lib/utils';
import { RowDataPacket } from 'mysql2';

export async function GET(req: NextRequest) {
  try {
    const payload = await requireAuth(req);
    const rows = await query<RowDataPacket[]>(
      `SELECT w.id, w.name, w.phone_number_id, w.plan, w.is_active, wm.role
       FROM workspaces w
       JOIN workspace_members wm ON wm.workspace_id = w.id
       WHERE wm.user_id = ?
       ORDER BY w.id ASC`,
      [payload.userId]
    );
    return apiSuccess(rows);
  } catch (err) {
    if (err instanceof Error && err.message === 'UNAUTHORIZED') return apiError('Unauthorized', 401);
    return apiError('Server error', 500);
  }
}

export async function POST(req: NextRequest) {
  try {
    const payload = await requireAuth(req);
    const { name } = await req.json();
    if (!name || !name.trim()) return apiError('Project name is required');

    const workspaceId = await insert(
      'INSERT INTO workspaces (owner_id, name, verify_token) VALUES (?, ?, ?)',
      [payload.userId, name.trim(), `vt_${Date.now()}`]
    );

    await insert(
      'INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (?, ?, ?)',
      [workspaceId, payload.userId, 'admin']
    );

    return apiSuccess({ id: workspaceId, name: name.trim() }, 201);
  } catch (err) {
    if (err instanceof Error && err.message === 'UNAUTHORIZED') return apiError('Unauthorized', 401);
    return apiError('Server error', 500);
  }
}
