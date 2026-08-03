/**
 * PATCH  /api/failed-webhooks/[id]  — toggle active / edit fields
 * DELETE /api/failed-webhooks/[id]  — delete webhook
 */
import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { execute } from '@/lib/db';
import { apiSuccess, apiError } from '@/lib/utils';

type Ctx = { params: { id: string } };

export async function PATCH(req: NextRequest, { params }: Ctx) {
  try {
    const payload = await requireAuth(req);
    const body = await req.json();

    // Build SET dynamically — toggle-only and full edits share this endpoint
    const sets: string[] = [];
    const vals: (string | number | null)[] = [];
    if ('is_active' in body)   { sets.push('is_active = ?');   vals.push(body.is_active ? 1 : 0); }
    if ('name' in body)        { sets.push('name = ?');        vals.push(body.name); }
    if ('campaign_id' in body) { sets.push('campaign_id = ?'); vals.push(Number(body.campaign_id)); }
    if ('api_url' in body)     { sets.push('api_url = ?');     vals.push(body.api_url); }
    if ('api_method' in body)  { sets.push('api_method = ?');  vals.push(body.api_method || 'POST'); }
    if ('api_headers' in body) { sets.push('api_headers = ?'); vals.push(body.api_headers || null); }
    if (sets.length === 0) return apiError('Nothing to update', 400);

    await execute(
      `UPDATE failed_msg_webhooks SET ${sets.join(', ')} WHERE id = ? AND workspace_id = ?`,
      [...vals, Number(params.id), payload.workspaceId]
    );
    return apiSuccess({ updated: true });
  } catch (err) {
    if (err instanceof Error && err.message === 'UNAUTHORIZED') return apiError('Unauthorized', 401);
    return apiError('Server error', 500);
  }
}

export async function DELETE(req: NextRequest, { params }: Ctx) {
  try {
    const payload = await requireAuth(req);
    await execute(
      'DELETE FROM failed_msg_webhooks WHERE id = ? AND workspace_id = ?',
      [Number(params.id), payload.workspaceId]
    );
    return apiSuccess({ deleted: true });
  } catch (err) {
    if (err instanceof Error && err.message === 'UNAUTHORIZED') return apiError('Unauthorized', 401);
    return apiError('Server error', 500);
  }
}
