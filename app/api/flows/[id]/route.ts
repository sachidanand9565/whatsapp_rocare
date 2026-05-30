/**
 * GET    /api/flows/[id]  — get single flow with nodes+edges
 * PUT    /api/flows/[id]  — update flow
 * DELETE /api/flows/[id]  — delete flow
 */
import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { query, execute } from '@/lib/db';
import { apiSuccess, apiError } from '@/lib/utils';
import { RowDataPacket } from 'mysql2';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, ctx: Ctx) {
  try {
    const payload = requireAuth(req);
    const { id } = await ctx.params;
    const rows = await query<RowDataPacket[]>(
      'SELECT * FROM flows WHERE id = ? AND workspace_id = ? LIMIT 1',
      [id, payload.workspaceId]
    );
    if (rows.length === 0) return apiError('Flow not found', 404);
    const flow = rows[0];
    return apiSuccess({
      ...flow,
      nodes: typeof flow.nodes === 'string' ? JSON.parse(flow.nodes) : flow.nodes,
      edges: typeof flow.edges === 'string' ? JSON.parse(flow.edges) : flow.edges,
    });
  } catch (err: unknown) {
    if (err instanceof Error && err.message === 'UNAUTHORIZED') return apiError('Unauthorized', 401);
    return apiError('Server error', 500);
  }
}

export async function PUT(req: NextRequest, ctx: Ctx) {
  try {
    const payload = requireAuth(req);
    const { id } = await ctx.params;
    const { name, trigger_type, trigger_value, nodes, edges, is_active } = await req.json();

    const updates: string[] = [];
    const params: unknown[] = [];

    if (name !== undefined)          { updates.push('name = ?');          params.push(name); }
    if (trigger_type !== undefined)  { updates.push('trigger_type = ?');  params.push(trigger_type); }
    if (trigger_value !== undefined) { updates.push('trigger_value = ?'); params.push(trigger_value || null); }
    if (nodes !== undefined)         { updates.push('nodes = ?');         params.push(JSON.stringify(nodes)); }
    if (edges !== undefined)         { updates.push('edges = ?');         params.push(JSON.stringify(edges)); }
    if (is_active !== undefined)     { updates.push('is_active = ?');     params.push(is_active); }

    if (updates.length === 0) return apiError('Nothing to update');
    params.push(id, payload.workspaceId);

    await execute(
      `UPDATE flows SET ${updates.join(', ')} WHERE id = ? AND workspace_id = ?`,
      params
    );
    return apiSuccess({ updated: true });
  } catch (err: unknown) {
    if (err instanceof Error && err.message === 'UNAUTHORIZED') return apiError('Unauthorized', 401);
    return apiError('Server error', 500);
  }
}

export async function DELETE(req: NextRequest, ctx: Ctx) {
  try {
    const payload = requireAuth(req);
    const { id } = await ctx.params;
    await execute('DELETE FROM flows WHERE id = ? AND workspace_id = ?', [id, payload.workspaceId]);
    await execute('DELETE FROM flow_sessions WHERE flow_id = ? AND workspace_id = ?', [id, payload.workspaceId]);
    return apiSuccess({ deleted: true });
  } catch (err: unknown) {
    if (err instanceof Error && err.message === 'UNAUTHORIZED') return apiError('Unauthorized', 401);
    return apiError('Server error', 500);
  }
}
