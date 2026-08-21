/**
 * POST /api/calling/action — control WhatsApp calls from the inbox softphone
 *
 * Inbound (customer called us):
 *   { call_id, action: "pre_accept", sdp }   ← browser's WebRTC SDP answer (ICE complete)
 *   { call_id, action: "accept",     sdp }   ← after WebRTC connection is up
 *   { call_id, action: "reject" }
 *   { call_id, action: "terminate" }
 *
 * Outbound (we call the customer):
 *   { action: "connect", to: "9198…", sdp } ← browser's SDP offer → returns { call_id }
 *   customer's SDP answer then arrives via SSE `call_answer`.
 */
import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { query, execute } from '@/lib/db';
import { apiSuccess, apiError, normalizePhone } from '@/lib/utils';
import { callAction, startBusinessCall } from '@/lib/whatsapp';
import { logCallStart, logCallAnswered, logCallRejected } from '@/lib/callLogs';
import { emitSSE } from '@/lib/sse';
import { RowDataPacket } from 'mysql2';

const ACTIONS = ['reject', 'terminate', 'pre_accept', 'accept', 'connect'] as const;
type Action = typeof ACTIONS[number];

export async function POST(req: NextRequest) {
  try {
    const payload = await requireAuth(req);
    const body = await req.json() as { call_id?: string; action?: string; sdp?: string; to?: string };
    const action = body.action as Action;
    if (!ACTIONS.includes(action)) return apiError(`action must be one of ${ACTIONS.join(', ')}`, 400);

    const ws = await query<RowDataPacket[]>(
      'SELECT access_token, phone_number_id FROM workspaces WHERE id = ? LIMIT 1',
      [payload.workspaceId]
    );
    const token = ws[0]?.access_token as string | undefined;
    const pnId  = ws[0]?.phone_number_id as string | undefined;
    if (!token || !pnId) return apiError('WhatsApp not connected', 400);

    // ── Outbound: start a business-initiated call ──
    if (action === 'connect') {
      const to = normalizePhone(body.to || '');
      if (!to)       return apiError('to (phone) is required', 400);
      if (!body.sdp) return apiError('sdp offer is required', 400);
      try {
        const res = await startBusinessCall(token, pnId, to, body.sdp);
        const callId = res?.calls?.[0]?.id;
        if (!callId) return apiError('Meta did not return a call id', 502);
        // Make sure the contact exists so the terminate event can log against it
        await execute(
          'INSERT IGNORE INTO contacts (workspace_id, phone, source, opted_in) VALUES (?, ?, ?, 1)',
          [payload.workspaceId, to, 'inbound']
        ).catch(() => {});
        const cRow = await query<RowDataPacket[]>(
          'SELECT id FROM contacts WHERE workspace_id = ? AND phone = ? LIMIT 1', [payload.workspaceId, to]
        );
        await logCallStart({
          workspaceId: payload.workspaceId, contactId: (cRow[0]?.id as number) || null,
          callId, direction: 'outbound', agentId: payload.userId,
        });
        return apiSuccess({ call_id: callId });
      } catch (e) {
        const err = e as { response?: { data?: { error?: { message?: string; code?: number; error_data?: { details?: string } } } } };
        const me = err?.response?.data?.error;
        const detail = me?.error_data?.details || me?.message || (e as Error).message;
        // 138006-ish family: no call permission from the user
        const hint = /permission/i.test(detail)
          ? ' — the customer must grant call permission first (they can tap "Allow calls" when they call you, or reply to a call-permission request).'
          : '';
        return apiError(`Meta: ${detail}${hint}`, 502);
      }
    }

    // ── Inbound / live call control ──
    if (!body.call_id) return apiError('call_id is required', 400);
    if ((action === 'pre_accept' || action === 'accept') && !body.sdp) {
      return apiError('sdp answer is required for pre_accept/accept', 400);
    }
    try {
      await callAction(token, pnId, body.call_id, action, body.sdp);
    } catch (e) {
      const err = e as { response?: { data?: { error?: { message?: string; error_data?: { details?: string } } } } };
      const me = err?.response?.data?.error;
      const detail = me?.error_data?.details || me?.message || (e as Error).message;
      // Call may already have ended (customer hung up / rang out) — not worth a red toast
      if ((action === 'reject' || action === 'terminate') && /not found|already|ended|invalid call|no longer/i.test(detail)) {
        return apiSuccess({ done: true, note: 'call already ended' });
      }
      console.warn(`[calling/action] ${action} failed:`, JSON.stringify(me || detail));
      return apiError(`Meta: ${detail}`, 502);
    }
    // Attribute the call to this agent for the Calls page
    if (action === 'accept') await logCallAnswered(body.call_id, payload.userId);
    if (action === 'reject') await logCallRejected(body.call_id, payload.userId);

    // Tell every other open panel to stop ringing for this call:
    //  - pre_accept fires the moment an agent clicks Answer (earliest signal),
    //    accept repeats it as a safety net — the client handler is idempotent.
    //  - reject ends the call for everyone; broadcast immediately instead of
    //    waiting for Meta's terminate webhook.
    if (action === 'pre_accept' || action === 'accept') {
      const u = await query<RowDataPacket[]>(
        'SELECT name FROM users WHERE id = ? LIMIT 1', [payload.userId]
      ).catch(() => [] as RowDataPacket[]);
      emitSSE({
        type: 'call_taken', workspaceId: payload.workspaceId,
        callId: body.call_id, agentName: (u[0]?.name as string) || undefined,
      });
    } else if (action === 'reject') {
      emitSSE({ type: 'call_ended', workspaceId: payload.workspaceId, callId: body.call_id });
    }
    return apiSuccess({ done: true });
  } catch (err: unknown) {
    if (err instanceof Error && err.message === 'UNAUTHORIZED') return apiError('Unauthorized', 401);
    console.error('[calling/action]', err);
    return apiError('Server error', 500);
  }
}
