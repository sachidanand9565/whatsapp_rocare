/**
 * GET /api/agents/chat-stats?period=today|7d|30d — per team member of this project:
 *   assigned   chats given to them in the period (auto-assign or transfer)
 *   resolved   chats they resolved in the period
 *   new        right now: their chats (last 24h) not yet intervened or resolved
 *   intervened right now: their chats in the Intervened state
 * assigned/resolved come from agent_chat_events (counting starts when
 * migration-agent-chat-events.sql runs); new/intervened are live.
 * "today" starts at midnight India time.
 */
import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { query } from '@/lib/db';
import { apiSuccess, apiError } from '@/lib/utils';
import { RowDataPacket } from 'mysql2';

const IST_MS = 5.5 * 60 * 60 * 1000;

function periodStartUtc(period: string): string {
  const now = Date.now();
  let start: number;
  if (period === '7d') start = now - 7 * 86_400_000;
  else if (period === '30d') start = now - 30 * 86_400_000;
  else {
    const ist = new Date(now + IST_MS);
    start = Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate()) - IST_MS;
  }
  return new Date(start).toISOString().slice(0, 19).replace('T', ' ');
}

export async function GET(req: NextRequest) {
  try {
    const payload = await requireAuth(req);
    if (!['admin', 'manager'].includes(payload.role)) return apiError('Admin or Manager only', 403);
    const period = new URL(req.url).searchParams.get('period') || 'today';
    const since = periodStartUtc(period);

    const [events, live] = await Promise.all([
      query<RowDataPacket[]>(
        `SELECT user_id, event, COUNT(DISTINCT contact_id) AS n
         FROM agent_chat_events
         WHERE workspace_id = ? AND created_at >= ? AND event IN ('assigned','resolved')
         GROUP BY user_id, event`,
        [payload.workspaceId, since]
      ).catch(() => [] as RowDataPacket[]),   // table missing before the migration
      query<RowDataPacket[]>(
        `SELECT assigned_agent_id AS user_id,
           SUM(chat_status = 'intervened') AS intervened,
           SUM((chat_status IS NULL OR chat_status NOT IN ('intervened','resolved'))
               AND last_inbound_at > DATE_SUB(UTC_TIMESTAMP(), INTERVAL 24 HOUR)) AS new_chats
         FROM contacts
         WHERE workspace_id = ? AND assigned_agent_id IS NOT NULL
         GROUP BY assigned_agent_id`,
        [payload.workspaceId]
      ),
    ]);

    const stats: Record<number, { assigned: number; resolved: number; new: number; intervened: number }> = {};
    const row = (id: number) => (stats[id] ||= { assigned: 0, resolved: 0, new: 0, intervened: 0 });
    for (const e of events) row(Number(e.user_id))[e.event as 'assigned' | 'resolved'] = Number(e.n);
    for (const l of live) {
      const r = row(Number(l.user_id));
      r.new = Number(l.new_chats) || 0;
      r.intervened = Number(l.intervened) || 0;
    }
    return apiSuccess({ period, stats });
  } catch (err) {
    if (err instanceof Error && err.message === 'UNAUTHORIZED') return apiError('Unauthorized', 401);
    console.error('[agents/chat-stats]', err);
    return apiError('Server error', 500);
  }
}
