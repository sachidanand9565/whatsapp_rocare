/**
 * GET /api/campaigns/[id]/contacts
 * Returns all contact IDs belonging to a campaign (for client-side inbox filtering).
 */
import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { query } from '@/lib/db';
import { apiSuccess, apiError } from '@/lib/utils';
import { RowDataPacket } from 'mysql2';

type Ctx = { params: { id: string } };

export async function GET(req: NextRequest, { params }: Ctx) {
  try {
    const payload    = requireAuth(req);
    const campaignId = Number(params.id);

    const rows = await query<RowDataPacket[]>(
      `SELECT cc.contact_id
       FROM campaign_contacts cc
       JOIN campaigns c ON c.id = cc.campaign_id
       WHERE cc.campaign_id = ? AND c.workspace_id = ?`,
      [campaignId, payload.workspaceId]
    );

    return apiSuccess({ contact_ids: rows.map((r) => r.contact_id as number) });
  } catch (err) {
    if (err instanceof Error && err.message === 'UNAUTHORIZED') return apiError('Unauthorized', 401);
    return apiError('Server error', 500);
  }
}
