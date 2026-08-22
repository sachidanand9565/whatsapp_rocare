/**
 * lib/activeCalls.ts — in-memory "currently ringing" call per workspace.
 *
 * SSE has no replay: a panel opened AFTER the incoming_call event (e.g. the
 * agent tapped the push notification) would never learn about the ringing
 * call. The webhook records it here; GET /api/calling/ringing serves it so a
 * freshly opened CallManager can show the popup mid-ring.
 * Single Node process (same as SSE/emitter) — no external store needed.
 */

export interface RingingCall {
  callId:      string;
  contactId?:  number;
  callerName:  string;
  callerPhone: string;
  sdp?:        string;   // caller's SDP offer — needed to answer
  at:          number;   // Date.now() when ringing started
}

// WhatsApp rings out in ~60s; keep a small buffer then treat as stale.
const TTL_MS = 75_000;

const ringing = new Map<number, RingingCall>();

export function setRinging(workspaceId: number, call: Omit<RingingCall, 'at'>) {
  ringing.set(workspaceId, { ...call, at: Date.now() });
}

/** Clear when the call is answered/rejected/ended. callId omitted = clear any. */
export function clearRinging(workspaceId: number, callId?: string) {
  const cur = ringing.get(workspaceId);
  if (cur && (!callId || cur.callId === callId)) ringing.delete(workspaceId);
}

export function getRinging(workspaceId: number): RingingCall | null {
  const cur = ringing.get(workspaceId);
  if (!cur) return null;
  if (Date.now() - cur.at > TTL_MS) { ringing.delete(workspaceId); return null; }
  return cur;
}
