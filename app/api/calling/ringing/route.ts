/**
 * GET /api/calling/ringing — the calls currently ringing in this workspace
 * (if any). Lets a freshly opened panel — e.g. from tapping the push
 * notification — show the incoming-call popups mid-ring.
 * `calls` lists every ringing call; `ringing` (the oldest) is kept for older clients.
 */
import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { apiSuccess, apiError } from '@/lib/utils';
import { getRingingCalls } from '@/lib/activeCalls';

export async function GET(req: NextRequest) {
  try {
    const payload = await requireAuth(req);
    const calls = getRingingCalls(payload.workspaceId).map((call) => ({
      call_id:      call.callId,
      contact_id:   call.contactId ?? null,
      caller_name:  call.callerName,
      caller_phone: call.callerPhone,
      sdp:          call.sdp || null,
      started_at:   call.at,
    }));
    return apiSuccess({ ringing: calls[0] || null, calls });
  } catch (err) {
    if (err instanceof Error && err.message === 'UNAUTHORIZED') return apiError('Unauthorized', 401);
    console.error('[calling/ringing]', err);
    return apiError('Server error', 500);
  }
}
