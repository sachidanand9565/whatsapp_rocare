/**
 * POST /api/sse-relay
 * Dusre panel (same DB) ka server yahan live events bhejta hai (lib/sse.ts relaySSE).
 * Event sirf is server ke inbox/subscribers ko emit hota hai — DB me kuch save nahi hota,
 * kyunki message pehle hi webhook wale server ne save kar diya hai.
 */
import { NextRequest } from 'next/server';
import { timingSafeEqual } from 'crypto';
import { emitLocalSSE, SSEPayload } from '@/lib/sse';
import { apiSuccess, apiError } from '@/lib/utils';

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

  emitLocalSSE(payload);
  return apiSuccess({ ok: true });
}
