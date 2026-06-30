/**
 * POST /api/typing
 * Sends a WhatsApp typing indicator to a contact.
 */
import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { query } from '@/lib/db';
import { markAsRead, sendTypingIndicator } from '@/lib/whatsapp';
import { apiSuccess, apiError, normalizePhone } from '@/lib/utils';
import { RowDataPacket } from 'mysql2';
import axios from 'axios';

export async function POST(req: NextRequest) {
  try {
    const payload       = await requireAuth(req);
    const { contactId } = await req.json();
    if (!contactId) return apiError('contactId is required');

    const [wsRows, contactRows, lastMsgRows] = await Promise.all([
      query<RowDataPacket[]>(
        'SELECT access_token, phone_number_id FROM workspaces WHERE id = ? AND is_active = 1 LIMIT 1',
        [payload.workspaceId]
      ),
      query<RowDataPacket[]>(
        'SELECT phone FROM contacts WHERE id = ? AND workspace_id = ? LIMIT 1',
        [contactId, payload.workspaceId]
      ),
      query<RowDataPacket[]>(
        `SELECT wamid FROM messages
         WHERE workspace_id = ? AND contact_id = ? AND direction = 'inbound'
           AND wamid IS NOT NULL AND wamid != ''
         ORDER BY id DESC LIMIT 1`,
        [payload.workspaceId, contactId]
      ),
    ]);

    if (wsRows.length === 0)      return apiError('Workspace not found', 404);
    if (contactRows.length === 0) return apiError('Contact not found', 404);

    const { access_token, phone_number_id } = wsRows[0];
    if (!access_token || !phone_number_id)  return apiError('WhatsApp not configured', 400);

    const phone = normalizePhone(contactRows[0].phone as string);
    console.log('[typing] to:', phone, 'phoneNumberId:', phone_number_id);

    // Mark last inbound message as read first (Meta prerequisite)
    if (lastMsgRows.length > 0) {
      await markAsRead(access_token as string, phone_number_id as string, lastMsgRows[0].wamid as string)
        .catch(() => {});
    }

    // Send typing indicator
    const result = await sendTypingIndicator(access_token as string, phone_number_id as string, phone);
    console.log('[typing] Meta response:', JSON.stringify(result));

    return apiSuccess({ ok: true, meta: result });
  } catch (err) {
    if (err instanceof Error && err.message === 'UNAUTHORIZED') return apiError('Unauthorized', 401);

    // Extract Meta API error details
    if (axios.isAxiosError(err)) {
      const metaErr = err.response?.data as Record<string, unknown> | undefined;
      console.error('[typing] Meta error:', JSON.stringify(metaErr));
      return apiError(JSON.stringify(metaErr), err.response?.status || 500);
    }

    const msg = err instanceof Error ? err.message : 'Server error';
    console.error('[typing] error:', msg);
    return apiError(msg, 500);
  }
}
