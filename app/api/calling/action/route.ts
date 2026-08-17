/**
 * POST /api/calling/action — control a live WhatsApp call from the inbox
 * Body: { call_id: "wacid.…", action: "reject" | "terminate" }
 *
 * "accept" needs a WebRTC SDP answer (browser softphone) — Phase 2.
 */
import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { query } from '@/lib/db';
import { apiSuccess, apiError } from '@/lib/utils';
import { callAction } from '@/lib/whatsapp';
import { RowDataPacket } from 'mysql2';

export async function POST(req: NextRequest) {
  try {
    const payload = await requireAuth(req);
    const { call_id, action } = await req.json() as { call_id?: string; action?: string };
    if (!call_id) return apiError('call_id is required', 400);
    if (action !== 'reject' && action !== 'terminate') return apiError('action must be reject or terminate', 400);

    const ws = await query<RowDataPacket[]>(
      'SELECT access_token, phone_number_id FROM workspaces WHERE id = ? LIMIT 1',
      [payload.workspaceId]
    );
    if (!ws[0]?.access_token || !ws[0]?.phone_number_id) return apiError('WhatsApp not connected', 400);

    try {
      await callAction(ws[0].access_token as string, ws[0].phone_number_id as string, call_id, action);
    } catch (e) {
      const err = e as { response?: { data?: { error?: { message?: string } } } };
      const detail = err?.response?.data?.error?.message || (e as Error).message;
      // Call may already have ended (customer hung up / rang out) — not an error worth a red toast
      if (/not found|already|ended|invalid call/i.test(detail)) return apiSuccess({ done: true, note: 'call already ended' });
      return apiError(`Meta: ${detail}`, 502);
    }
    return apiSuccess({ done: true });
  } catch (err: unknown) {
    if (err instanceof Error && err.message === 'UNAUTHORIZED') return apiError('Unauthorized', 401);
    console.error('[calling/action]', err);
    return apiError('Server error', 500);
  }
}
