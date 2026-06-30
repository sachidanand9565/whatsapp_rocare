/**
 * POST /api/messages/read
 * Sends WhatsApp read receipts for the latest inbound messages of a contact.
 * Called when an agent opens a chat so the user sees blue ticks.
 */
import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { query } from '@/lib/db';
import { apiSuccess, apiError } from '@/lib/utils';
import { markAsRead } from '@/lib/whatsapp';
import { RowDataPacket } from 'mysql2';

export async function POST(req: NextRequest) {
  try {
    const payload    = await requireAuth(req);
    const { contactId } = await req.json();
    if (!contactId) return apiError('contactId required');

    // Get workspace credentials
    const wsRows = await query<RowDataPacket[]>(
      'SELECT access_token, phone_number_id FROM workspaces WHERE id = ? AND is_active = 1 LIMIT 1',
      [payload.workspaceId]
    );
    if (!wsRows.length || !wsRows[0].access_token || !wsRows[0].phone_number_id) {
      return apiSuccess({ marked: 0 });
    }
    const { access_token, phone_number_id } = wsRows[0];

    // Get all inbound wamids that have not been read yet (limit to last 20)
    const msgs = await query<RowDataPacket[]>(
      `SELECT wamid FROM messages
       WHERE workspace_id = ? AND contact_id = ? AND direction = 'inbound'
         AND wamid IS NOT NULL AND wamid != ''
       ORDER BY id DESC LIMIT 20`,
      [payload.workspaceId, contactId]
    );

    if (!msgs.length) return apiSuccess({ marked: 0 });

    // Fire read receipts — non-blocking, errors are silently ignored
    let marked = 0;
    for (const row of msgs) {
      try {
        await markAsRead(access_token as string, phone_number_id as string, row.wamid as string);
        marked++;
      } catch { /* ignore — message may already be read or expired */ }
    }

    return apiSuccess({ marked });
  } catch (err: unknown) {
    if (err instanceof Error && err.message === 'UNAUTHORIZED') return apiError('Unauthorized', 401);
    return apiError('Server error', 500);
  }
}
