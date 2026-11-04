/**
 * POST /api/sse-relay
 * Dusre panel (same DB) ka server yahan live events bhejta hai (lib/sse.ts relaySSE).
 * Event sirf is server ke inbox/subscribers ko emit hota hai — DB me kuch save nahi hota,
 * kyunki message pehle hi webhook wale server ne save kar diya hai.
 */
import { NextRequest } from 'next/server';
import { timingSafeEqual } from 'crypto';
import { emitLocalSSE, SSEPayload } from '@/lib/sse';
import { setRinging, clearRinging } from '@/lib/activeCalls';
import { apiSuccess, apiError } from '@/lib/utils';
import { autoAssignContact } from '@/lib/autoAssign';

function secretMatches(given: string | null, expected: string) {
  if (!given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(req: NextRequest) {
  const secret = process.env.SSE_RELAY_SECRET || '';
  if (!secret || !secretMatches(req.headers.get('x-relay-secret'), secret)) {
    return apiError('Unauthorized', 401);
  }

  let payload: SSEPayload;
  try {
    payload = await req.json();
  } catch {
    return apiError('Bad Request', 400);
  }
  if (!payload || typeof payload.workspaceId !== 'number' || typeof payload.type !== 'string') {
    return apiError('Invalid payload', 400);
  }

  // Ringing state bhi yahan rakho — webhook dusre server pe set karta hai, aur
  // push-notification tap se khula panel GET /api/calling/ringing se popup dikhata hai.
  if (payload.type === 'incoming_call' && payload.callId) {
    await setRinging(payload.workspaceId, {
      callId:      payload.callId,
      contactId:   payload.contactId,
      callerName:  payload.callerName || '',
      callerPhone: payload.callerPhone || '',
      sdp:         payload.sdp,
    });
  } else if (payload.type === 'call_ended' || payload.type === 'call_taken') {
    await clearRinging(payload.workspaceId, payload.callId);
  }

  // Auto-assign (projects that turned it on) — before the emit, so the inbox
  // push already shows the chat to its new owner only.
  if (payload.type === 'new_message' && payload.direction === 'inbound' && payload.contactId) {
    try {
      await autoAssignContact(payload.workspaceId, payload.contactId);
    } catch (err) {
      console.error('[sse-relay] auto-assign failed', err);
    }
  }

  emitLocalSSE(payload);
  return apiSuccess({ ok: true });
}
