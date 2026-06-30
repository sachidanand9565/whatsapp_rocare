/**
 * DELETE /api/quick-replies/[id]
 */
import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { execute } from '@/lib/db';
import { apiSuccess, apiError } from '@/lib/utils';

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const payload = await requireAuth(req);
    await execute(
      'DELETE FROM quick_replies WHERE id = ? AND workspace_id = ?',
      [params.id, payload.workspaceId]
    );
    return apiSuccess({ deleted: true });
  } catch (err) {
    if (err instanceof Error && err.message === 'UNAUTHORIZED') return apiError('Unauthorized', 401);
    return apiError('Server error', 500);
  }
}
