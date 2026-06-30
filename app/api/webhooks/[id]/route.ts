/**
 * PATCH  /api/webhooks/[id] — update name/url/secret/is_active
 * DELETE /api/webhooks/[id] — delete webhook
 */
import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { query, execute } from '@/lib/db';
import { apiSuccess, apiError } from '@/lib/utils';
import { RowDataPacket } from 'mysql2';

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const payload = await requireAuth(req);
    const id = Number(params.id);

    // Verify ownership
    const rows = await query<RowDataPacket[]>(
      'SELECT id FROM chatbot_webhooks WHERE id = ? AND workspace_id = ?',
      [id, payload.workspaceId]
    );
    if (rows.length === 0) return apiError('Not found', 404);

    const body = await req.json();

    // Build dynamic SET clause from provided fields
    const allowed = ['name', 'url', 'secret', 'is_active'] as const;
    const sets: string[] = [];
    const vals: unknown[] = [];
    for (const key of allowed) {
      if (key in body) {
        if (key === 'url' && body[key] && !String(body[key]).startsWith('http')) {
          return apiError('URL must start with http:// or https://', 400);
        }
        sets.push(`${key} = ?`);
        vals.push(body[key] === '' ? null : body[key]);
      }
    }
    if (sets.length === 0) return apiError('Nothing to update', 400);

    vals.push(id);
    await execute(`UPDATE chatbot_webhooks SET ${sets.join(', ')} WHERE id = ?`, vals);
    return apiSuccess({ updated: true });
  } catch (err: unknown) {
    if (err instanceof Error && err.message === 'UNAUTHORIZED') return apiError('Unauthorized', 401);
    return apiError('Server error', 500);
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const payload = await requireAuth(req);
    const id = Number(params.id);

    await execute(
      'DELETE FROM chatbot_webhooks WHERE id = ? AND workspace_id = ?',
      [id, payload.workspaceId]
    );
    return apiSuccess({ deleted: true });
  } catch (err: unknown) {
    if (err instanceof Error && err.message === 'UNAUTHORIZED') return apiError('Unauthorized', 401);
    return apiError('Server error', 500);
  }
}
