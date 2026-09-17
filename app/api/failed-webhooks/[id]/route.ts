/**
 * PATCH  /api/failed-webhooks/[id]  — toggle active / edit fields
 * DELETE /api/failed-webhooks/[id]  — delete webhook
 */
import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { query, execute } from '@/lib/db';
import { apiSuccess, apiError } from '@/lib/utils';
import {
  linkTableExists, parseCampaignIds, ownedCampaignIds, setWebhookCampaigns,
} from '@/lib/failed-webhooks';
import { RowDataPacket } from 'mysql2';

type Ctx = { params: { id: string } };

export async function PATCH(req: NextRequest, { params }: Ctx) {
  try {
    const payload = await requireAuth(req);
    const body = await req.json();
    const id = Number(params.id);

    const owned = await query<RowDataPacket[]>(
      'SELECT id FROM failed_msg_webhooks WHERE id = ? AND workspace_id = ? LIMIT 1',
      [id, payload.workspaceId]
    );
    if (owned.length === 0) return apiError('Not found', 404);

    // Build SET dynamically — toggle-only and full edits share this endpoint
    const sets: string[] = [];
    const vals: (string | number | null)[] = [];
    if ('is_active' in body)   { sets.push('is_active = ?');   vals.push(body.is_active ? 1 : 0); }
    if ('name' in body)        { sets.push('name = ?');        vals.push(body.name); }
    if ('api_url' in body)     { sets.push('api_url = ?');     vals.push(body.api_url); }
    if ('api_method' in body)  { sets.push('api_method = ?');  vals.push(body.api_method || 'POST'); }
    if ('api_headers' in body) { sets.push('api_headers = ?'); vals.push(body.api_headers || null); }

    let campaignIds: number[] | null = null;
    if ('campaign_ids' in body || 'campaign_id' in body) {
      campaignIds = await ownedCampaignIds(payload.workspaceId, parseCampaignIds(body));
      if (campaignIds.length === 0) return apiError('Select at least one campaign', 400);
      if (!(await linkTableExists()) && campaignIds.length > 1) {
        return apiError('Multiple campaigns need migration-failed-webhook-campaigns.sql to be run first', 400);
      }
      // First selected campaign stays in the legacy column
      sets.push('campaign_id = ?');
      vals.push(campaignIds[0]);
    }
    if (sets.length === 0) return apiError('Nothing to update', 400);

    await execute(
      `UPDATE failed_msg_webhooks SET ${sets.join(', ')} WHERE id = ? AND workspace_id = ?`,
      [...vals, id, payload.workspaceId]
    );
    if (campaignIds && (await linkTableExists())) await setWebhookCampaigns(id, campaignIds);
    return apiSuccess({ updated: true });
  } catch (err) {
    if (err instanceof Error && err.message === 'UNAUTHORIZED') return apiError('Unauthorized', 401);
    return apiError('Server error', 500);
  }
}

export async function DELETE(req: NextRequest, { params }: Ctx) {
  try {
    const payload = await requireAuth(req);
    // Campaign links are removed by ON DELETE CASCADE
    await execute(
      'DELETE FROM failed_msg_webhooks WHERE id = ? AND workspace_id = ?',
      [Number(params.id), payload.workspaceId]
    );
    return apiSuccess({ deleted: true });
  } catch (err) {
    if (err instanceof Error && err.message === 'UNAUTHORIZED') return apiError('Unauthorized', 401);
    return apiError('Server error', 500);
  }
}
