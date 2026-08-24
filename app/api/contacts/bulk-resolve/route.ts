/**
 * POST /api/contacts/bulk-resolve  (admin only)
 * Resolve EVERY chat whose latest button reply matches — e.g. all
 * "Not Interested" taps in one go. Optionally scoped to one campaign.
 * Body: { button_reply: "Not Interested", campaign_id?: 12 }
 * → { resolved: n }
 */
import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { query, execute } from '@/lib/db';
import { apiSuccess, apiError } from '@/lib/utils';
import { RowDataPacket } from 'mysql2';

export async function POST(req: NextRequest) {
  try {
    const payload = await requireAuth(req);
    if (payload.role !== 'admin') return apiError('Admin only', 403);

    const body = await req.json() as { button_reply?: string; campaign_id?: number };
    const buttonReply = String(body.button_reply || '').trim();
    if (!buttonReply) return apiError('button_reply is required', 400);
    const campaignId = Number(body.campaign_id) || 0;

    // Same "latest tap wins" rule as the inbox filter, so what you see is what
    // gets resolved. Only currently-unresolved chats count toward the total.
    let sql = `
      UPDATE contacts c SET c.chat_status = 'resolved'
      WHERE c.workspace_id = ?
        AND (c.chat_status IS NULL OR c.chat_status != 'resolved')
        AND (SELECT bm.content FROM messages bm
             WHERE bm.contact_id = c.id AND bm.direction = 'inbound'
               AND (bm.type = 'button' OR (bm.type = '' AND bm.content NOT LIKE '⚠%'))
             ORDER BY bm.id DESC LIMIT 1) = ?`;
    const params: unknown[] = [payload.workspaceId, buttonReply];
    if (campaignId) {
      sql += ` AND c.id IN (
        SELECT contact_id FROM campaign_contacts WHERE campaign_id = ?
        UNION
        SELECT contact_id FROM messages WHERE campaign_id = ? AND direction = 'outbound'
      )`;
      params.push(campaignId, campaignId);
    }

    const resolved = await execute(sql, params);   // lib/db execute() returns affectedRows

    // Audit trail in server logs — bulk actions should be traceable
    const u = await query<RowDataPacket[]>('SELECT email FROM users WHERE id = ? LIMIT 1', [payload.userId]).catch(() => []);
    console.log(`[bulk-resolve] ${resolved} chats resolved (reply="${buttonReply}"${campaignId ? `, campaign=${campaignId}` : ''}) by ${(u as RowDataPacket[])[0]?.email || payload.userId}`);

    return apiSuccess({ resolved });
  } catch (err) {
    if (err instanceof Error && err.message === 'UNAUTHORIZED') return apiError('Unauthorized', 401);
    console.error('[contacts/bulk-resolve]', err);
    return apiError('Server error', 500);
  }
}
