/**
 * PUT    /api/chatbot/[id]
 * DELETE /api/chatbot/[id]
 */
import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { execute } from '@/lib/db';
import { apiSuccess, apiError } from '@/lib/utils';

type Params = { params: { id: string } };

export async function PUT(req: NextRequest, { params }: Params) {
  try {
    const payload = await requireAuth(req);
    const { trigger_type, trigger_value, response_type, response_text, priority, is_active } = await req.json();

    await execute(
      `UPDATE chatbot_rules SET trigger_type=?, trigger_value=?, response_type=?, response_text=?, priority=?, is_active=?
       WHERE id = ? AND workspace_id = ?`,
      [trigger_type, trigger_value, response_type, response_text, priority || 0, is_active ? 1 : 0, params.id, payload.workspaceId]
    );
    return apiSuccess({ updated: true });
  } catch (err: unknown) {
    if (err instanceof Error && err.message === 'UNAUTHORIZED') return apiError('Unauthorized', 401);
    return apiError('Server error', 500);
  }
}

export async function DELETE(req: NextRequest, { params }: Params) {
  try {
    const payload = await requireAuth(req);
    await execute('DELETE FROM chatbot_rules WHERE id = ? AND workspace_id = ?', [params.id, payload.workspaceId]);
    return apiSuccess({ deleted: true });
  } catch (err: unknown) {
    if (err instanceof Error && err.message === 'UNAUTHORIZED') return apiError('Unauthorized', 401);
    return apiError('Server error', 500);
  }
}
