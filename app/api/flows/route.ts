/**
 * GET  /api/flows  — list all flows
 * POST /api/flows  — create new flow
 */
import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { query, insert } from '@/lib/db';
import { apiSuccess, apiError } from '@/lib/utils';
import { RowDataPacket } from 'mysql2';

export async function GET(req: NextRequest) {
  try {
    const payload = requireAuth(req);
    const flows = await query<RowDataPacket[]>(
      'SELECT id, name, trigger_type, trigger_value, is_active, created_at FROM flows WHERE workspace_id = ? ORDER BY id DESC',
      [payload.workspaceId]
    );
    return apiSuccess(flows);
  } catch (err: unknown) {
    if (err instanceof Error && err.message === 'UNAUTHORIZED') return apiError('Unauthorized', 401);
    return apiError('Server error', 500);
  }
}

export async function POST(req: NextRequest) {
  try {
    const payload = requireAuth(req);
    const { name, trigger_type, trigger_value, nodes, edges } = await req.json();
    if (!name) return apiError('name is required');

    const id = await insert(
      `INSERT INTO flows (workspace_id, name, trigger_type, trigger_value, nodes, edges)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        payload.workspaceId,
        name,
        trigger_type || 'keyword',
        trigger_value || null,
        JSON.stringify(nodes || []),
        JSON.stringify(edges || []),
      ]
    );
    return apiSuccess({ id }, 201);
  } catch (err: unknown) {
    if (err instanceof Error && err.message === 'UNAUTHORIZED') return apiError('Unauthorized', 401);
    return apiError('Server error', 500);
  }
}
