/**
 * GET /api/calling/ringing — the call currently ringing in this workspace
 * (if any). Lets a freshly opened panel — e.g. from tapping the push
 * notification — show the incoming-call popup mid-ring.
 */
import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { apiSuccess, apiError } from '@/lib/utils';
import { getRinging } from '@/lib/activeCalls';

export async function GET(req: NextRequest) {
  try {
    const payload = await requireAuth(req);
    const call = getRinging(payload.workspaceId);
    return apiSuccess({ ringing: call ? {
      call_id:      call.callId,
      contact_id:   call.contactId ?? null,
      caller_name:  call.callerName,
      caller_phone: call.callerPhone,
      sdp:          call.sdp || null,
      started_at:   call.at,
    } : null });
  } catch (err) {
    if (err instanceof Error && err.message === 'UNAUTHORIZED') return apiError('Unauthorized', 401);
    console.error('[calling/ringing]', err);
    return apiError('Server error', 500);
  }
}
