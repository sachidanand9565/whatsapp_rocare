/**
 * GET    /api/push/subscribe — { public_key } VAPID key for the browser
 * POST   /api/push/subscribe — save this browser's push subscription
 * DELETE /api/push/subscribe — remove it (body: { endpoint })
 */
import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { apiSuccess, apiError } from '@/lib/utils';
import { getVapidKeys, saveSubscription, deleteSubscription, PushSubscriptionInput } from '@/lib/push';

export async function GET(req: NextRequest) {
  try {
    await requireAuth(req);
    const vapid = await getVapidKeys();
    if (!vapid) return apiError('Push not set up on the server — run migration-push.sql', 503);
    return apiSuccess({ public_key: vapid.publicKey });
  } catch (err) {
    if (err instanceof Error && err.message === 'UNAUTHORIZED') return apiError('Unauthorized', 401);
    console.error('[push/subscribe GET]', err);
    return apiError('Server error', 500);
  }
}

export async function POST(req: NextRequest) {
  try {
    const payload = await requireAuth(req);
    const body = await req.json() as { subscription?: PushSubscriptionInput };
    const sub = body.subscription;
    if (!sub?.endpoint || !sub?.keys?.p256dh || !sub?.keys?.auth) {
      return apiError('subscription {endpoint, keys:{p256dh, auth}} is required', 400);
    }
    try {
      await saveSubscription(payload.workspaceId, payload.userId, sub);
    } catch (e) {
      if ((e as { code?: string })?.code === 'ER_NO_SUCH_TABLE') {
        return apiError('Run migration-push.sql first — push tables are missing', 503);
      }
      throw e;
    }
    return apiSuccess({ subscribed: true });
  } catch (err) {
    if (err instanceof Error && err.message === 'UNAUTHORIZED') return apiError('Unauthorized', 401);
    console.error('[push/subscribe POST]', err);
    return apiError('Server error', 500);
  }
}

export async function DELETE(req: NextRequest) {
  try {
    await requireAuth(req);
    const body = await req.json().catch(() => ({})) as { endpoint?: string };
    if (!body.endpoint) return apiError('endpoint is required', 400);
    await deleteSubscription(body.endpoint);
    return apiSuccess({ unsubscribed: true });
  } catch (err) {
    if (err instanceof Error && err.message === 'UNAUTHORIZED') return apiError('Unauthorized', 401);
    console.error('[push/subscribe DELETE]', err);
    return apiError('Server error', 500);
  }
}
