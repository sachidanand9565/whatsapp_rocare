/**
 * PATCH  /api/failed-webhooks/[id]  — toggle active
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
    if ('is_active' in body) {
      await execute(
        'UPDATE failed_msg_webhooks SET is_active = ? WHERE id = ? AND workspace_id = ?',
        [body.is_active, Number(params.id), payload.workspaceId]
      );
    }
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
