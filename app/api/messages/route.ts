/**
 * GET /api/messages?contactId=X[&limit=80][&afterId=Y]
 * Returns conversation history with a contact.
 * afterId: if provided, only returns messages with id > afterId (incremental load).
 */
import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { query } from '@/lib/db';
import { apiSuccess, apiError } from '@/lib/utils';
import { RowDataPacket } from 'mysql2';

export async function GET(req: NextRequest) {
  try {
    const payload    = requireAuth(req);
    const sp         = new URL(req.url).searchParams;
    const contactId  = sp.get('contactId');
    const limit      = Math.min(100, Number(sp.get('limit') || 80));
    const afterId    = Number(sp.get('afterId') || 0);

    if (!contactId) return apiError('contactId required');

    // ── Incremental fetch (SSE-triggered, only new messages) ────
    if (afterId > 0) {
      const messages = await query<RowDataPacket[]>(
        `SELECT m.*, c.name as contact_name, c.phone as contact_phone
         FROM messages m
         LEFT JOIN contacts c ON c.id = m.contact_id
         WHERE m.workspace_id = ? AND m.contact_id = ? AND m.id > ?
         ORDER BY m.id ASC
         LIMIT ?`,
        [payload.workspaceId, contactId, afterId, limit]
      );
      return apiSuccess(messages);
    }

    // ── Full load (initial open) ─────────────────────────────────
    const messages = await query<RowDataPacket[]>(
      `SELECT m.*, c.name as contact_name, c.phone as contact_phone
       FROM messages m
       LEFT JOIN contacts c ON c.id = m.contact_id
       WHERE m.workspace_id = ?
         AND (
           m.contact_id IN (
             SELECT id FROM contacts
             WHERE workspace_id = ?
               AND phone = (SELECT phone FROM contacts WHERE id = ? AND workspace_id = ?)
           )
           OR m.wamid IN (
             SELECT replied_to_wamid FROM messages
             WHERE workspace_id = ?
               AND replied_to_wamid IS NOT NULL
               AND contact_id IN (
                 SELECT id FROM contacts
                 WHERE workspace_id = ?
                   AND phone = (SELECT phone FROM contacts WHERE id = ? AND workspace_id = ?)
               )
           )
         )
       ORDER BY COALESCE(m.created_at, m.sent_at) DESC, m.id DESC
       LIMIT ?`,
      [
        payload.workspaceId,
        payload.workspaceId, contactId, payload.workspaceId,
        payload.workspaceId,
        payload.workspaceId, contactId, payload.workspaceId,
        limit,
      ]
    );

    return apiSuccess(messages.reverse()); // oldest first
  } catch (err: unknown) {
    if (err instanceof Error && err.message === 'UNAUTHORIZED') return apiError('Unauthorized', 401);
    return apiError('Server error', 500);
  }
}
