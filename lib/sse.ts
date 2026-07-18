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
  type:        'new_message' | 'status_update' | 'chat_status_update' | 'campaign_update';
  workspaceId: number;
  contactId?:  number;
  direction?:  'inbound' | 'outbound';
  wamid?:      string;   // for status_update
  status?:     string;   // for status_update
  chatStatus?: string;   // for chat_status_update
  campaignId?: number;   // for campaign_update
  // Filled in per-subscriber by app/api/events/route.ts (not by emitSSE callers) so
  // the inbox can upsert its contact list from the push instead of re-fetching it.
  contact?:      Contact | null;
  inInbox?:      boolean;
  inIntervened?: boolean;
}

/** Called from the webhook handler after a message is persisted. */
export function emitSSE(payload: SSEPayload) {
  emitter.emit(`ws:${payload.workspaceId}`, payload);
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
