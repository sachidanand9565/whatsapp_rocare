/**
 * POST /api/typing
 * Sends a WhatsApp typing indicator to a contact.
 * Called from the inbox when an agent starts typing.
 */
import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { query } from '@/lib/db';
import { sendTypingIndicator } from '@/lib/whatsapp';
import { apiSuccess, apiError, normalizePhone } from '@/lib/utils';
import { RowDataPacket } from 'mysql2';

export async function POST(req: NextRequest) {
  try {
    const payload   = requireAuth(req);
    const { contactId } = await req.json();
    if (!contactId) return apiError('contactId is required');

    const [wsRows, contactRows] = await Promise.all([
      query<RowDataPacket[]>(
        'SELECT access_token, phone_number_id FROM workspaces WHERE id = ? AND is_active = 1 LIMIT 1',
        [payload.workspaceId]
      ),
      query<RowDataPacket[]>(
        'SELECT phone FROM contacts WHERE id = ? AND workspace_id = ? LIMIT 1',
        [contactId, payload.workspaceId]
      ),
    ]);

    if (wsRows.length === 0) return apiError('Workspace not found', 404);
    if (contactRows.length === 0) return apiError('Contact not found', 404);

    const { access_token, phone_number_id } = wsRows[0];
    if (!access_token || !phone_number_id) return apiError('WhatsApp not configured', 400);

    const phone = normalizePhone(contactRows[0].phone as string);
    // Fire-and-forget — client does not need to wait
    sendTypingIndicator(access_token as string, phone_number_id as string, phone).catch(() => {});

    return apiSuccess({ ok: true });
  } catch (err) {
    if (err instanceof Error && err.message === 'UNAUTHORIZED') return apiError('Unauthorized', 401);
    return apiError('Server error', 500);
  }
}
