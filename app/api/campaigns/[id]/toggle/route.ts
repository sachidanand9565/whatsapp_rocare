/**
 * POST /api/campaigns/[id]/toggle
 * Flip a campaign between active ('running') and inactive ('paused').
 * Works for all campaign types — broadcast campaigns stop being processed
 * by the cron when inactive; API campaigns reject /send calls when inactive.
 */
import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { query, execute } from '@/lib/db';
import { apiSuccess, apiError, utcNow } from '@/lib/utils';
import { RowDataPacket } from 'mysql2';

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const payload    = requireAuth(req);
    const campaignId = Number(params.id);

    const camps = await query<RowDataPacket[]>(
      `SELECT c.status, c.campaign_type, w.access_token, w.phone_number_id
       FROM campaigns c
       JOIN workspaces w ON w.id = c.workspace_id
       WHERE c.id = ? AND c.workspace_id = ?`,
      [campaignId, payload.workspaceId]
    );
    if (camps.length === 0) return apiError('Campaign not found', 404);
    const camp = camps[0];

    if (['completed', 'failed'].includes(camp.status as string)) {
      return apiError(`Cannot toggle a ${camp.status as string} campaign`, 400);
    }

    if (camp.status === 'running') {
      await execute("UPDATE campaigns SET status = 'paused' WHERE id = ?", [campaignId]);
      return apiSuccess({ status: 'paused', message: 'Campaign deactivated — messages will stop sending' });
    }

    if (camp.campaign_type !== 'api' && (!camp.access_token || !camp.phone_number_id)) {
      return apiError('WhatsApp API not configured', 400);
    }

    await execute(
      "UPDATE campaigns SET status = 'running', started_at = COALESCE(started_at, ?) WHERE id = ?",
      [utcNow(), campaignId]
    );

    if (camp.campaign_type !== 'api') {
      await execute(
        `UPDATE campaign_contacts cc
         JOIN contacts c ON c.id = cc.contact_id
         SET cc.status = 'failed', cc.error = 'opted_out'
         WHERE cc.campaign_id = ? AND cc.status = 'pending' AND c.opted_in = 0`,
        [campaignId]
      );
    }

    return apiSuccess({ status: 'running', message: 'Campaign activated' });
  } catch (err: unknown) {
    if (err instanceof Error && err.message === 'UNAUTHORIZED') return apiError('Unauthorized', 401);
    console.error('[campaign toggle]', err);
    return apiError('Server error', 500);
  }
}
