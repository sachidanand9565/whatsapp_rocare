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

    // Check both campaign_contacts (explicit) and messages (outbound sends)
    // so contacts who received the campaign appear even if campaign_contacts is empty
    const rows = await query<RowDataPacket[]>(
      `SELECT DISTINCT t.contact_id
       FROM (
         SELECT cc.contact_id
         FROM campaign_contacts cc
         JOIN campaigns c ON c.id = cc.campaign_id
         WHERE cc.campaign_id = ? AND c.workspace_id = ?
         UNION
         SELECT m.contact_id
         FROM messages m
         JOIN campaigns c ON c.id = m.campaign_id
         WHERE m.campaign_id = ? AND m.direction = 'outbound' AND c.workspace_id = ?
       ) t`,
      [campaignId, payload.workspaceId, campaignId, payload.workspaceId]
    );

    return apiSuccess({ contact_ids: rows.map((r) => Number(r.contact_id)) });
  } catch (err) {
    if (err instanceof Error && err.message === 'UNAUTHORIZED') return apiError('Unauthorized', 401);
    return apiError('Server error', 500);
  }
}
