/**
 * DELETE /api/templates/[id]  — delete template from DB + Meta
 */
import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { query, execute } from '@/lib/db';
import { apiSuccess, apiError } from '@/lib/utils';
import { RowDataPacket } from 'mysql2';
import axios from 'axios';

type Params = { params: { id: string } };

export async function DELETE(req: NextRequest, { params }: Params) {
  try {
    const payload = await requireAuth(req);
    const id = Number(params.id);
    if (!id || isNaN(id)) return apiError('Invalid id', 400);

    // Verify ownership
    const rows = await query<RowDataPacket[]>(
      'SELECT id, name, meta_template_id FROM templates WHERE id = ? AND workspace_id = ? LIMIT 1',
      [id, payload.workspaceId]
    );
    if (rows.length === 0) return apiError('Template not found', 404);

    const tpl = rows[0];

    // Check if template is used in any campaign
    const usedIn = await query<RowDataPacket[]>(
      'SELECT COUNT(*) as cnt FROM campaigns WHERE template_id = ?',
      [id]
    );
    if ((usedIn[0]?.cnt as number) > 0) {
      return apiError('Cannot delete — this template is used in one or more campaigns. Delete those campaigns first.', 409);
    }

    // Check if template is used in any chatbot rule
    const usedInBot = await query<RowDataPacket[]>(
      'SELECT COUNT(*) as cnt FROM chatbot_rules WHERE response_template_id = ?',
      [id]
    );
    if ((usedInBot[0]?.cnt as number) > 0) {
      return apiError('Cannot delete — this template is used in a chatbot rule. Remove it from chatbot first.', 409);
    }

    // Try to delete from Meta — best-effort, never blocks local delete
    if (tpl.meta_template_id) {
      try {
        const ws = await query<RowDataPacket[]>(
          'SELECT access_token, waba_id FROM workspaces WHERE id = ? LIMIT 1',
          [payload.workspaceId]
        );
        const wsRow       = ws[0] || {};
        const accessToken = (wsRow.access_token as string) || process.env.WHATSAPP_ACCESS_TOKEN || '';
        const wabaId      = (wsRow.waba_id      as string) || process.env.WABA_ID              || '';

        if (accessToken && wabaId) {
          await axios.delete(
            `https://graph.facebook.com/v19.0/${wabaId}/message_templates`,
            {
              params:  { name: tpl.name as string, hsm_id: tpl.meta_template_id as string },
              headers: { Authorization: `Bearer ${accessToken}` },
            }
          );
        }
      } catch (metaErr) {
        console.warn('[Template DELETE] Meta deletion failed:', metaErr instanceof Error ? metaErr.message : metaErr);
      }
    }

    await execute(
      'DELETE FROM templates WHERE id = ? AND workspace_id = ?',
      [id, payload.workspaceId]
    );

    return apiSuccess({ deleted: true });

  } catch (err: unknown) {
    if (err instanceof Error && err.message === 'UNAUTHORIZED') return apiError('Unauthorized', 401);
    // MySQL FK constraint violation (errno 1451)
    const mysqlErr = err as { errno?: number };
    if (mysqlErr?.errno === 1451) {
      return apiError('Cannot delete — template is referenced by campaigns or chatbot rules.', 409);
    }
    console.error('[Template DELETE]', err);
    return apiError('Server error', 500);
  }
}
