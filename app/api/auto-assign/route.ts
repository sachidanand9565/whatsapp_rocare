/**
 * GET /api/auto-assign — this project's auto-assign settings, plus (admin only)
 *   every manager/agent with their live status and open-chat count.
 * PUT /api/auto-assign — admin: { enabled, max_chats }.
 */
import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { query, execute } from '@/lib/db';
import { apiSuccess, apiError } from '@/lib/utils';
import { getAutoAssignSettings, clearAutoAssignCache, sweepWorkspace, ONLINE_WINDOW_MIN } from '@/lib/autoAssign';
import { RowDataPacket } from 'mysql2';

export async function GET(req: NextRequest) {
  try {
    const payload = await requireAuth(req);
    const settings = await getAutoAssignSettings(payload.workspaceId);
    if (payload.role !== 'admin') return apiSuccess({ ...settings, members: [] });

    const members = await query<RowDataPacket[]>(
      `SELECT u.id, u.name, wm.role,
         CASE WHEN aa.last_seen_at > UTC_TIMESTAMP() - INTERVAL ${ONLINE_WINDOW_MIN} MINUTE
              THEN aa.status ELSE 'offline' END AS status,
         (SELECT COUNT(*) FROM contacts c
          WHERE c.workspace_id = wm.workspace_id AND c.assigned_agent_id = u.id
            AND c.last_inbound_at > DATE_SUB(NOW(), INTERVAL 24 HOUR)
            AND (c.chat_status IS NULL OR c.chat_status != 'resolved')) AS open_chats
       FROM workspace_members wm
       JOIN users u ON u.id = wm.user_id
       LEFT JOIN agent_availability aa ON aa.user_id = u.id
       WHERE wm.workspace_id = ? AND wm.role IN ('manager','agent')
       ORDER BY u.name`,
      [payload.workspaceId]
    ).catch(() => [] as RowDataPacket[]);   // tables missing before the migration
    return apiSuccess({
      ...settings,
      members: members.map((m) => ({
        id: Number(m.id), name: m.name as string, role: m.role as string,
        status: m.status as string, open_chats: Number(m.open_chats),
      })),
    });
  } catch (err) {
    if (err instanceof Error && err.message === 'UNAUTHORIZED') return apiError('Unauthorized', 401);
    console.error('[auto-assign GET]', err);
    return apiError('Server error', 500);
  }
}

export async function PUT(req: NextRequest) {
  try {
    const payload = await requireAuth(req);
    if (payload.role !== 'admin') return apiError('Admin only', 403);
    const body = await req.json() as { enabled?: boolean; max_chats?: number };
    const enabled  = body.enabled ? 1 : 0;
    const maxChats = Math.max(0, Math.min(1000, Math.floor(Number(body.max_chats) || 0)));
    await execute(
      `INSERT INTO auto_assign_settings (workspace_id, enabled, max_chats) VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE enabled = VALUES(enabled), max_chats = VALUES(max_chats)`,
      [payload.workspaceId, enabled, maxChats]
    );
    clearAutoAssignCache(payload.workspaceId);
    if (enabled) await sweepWorkspace(payload.workspaceId, true);
    return apiSuccess({ enabled: !!enabled, maxChats });
  } catch (err) {
    if (err instanceof Error && err.message === 'UNAUTHORIZED') return apiError('Unauthorized', 401);
    if (err instanceof Error && /auto_assign_settings/.test(err.message)) {
      return apiError('Run migration-auto-assign.sql first', 500);
    }
    console.error('[auto-assign PUT]', err);
    return apiError('Server error', 500);
  }
}
