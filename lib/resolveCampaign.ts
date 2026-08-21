/**
 * Resolve the [id] URL segment of the campaign API endpoints.
 * Accepts, in order:
 *   1. a raw numeric DB id            → /api/campaigns/42/send        (legacy)
 *   2. an encryptId() token           → /api/campaigns/TxZk…/send     (legacy — salted, changes every render)
 *   3. the campaign NAME (url-encoded)→ /api/campaigns/Diwali%20Offer/send  (stable, recommended)
 * Name matching is case-insensitive within the workspace, api campaigns only;
 * if two campaigns share a name the newest one wins.
 */
import { query } from '@/lib/db';
import { decryptId } from '@/lib/idCrypt';
import { RowDataPacket } from 'mysql2';

export async function resolveCampaignId(idParam: string, workspaceId: number): Promise<number> {
  if (/^\d+$/.test(idParam)) return Number(idParam);

  const decrypted = decryptId(idParam);
  if (decrypted) return Number(decrypted);

  let name = idParam;
  try { name = decodeURIComponent(idParam); } catch { /* keep raw */ }
  name = name.trim();
  if (!name) return 0;
  const rows = await query<RowDataPacket[]>(
    `SELECT id FROM campaigns
     WHERE workspace_id = ? AND campaign_type = 'api' AND LOWER(name) = LOWER(?)
     ORDER BY id DESC LIMIT 1`,
    [workspaceId, name]
  );
  return (rows[0]?.id as number) || 0;
}
