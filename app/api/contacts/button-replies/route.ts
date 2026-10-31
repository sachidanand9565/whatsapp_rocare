/**
 * GET /api/contacts/button-replies
 * Distinct template-button replies received in this workspace (last 90 days),
 * with how many contacts' LATEST tap is that reply — feeds the inbox
 * "Filter by button reply" dropdown (e.g. Interested / Not Interested).
 */
import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { query } from '@/lib/db';
import { apiSuccess, apiError } from '@/lib/utils';
import { RowDataPacket } from 'mysql2';

export async function GET(req: NextRequest) {
  try {
    const payload = await requireAuth(req);
    const rows = await query<RowDataPacket[]>(
      // type ENUM predates 'button': legacy rows have type='' — match both.
      // CHAR_LENGTH cap keeps stray non-button '' rows out (WA button text ≤ 25 chars).
      // Latest tap per contact in ONE grouped pass (MAX(id)) — the old per-contact
      // subquery re-read every message of every contact and timed out on big
      // accounts. Same result: a contact who tapped in the last 90 days has their
      // latest tap inside that window too.
      `SELECT bm.content AS reply, COUNT(*) AS contacts
       FROM (
         SELECT contact_id, MAX(id) AS last_id
         FROM messages
         WHERE workspace_id = ? AND direction = 'inbound'
           AND type IN ('button', '') AND (type = 'button' OR content NOT LIKE '⚠%')
           AND created_at > DATE_SUB(NOW(), INTERVAL 90 DAY)
         GROUP BY contact_id
       ) t
       JOIN messages bm ON bm.id = t.last_id
       WHERE bm.content IS NOT NULL AND bm.content != '' AND CHAR_LENGTH(bm.content) <= 30
       GROUP BY bm.content
       ORDER BY contacts DESC
       LIMIT 25`,
      [payload.workspaceId]
    );
    return apiSuccess({ replies: rows.map((r) => ({ reply: r.reply as string, contacts: Number(r.contacts) })) });
  } catch (err) {
    if (err instanceof Error && err.message === 'UNAUTHORIZED') return apiError('Unauthorized', 401);
    console.error('[contacts/button-replies]', err);
    return apiError('Server error', 500);
  }
}
