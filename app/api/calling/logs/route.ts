/**
 * GET /api/calling/logs — call history for the Calls page
 *   ?q=            name / phone search
 *   ?direction=    inbound | outbound
 *   ?status=       completed | missed | rejected | ringing
 *   ?page=&limit=
 * Returns { stats, calls, pagination }
 */
import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { query } from '@/lib/db';
import { apiSuccess, apiError } from '@/lib/utils';
import { RowDataPacket } from 'mysql2';

export async function GET(req: NextRequest) {
  try {
    const payload = await requireAuth(req);
    const sp = req.nextUrl.searchParams;
    const q         = (sp.get('q') || '').trim();
    const direction = sp.get('direction') || '';
    const status    = sp.get('status') || '';
    const page      = Math.max(1, Number(sp.get('page') || 1));
    const limit     = Math.min(100, Math.max(1, Number(sp.get('limit') || 50)));
    const offset    = (page - 1) * limit;

    const where: string[] = ['cl.workspace_id = ?'];
    const params: (string | number)[] = [payload.workspaceId];
    if (direction === 'inbound' || direction === 'outbound') { where.push('cl.direction = ?'); params.push(direction); }
    if (['completed', 'missed', 'rejected', 'ringing', 'failed'].includes(status)) { where.push('cl.status = ?'); params.push(status); }
    if (q) {
      where.push('(c.name LIKE ? OR c.phone LIKE ?)');
      params.push(`%${q}%`, `%${q.replace(/\D/g, '') || q}%`);
    }
    const whereSql = where.join(' AND ');

    let stats = { incoming: 0, outgoing: 0, completed: 0, missed: 0, talk_seconds: 0 };
    let calls: RowDataPacket[] = [];
    let total = 0;
    try {
      const s = await query<RowDataPacket[]>(
        `SELECT
           COALESCE(SUM(direction = 'inbound'), 0)                    AS incoming,
           COALESCE(SUM(direction = 'outbound'), 0)                   AS outgoing,
           COALESCE(SUM(status = 'completed'), 0)                     AS completed,
           COALESCE(SUM(status IN ('missed','rejected')), 0)          AS missed,
           COALESCE(SUM(IF(status = 'completed', duration_sec, 0)), 0) AS talk_seconds
         FROM call_logs WHERE workspace_id = ?`,
        [payload.workspaceId]
      );
      stats = {
        incoming: Number(s[0]?.incoming || 0), outgoing: Number(s[0]?.outgoing || 0),
        completed: Number(s[0]?.completed || 0), missed: Number(s[0]?.missed || 0),
        talk_seconds: Number(s[0]?.talk_seconds || 0),
      };

      const cnt = await query<RowDataPacket[]>(
        `SELECT COUNT(*) AS total FROM call_logs cl LEFT JOIN contacts c ON c.id = cl.contact_id WHERE ${whereSql}`,
        params
      );
      total = Number(cnt[0]?.total || 0);

      calls = await query<RowDataPacket[]>(
        `SELECT cl.id, cl.call_id, cl.direction, cl.status, cl.duration_sec,
                cl.started_at, cl.answered_at, cl.ended_at, cl.created_at,
                cl.contact_id, c.name AS contact_name, c.phone AS contact_phone,
                cl.agent_id, u.name AS agent_name
         FROM call_logs cl
         LEFT JOIN contacts c ON c.id = cl.contact_id
         LEFT JOIN users u    ON u.id = cl.agent_id
         WHERE ${whereSql}
         ORDER BY cl.created_at DESC, cl.id DESC
         LIMIT ? OFFSET ?`,
        [...params, limit, offset]
      );
    } catch (e) {
      if ((e as { code?: string })?.code === 'ER_NO_SUCH_TABLE') {
        return apiSuccess({ stats, calls: [], pagination: { page, limit, total: 0, pages: 0 }, migration_needed: true });
      }
      throw e;
    }

    return apiSuccess({ stats, calls, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
  } catch (err: unknown) {
    if (err instanceof Error && err.message === 'UNAUTHORIZED') return apiError('Unauthorized', 401);
    console.error('[calling/logs]', err);
    return apiError('Server error', 500);
  }
}
