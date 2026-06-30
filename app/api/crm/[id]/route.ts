/**
 * PATCH  /api/crm/[id]  — toggle active / update
 * DELETE /api/crm/[id]  — delete integration
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
    const id = Number(params.id);

    if ('is_active' in body) {
      await execute(
        'UPDATE crm_integrations SET is_active = ? WHERE id = ? AND workspace_id = ?',
        [body.is_active, id, payload.workspaceId]
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
      'DELETE FROM crm_integrations WHERE id = ? AND workspace_id = ?',
      [Number(params.id), payload.workspaceId]
    );
    return apiSuccess({ deleted: true });
  } catch (err) {
    if (err instanceof Error && err.message === 'UNAUTHORIZED') return apiError('Unauthorized', 401);
    return apiError('Server error', 500);
  }
}
