/**
 * lib/activeCalls.ts — in-memory calls currently ringing, per workspace.
 *
 * SSE has no replay: a panel opened AFTER the incoming_call event (e.g. the
 * agent tapped the push notification) would never learn about the ringing
 * call. The webhook records it here; GET /api/calling/ringing serves it so a
 * freshly opened CallManager can show the popup mid-ring.
 * Several customers can ring the same number at once (one agent busy on a
 * call, the others still free) — so this keeps every ringing call, by call id.
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

const ringing = new Map<number, Map<string, RingingCall>>();

export function setRinging(workspaceId: number, call: Omit<RingingCall, 'at'>) {
  let calls = ringing.get(workspaceId);
  if (!calls) { calls = new Map(); ringing.set(workspaceId, calls); }
  calls.set(call.callId, { ...call, at: Date.now() });
}

/** Clear when the call is answered/rejected/ended. callId omitted = clear all. */
export function clearRinging(workspaceId: number, callId?: string) {
  const calls = ringing.get(workspaceId);
  if (!calls) return;
  if (callId) calls.delete(callId); else calls.clear();
  if (calls.size === 0) ringing.delete(workspaceId);
}

/** Every call still ringing in this workspace, oldest first. */
export function getRingingCalls(workspaceId: number): RingingCall[] {
  const calls = ringing.get(workspaceId);
  if (!calls) return [];
  const now = Date.now();
  for (const [id, c] of Array.from(calls)) if (now - c.at > TTL_MS) calls.delete(id);
  if (calls.size === 0) { ringing.delete(workspaceId); return []; }
  return Array.from(calls.values()).sort((a, b) => a.at - b.at);
}
