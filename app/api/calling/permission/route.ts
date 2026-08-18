/**
 * GET  /api/calling/permission?contactId=N
 *   → call-permission status for this customer + whether the 24h window is open
 *
 * POST /api/calling/permission
 *   { contactId, action: "request",     text? }  → send call-permission consent prompt
 *   { contactId, action: "call_button", text?, button_text? } → send "Call us" voice_call button
 */
import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { query, insert, execute } from '@/lib/db';
import { apiSuccess, apiError, utcNow } from '@/lib/utils';
import { getCallPermission, sendCallPermissionRequest, sendVoiceCallButton } from '@/lib/whatsapp';
import { emitSSE } from '@/lib/sse';
import { RowDataPacket } from 'mysql2';

async function loadCtx(workspaceId: number, contactId: number) {
  const ws = await query<RowDataPacket[]>(
    'SELECT access_token, phone_number_id FROM workspaces WHERE id = ? LIMIT 1', [workspaceId]
  );
  const c = await query<RowDataPacket[]>(
    'SELECT id, phone, name, last_inbound_at FROM contacts WHERE id = ? AND workspace_id = ? LIMIT 1',
    [contactId, workspaceId]
  );
  return { token: ws[0]?.access_token as string | undefined, pnId: ws[0]?.phone_number_id as string | undefined, contact: c[0] };
}

function windowOpen(lastInbound: unknown): boolean {
  if (!lastInbound || typeof lastInbound !== 'string') return false;
  return Date.now() - new Date(lastInbound.replace(' ', 'T') + 'Z').getTime() < 24 * 3600 * 1000;
}

export async function GET(req: NextRequest) {
  try {
    const payload = await requireAuth(req);
    const contactId = Number(req.nextUrl.searchParams.get('contactId') || 0);
    if (!contactId) return apiError('contactId is required', 400);
    const { token, pnId, contact } = await loadCtx(payload.workspaceId, contactId);
    if (!contact) return apiError('Contact not found', 404);
    if (!token || !pnId) return apiError('WhatsApp not connected', 400);

    let permission = null;
    let meta_error: string | null = null;
    try {
      permission = await getCallPermission(token, pnId, contact.phone as string);
    } catch (e) {
      const err = e as { response?: { data?: { error?: { message?: string } } } };
      meta_error = err?.response?.data?.error?.message || (e as Error).message;
    }
    return apiSuccess({ permission, meta_error, window_open: windowOpen(contact.last_inbound_at) });
  } catch (err: unknown) {
    if (err instanceof Error && err.message === 'UNAUTHORIZED') return apiError('Unauthorized', 401);
    console.error('[calling/permission GET]', err);
    return apiError('Server error', 500);
  }
}

export async function POST(req: NextRequest) {
  try {
    const payload = await requireAuth(req);
    const body = await req.json() as { contactId?: number; action?: string; text?: string; button_text?: string };
    const contactId = Number(body.contactId || 0);
    if (!contactId) return apiError('contactId is required', 400);
    if (body.action !== 'request' && body.action !== 'call_button') return apiError('action must be request or call_button', 400);

    const { token, pnId, contact } = await loadCtx(payload.workspaceId, contactId);
    if (!contact) return apiError('Contact not found', 404);
    if (!token || !pnId) return apiError('WhatsApp not connected', 400);
    const phone = contact.phone as string;
    const name  = (contact.name as string) || '';

    let result: { messages?: { id?: string }[] } | undefined;
    let dbType = 'interactive';
    let content = '';
    try {
      if (body.action === 'request') {
        const text = (body.text || '').trim()
          || `Hi${name ? ' ' + name : ''}, we'd like to call you on WhatsApp to help with your request. Please allow calls from us.`;
        result = await sendCallPermissionRequest(token, pnId, phone, text);
        content = JSON.stringify({ __type: 'call_permission_request', body: text });
      } else {
        const text = (body.text || '').trim()
          || `Need help${name ? ', ' + name : ''}? Tap the button below to call our team on WhatsApp.`;
        const btn  = (body.button_text || 'Call us').trim();
        result = await sendVoiceCallButton(token, pnId, phone, text, btn);
        content = JSON.stringify({ __type: 'voice_call_button', body: text, button: btn });
      }
    } catch (e) {
      const err = e as { response?: { data?: { error?: { message?: string; code?: number; error_data?: { details?: string } } } } };
      const me = err?.response?.data?.error;
      const detail = me?.error_data?.details || me?.message || (e as Error).message;
      const hint = me?.code === 131047 || /24 hours|re-engagement/i.test(detail)
        ? ' — the 24h window is closed. Send a template first (or use a template that carries the call-permission button).'
        : /limit|exceed/i.test(detail) ? ' — permission-request limit reached (1 per 24h, 2 per 7 days per customer).' : '';
      return apiError(`Meta: ${detail}${hint}`, 502);
    }

    const wamid = result?.messages?.[0]?.id || null;
    const t = utcNow();
    const msgId = await insert(
      `INSERT INTO messages (workspace_id, contact_id, wamid, direction, type, content, status, sent_at, created_at)
       VALUES (?, ?, ?, 'outbound', ?, ?, 'sent', ?, ?)`,
      [payload.workspaceId, contactId, wamid, dbType, content, t, t]
    );
    await execute('UPDATE contacts SET last_message_at = ? WHERE id = ?', [t, contactId]).catch(() => {});
    emitSSE({ type: 'new_message', workspaceId: payload.workspaceId, contactId, direction: 'outbound' });
    return apiSuccess({ sent: true, message_id: msgId, wamid });
  } catch (err: unknown) {
    if (err instanceof Error && err.message === 'UNAUTHORIZED') return apiError('Unauthorized', 401);
    console.error('[calling/permission POST]', err);
    return apiError('Server error', 500);
  }
}
