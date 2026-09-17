/**
 * Failed-message webhooks can fire for many campaigns.
 * Links live in failed_msg_webhook_campaigns (migration-failed-webhook-campaigns.sql);
 * failed_msg_webhooks.campaign_id keeps the first selected campaign for older code.
 * Until the migration runs we fall back to that single column.
 */
import { query, execute } from '@/lib/db';
import { RowDataPacket } from 'mysql2';

// Only cache the positive answer so running the migration is picked up without a restart
let linkTableReady = false;

export async function linkTableExists(): Promise<boolean> {
  if (linkTableReady) return true;
  try {
    await query('SELECT 1 FROM failed_msg_webhook_campaigns LIMIT 1');
    linkTableReady = true;
  } catch { /* table not migrated yet */ }
  return linkTableReady;
}

/** Accepts `campaign_ids: number[]` or the legacy `campaign_id`, returns unique positive ids. */
export function parseCampaignIds(body: { campaign_ids?: unknown; campaign_id?: unknown }): number[] {
  const raw = Array.isArray(body.campaign_ids) ? body.campaign_ids : [body.campaign_id];
  const ids = raw.map(Number).filter((n) => Number.isInteger(n) && n > 0);
  return Array.from(new Set(ids));
}

/** Drops ids that don't belong to the workspace; keeps the caller's order. */
export async function ownedCampaignIds(workspaceId: number, ids: number[]): Promise<number[]> {
  if (ids.length === 0) return [];
  const rows = await query<RowDataPacket[]>(
    `SELECT id FROM campaigns WHERE workspace_id = ? AND id IN (${ids.map(() => '?').join(',')})`,
    [workspaceId, ...ids]
  );
  const owned = new Set(rows.map((r) => r.id as number));
  return ids.filter((id) => owned.has(id));
}

export async function setWebhookCampaigns(webhookId: number, campaignIds: number[]) {
  await execute('DELETE FROM failed_msg_webhook_campaigns WHERE webhook_id = ?', [webhookId]);
  if (campaignIds.length === 0) return;
  await execute(
    `INSERT INTO failed_msg_webhook_campaigns (webhook_id, campaign_id)
     VALUES ${campaignIds.map(() => '(?, ?)').join(', ')}`,
    campaignIds.flatMap((cid) => [webhookId, cid])
  );
}
