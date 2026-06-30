/**
 * GET /api/admin/stats — platform-wide overview (super-admin only)
 */
import { NextRequest } from 'next/server';
import { requireSuperAdmin } from '@/lib/admin';
import { query } from '@/lib/db';
import { apiSuccess, apiError } from '@/lib/utils';
import { RowDataPacket } from 'mysql2';

export async function GET(req: NextRequest) {
  try {
    await requireSuperAdmin(req);

    const [tot, byPlan, msg7, recent] = await Promise.all([
      query<RowDataPacket[]>(
        `SELECT
           (SELECT COUNT(*) FROM workspaces)                          AS workspaces,
           (SELECT COUNT(*) FROM workspaces WHERE is_active = 1)      AS active_workspaces,
           (SELECT COUNT(*) FROM users)                               AS users,
           (SELECT COUNT(*) FROM users WHERE is_active = 1)           AS active_users,
           (SELECT COUNT(*) FROM contacts)                            AS contacts,
           (SELECT COUNT(*) FROM campaigns)                           AS campaigns,
           (SELECT COUNT(*) FROM messages WHERE direction='outbound') AS messages_sent`
      ),
      query<RowDataPacket[]>(
        `SELECT plan, COUNT(*) AS count FROM workspaces GROUP BY plan`
      ),
      query<RowDataPacket[]>(
        `SELECT DATE(created_at) AS date, COUNT(*) AS count
         FROM messages
         WHERE direction='outbound' AND created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
         GROUP BY DATE(created_at) ORDER BY date ASC`
      ),
      query<RowDataPacket[]>(
        `SELECT w.id, w.name, w.plan, w.is_active, w.created_at,
                (SELECT name FROM users u WHERE u.id = w.owner_id) AS owner_name
         FROM workspaces w ORDER BY w.created_at DESC LIMIT 5`
      ),
    ]);

    const planMap: Record<string, number> = { free: 0, pro: 0, enterprise: 0 };
    byPlan.forEach((r) => { planMap[r.plan as string] = Number(r.count); });

    return apiSuccess({
      totals: tot[0] || {},
      byPlan: planMap,
      messages7d: msg7.map((r) => ({ date: String(r.date).split('T')[0], count: Number(r.count) })),
      recentWorkspaces: recent,
    });
  } catch (err) {
    if (err instanceof Error && err.message === 'UNAUTHORIZED') return apiError('Unauthorized', 401);
    if (err instanceof Error && err.message === 'FORBIDDEN')    return apiError('Forbidden — super admin only', 403);
    console.error('[admin/stats]', err);
    return apiError('Server error', 500);
  }
}
