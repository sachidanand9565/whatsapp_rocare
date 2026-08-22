/**
 * POST /api/push/test — send a test notification to THIS user's subscribed
 * devices, so agents can verify the pipeline (subscription → push service →
 * OS notification) without waiting for a real call.
 * Returns { devices } — 0 means this user has no subscription saved yet.
 */
import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { apiSuccess, apiError } from '@/lib/utils';
import { sendPushToWorkspace } from '@/lib/push';

export async function POST(req: NextRequest) {
  try {
    const payload = await requireAuth(req);
    const { devices } = await sendPushToWorkspace(payload.workspaceId, {
      title: '📞 Test call alert',
      body:  'Push notifications are working on this device!',
      tag:   'push-test',
      url:   '/inbox',
    }, { userId: payload.userId });
    return apiSuccess({ devices });
  } catch (err) {
    if (err instanceof Error && err.message === 'UNAUTHORIZED') return apiError('Unauthorized', 401);
    console.error('[push/test]', err);
    return apiError('Server error', 500);
  }
}
