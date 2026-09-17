/**
 * GET  /api/failed-webhooks  — list all failed-message webhooks for workspace
 * POST /api/failed-webhooks  — create new webhook (one or many campaigns)
 */
import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { query, insert } from '@/lib/db';
import { apiSuccess, apiError, utcNow } from '@/lib/utils';
import {
  linkTableExists, parseCampaignIds, ownedCampaignIds, setWebhookCampaigns,
} from '@/lib/failed-webhooks';
import { RowDataPacket } from 'mysql2';

export async function GET(req: NextRequest) {
  try {
    const payload = await requireAuth(req);
    const hooks = await query<RowDataPacket[]>(
      `SELECT id, name, campaign_id, api_url, api_method, api_headers, is_active, created_at
       FROM failed_msg_webhooks
       WHERE workspace_id = ?
       ORDER BY created_at DESC`,
      [payload.workspaceId]
    );

    // webhook id → [{ id, name }]
    const linked = new Map<number, { id: number; name: string }[]>();
    const push = (hookId: number, id: number, name: string) => {
      if (!linked.has(hookId)) linked.set(hookId, []);
      linked.get(hookId)!.push({ id, name });
    };

    if (await linkTableExists()) {
      const links = await query<RowDataPacket[]>(
        `SELECT x.webhook_id, c.id, c.name
         FROM failed_msg_webhook_campaigns x
         JOIN failed_msg_webhooks fw ON fw.id = x.webhook_id
         JOIN campaigns c            ON c.id  = x.campaign_id
         WHERE fw.workspace_id = ?
         ORDER BY c.name`,
        [payload.workspaceId]
      );
      for (const l of links) push(l.webhook_id as number, l.id as number, l.name as string);
    } else {
      const legacy = await query<RowDataPacket[]>(
        `SELECT fw.id AS webhook_id, c.id, c.name
         FROM failed_msg_webhooks fw
         JOIN campaigns c ON c.id = fw.campaign_id
         WHERE fw.workspace_id = ?`,
        [payload.workspaceId]
      );
      for (const l of legacy) push(l.webhook_id as number, l.id as number, l.name as string);
    }

    return apiSuccess(hooks.map((h) => {
      const campaigns = linked.get(h.id as number) || [];
      return { ...h, campaigns, campaign_ids: campaigns.map((c) => c.id) };
    }));
  } catch (err) {
    if (err instanceof Error && err.message === 'UNAUTHORIZED') return apiError('Unauthorized', 401);
    return apiError('Server error', 500);
  }
}

export async function POST(req: NextRequest) {
  try {
    const payload = await requireAuth(req);
    const body = await req.json();
    const { name, api_url, api_method, api_headers } = body;

    if (!name)    return apiError('name is required', 400);
    if (!api_url) return apiError('api_url is required', 400);

    const campaignIds = await ownedCampaignIds(payload.workspaceId, parseCampaignIds(body));
    if (campaignIds.length === 0) return apiError('Select at least one campaign', 400);

    const multi = await linkTableExists();
    if (!multi && campaignIds.length > 1) {
      return apiError('Multiple campaigns need migration-failed-webhook-campaigns.sql to be run first', 400);
    }

    const id = await insert(
      `INSERT INTO failed_msg_webhooks
         (workspace_id, name, campaign_id, api_url, api_method, api_headers, is_active, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 1, ?)`,
      [
        payload.workspaceId,
        name,
        campaignIds[0],
        api_url,
        api_method || 'POST',
        api_headers || null,
        utcNow(),
      ]
    );
    if (multi) await setWebhookCampaigns(id, campaignIds);
    return apiSuccess({ id });
  } catch (err) {
    if (err instanceof Error && err.message === 'UNAUTHORIZED') return apiError('Unauthorized', 401);
    return apiError('Server error', 500);
  }
}
