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
      `SELECT t.content AS reply, COUNT(*) AS contacts
       FROM (
         SELECT m.contact_id,
                (SELECT bm.content FROM messages bm
                 WHERE bm.contact_id = m.contact_id AND bm.direction = 'inbound'
                   AND (bm.type = 'button' OR (bm.type = '' AND bm.content NOT LIKE '⚠%'))
                 ORDER BY bm.id DESC LIMIT 1) AS content
         FROM messages m
         WHERE m.workspace_id = ? AND m.direction = 'inbound'
           AND (m.type = 'button' OR (m.type = '' AND m.content NOT LIKE '⚠%'))
           AND m.created_at > DATE_SUB(NOW(), INTERVAL 90 DAY)
         GROUP BY m.contact_id
       ) t
       WHERE t.content IS NOT NULL AND t.content != '' AND CHAR_LENGTH(t.content) <= 30
       GROUP BY t.content
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
