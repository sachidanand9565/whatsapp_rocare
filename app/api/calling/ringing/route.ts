/**
 * GET /api/calling/ringing[?workspaces=1,2,3] — the calls currently ringing in
 * this workspace (or every member project shown in the combined inbox).
 * Lets a freshly opened panel — e.g. from tapping the push notification — show
 * the incoming-call popups mid-ring, and the panel polls it so a call whose live
 * event went to another server instance still pops up.
 * `calls` lists every ringing call; `ringing` (the oldest) is kept for older clients.
 * `shared` = the list is the same on every instance, so a call missing from it
 * has really stopped ringing.
 */
import { NextRequest } from 'next/server';
import { requireAuth, resolveWorkspaceScopes } from '@/lib/auth';
import { apiSuccess, apiError } from '@/lib/utils';
import { getRingingCalls } from '@/lib/activeCalls';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const payload = await requireAuth(req);
    const scopes = await resolveWorkspaceScopes(payload, new URL(req.url).searchParams.get('workspaces'));
    const { calls, shared } = await getRingingCalls(scopes.map((s) => Number(s.workspaceId)));
    const list = calls.map((call) => ({
      call_id:      call.callId,
      workspace_id: call.workspaceId,
      contact_id:   call.contactId ?? null,
      caller_name:  call.callerName,
      caller_phone: call.callerPhone,
      sdp:          call.sdp || null,
      started_at:   call.at,
    }));
    return apiSuccess({ ringing: list[0] || null, calls: list, shared });
  } catch (err) {
    if (err instanceof Error && err.message === 'UNAUTHORIZED') return apiError('Unauthorized', 401);
    console.error('[calling/ringing]', err);
    return apiError('Server error', 500);
  }
}
