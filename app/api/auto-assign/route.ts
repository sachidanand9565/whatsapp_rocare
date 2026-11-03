/**
 * GET /api/auto-assign — this project's auto-assign settings, plus (admin only)
 *   every manager/agent with their Auto Assign toggle, live status and
 *   open-chat count.
 * PUT /api/auto-assign — admin:
 *   { enabled, max_chats }       project switch
 *   { user_id, auto_assign }     one agent's Auto Assign toggle
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
         (m.user_id IS NOT NULL) AS auto_assign,
         CASE WHEN aa.last_seen_at > UTC_TIMESTAMP() - INTERVAL ${ONLINE_WINDOW_MIN} MINUTE
              THEN aa.status ELSE 'offline' END AS status,
         (SELECT COUNT(*) FROM contacts c
          WHERE c.workspace_id = wm.workspace_id AND c.assigned_agent_id = u.id
            AND c.last_inbound_at > DATE_SUB(NOW(), INTERVAL 24 HOUR)
            AND (c.chat_status IS NULL OR c.chat_status != 'resolved')) AS open_chats
       FROM workspace_members wm
       JOIN users u ON u.id = wm.user_id
       LEFT JOIN auto_assign_agents m ON m.workspace_id = wm.workspace_id AND m.user_id = u.id
       LEFT JOIN agent_availability aa ON aa.user_id = u.id
       WHERE wm.workspace_id = ? AND wm.role IN ('manager','agent')
       ORDER BY u.name`,
      [payload.workspaceId]
    ).catch(() => [] as RowDataPacket[]);   // tables missing before the migrations
    return apiSuccess({
      ...settings,
      members: members.map((m) => ({
        id: Number(m.id), name: m.name as string, role: m.role as string,
        auto_assign: !!Number(m.auto_assign),
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
    const body = await req.json() as { enabled?: boolean; max_chats?: number; user_id?: number; auto_assign?: boolean };

    // One agent's Auto Assign toggle
    if (body.user_id !== undefined) {
      const userId = Number(body.user_id);
      const member = await query<RowDataPacket[]>(
        "SELECT 1 FROM workspace_members WHERE workspace_id = ? AND user_id = ? AND role IN ('manager','agent') LIMIT 1",
        [payload.workspaceId, userId]
      );
      if (!member.length) return apiError('Not an agent or manager of this project', 404);
      if (body.auto_assign) {
        await execute('INSERT IGNORE INTO auto_assign_agents (workspace_id, user_id) VALUES (?, ?)', [payload.workspaceId, userId]);
      } else {
        await execute('DELETE FROM auto_assign_agents WHERE workspace_id = ? AND user_id = ?', [payload.workspaceId, userId]);
      }
      clearAutoAssignCache(payload.workspaceId);
      return apiSuccess({ user_id: userId, auto_assign: !!body.auto_assign });
    }

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
    if (err instanceof Error && /auto_assign_(settings|agents)/.test(err.message)) {
      return apiError('Run migration-auto-assign.sql and migration-auto-assign-agents.sql first', 500);
    }
    console.error('[auto-assign PUT]', err);
    return apiError('Server error', 500);
  }
}
