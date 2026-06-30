/**
 * POST /api/campaigns/[id]/stop
 * Pause a running broadcast — cron stops processing it immediately.
 */
import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { query, execute } from '@/lib/db';
import { apiSuccess, apiError } from '@/lib/utils';
import { RowDataPacket } from 'mysql2';

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const payload    = await requireAuth(req);
    const campaignId = Number(params.id);

    const camps = await query<RowDataPacket[]>(
      'SELECT status FROM campaigns WHERE id = ? AND workspace_id = ?',
      [campaignId, payload.workspaceId]
    );
    if (camps.length === 0) return apiError('Campaign not found', 404);
    if (camps[0].status !== 'running') return apiError('Campaign is not running', 400);

    await execute(
      "UPDATE campaigns SET status = 'paused' WHERE id = ?",
      [campaignId]
    );

    return apiSuccess({ message: 'Campaign paused — pending messages will not be sent' });
  } catch (err: unknown) {
    if (err instanceof Error && err.message === 'UNAUTHORIZED') return apiError('Unauthorized', 401);
    return apiError('Server error', 500);
  }
}
