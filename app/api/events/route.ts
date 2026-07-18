/**
 * GET /api/events?token=<jwt>
 * Server-Sent Events stream — pushes new_message events to the inbox in real-time.
 * EventSource (browser) cannot send custom headers, so the JWT is passed as a query param.
 */
import { NextRequest } from 'next/server';
import { verifyToken } from '@/lib/auth';
import { subscribeSSE, SSEPayload } from '@/lib/sse';
import { getContactForAgent } from '@/lib/contacts';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token');
  if (!token) return new Response('Unauthorized', { status: 401 });

  let workspaceId: number, userId: number, role: string;
  try {
    const decoded = verifyToken(token);
    workspaceId = decoded.workspaceId;
    userId      = decoded.userId;
    role        = decoded.role;
  } catch {
    return new Response('Unauthorized', { status: 401 });
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      const enqueue = (data: object) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        } catch {
          // client already disconnected
        }
      };

      // Confirm connection
      enqueue({ type: 'connected' });

      // Forward workspace events to this SSE client. For events that affect the
      // contact list, enrich with this agent's view of the contact so the inbox
      // can upsert locally instead of re-fetching /api/contacts on every event.
      const unsubscribe = subscribeSSE(workspaceId, (payload: SSEPayload) => {
        if ((payload.type === 'new_message' || payload.type === 'chat_status_update') && payload.contactId) {
          getContactForAgent(workspaceId, payload.contactId, userId, role)
            .then(({ contact, inInbox, inIntervened }) => {
              enqueue({ ...payload, contact, inInbox, inIntervened });
            })
            .catch(() => enqueue(payload));
        } else {
          enqueue(payload);
        }
      });

      // Keep-alive ping every 25 s (proxies drop idle SSE streams)
      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(': ping\n\n'));
        } catch {
          clearInterval(heartbeat);
          unsubscribe();
        }
      }, 25_000);

      // Clean up when client disconnects
      req.signal.addEventListener('abort', () => {
        clearInterval(heartbeat);
        unsubscribe();
        try { controller.close(); } catch { /* already closed */ }
      });
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type':  'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection':    'keep-alive',
      'X-Accel-Buffering': 'no', // disable nginx buffering
    },
  });
}
