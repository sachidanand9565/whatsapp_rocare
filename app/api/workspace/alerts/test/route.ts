/**
 * POST /api/workspace/alerts/test — send one real alert email to the configured
 * recipients so the workspace knows the address actually works.
 */
import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { apiSuccess, apiError } from '@/lib/utils';
import { sendTestAlert } from '@/lib/alerts';

export async function POST(req: NextRequest) {
  try {
    const payload = await requireAuth(req);
    const emails  = await sendTestAlert(payload.workspaceId);
    return apiSuccess({ sent: true, recipients: emails });
  } catch (err) {
    if (err instanceof Error && err.message === 'UNAUTHORIZED') return apiError('Unauthorized', 401);
    console.error('[workspace/alerts test]', err);
    return apiError(err instanceof Error ? err.message : 'Could not send the test email', 400);
  }
}
