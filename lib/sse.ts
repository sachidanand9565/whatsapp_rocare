/**
 * lib/sse.ts
 * In-process pub/sub for Server-Sent Events.
 * Works as long as the app runs in a single Node.js process (dev + typical prod).
 */
import { EventEmitter } from 'events';
import { Contact } from '@/types';

const emitter = new EventEmitter();
emitter.setMaxListeners(500);

export interface SSEPayload {
  type:        'new_message' | 'status_update' | 'chat_status_update' | 'campaign_update' | 'incoming_call' | 'call_ended' | 'call_answer' | 'call_taken';
  workspaceId: number;
  contactId?:  number;
  direction?:  'inbound' | 'outbound';
  wamid?:      string;   // for status_update
  status?:     string;   // for status_update
  chatStatus?: string;   // for chat_status_update
  campaignId?: number;   // for campaign_update
  callId?:     string;   // for incoming_call / call_ended / call_answer
  callerPhone?: string;  // for incoming_call
  callerName?:  string;  // for incoming_call
  sdp?:         string;  // for incoming_call: caller's WebRTC SDP offer
                         // for call_answer (business-initiated): callee's SDP answer
  callDirection?: 'inbound' | 'outbound';
  agentName?:   string;  // for call_taken: who answered, so other panels can say so
  // Filled in per-subscriber by app/api/events/route.ts (not by emitSSE callers) so
  // the inbox can upsert its contact list from the push instead of re-fetching it.
  contact?:      Contact | null;
  inInbox?:      boolean;
  inIntervened?: boolean;
}

// Same DB pe chal rahe dusre panel(s) ko bhi live events bhejo — webhook sirf ek
// server pe aata hai, to baaki panels ka inbox isi relay se turant update hota hai.
//   SSE_RELAY_URLS   = https://panel2.limbu.ai/api/sse-relay   (comma-separated)
//   SSE_RELAY_SECRET = dono servers pe same random string
const RELAY_URLS = (process.env.SSE_RELAY_URLS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const RELAY_SECRET = process.env.SSE_RELAY_SECRET || '';

/** Called from the webhook handler after a message is persisted. */
export function emitSSE(payload: SSEPayload) {
  emitLocalSSE(payload);
  relaySSE(payload);
}

/** Sirf is process ke subscribers ko — relay se aaye events ke liye (aage forward nahi, loop na bane). */
export function emitLocalSSE(payload: SSEPayload) {
  emitter.emit(`ws:${payload.workspaceId}`, payload);
}

function relaySSE(payload: SSEPayload) {
  if (!RELAY_URLS.length || !RELAY_SECRET) return;
  const body = JSON.stringify(payload);
  for (const url of RELAY_URLS) {
    fetch(url, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'x-relay-secret': RELAY_SECRET },
      body,
      signal:  AbortSignal.timeout(3000),
    }).catch((e) => console.warn(`[sse-relay] ${url} failed:`, String(e)));
  }
}

/** Subscribe to events for a workspace. Returns an unsubscribe function. */
export function subscribeSSE(
  workspaceId: number,
  cb: (payload: SSEPayload) => void,
): () => void {
  const key = `ws:${workspaceId}`;
  emitter.on(key, cb);
  return () => emitter.off(key, cb);
}
