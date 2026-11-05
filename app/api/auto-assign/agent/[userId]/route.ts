/**
 * Auto Assign for one agent across every project — so the admin sets it from
 * one popup instead of switching project after project.
 *
 * GET /api/auto-assign/agent/:userId
 *   Projects where :userId is an agent/manager AND the caller is admin, with
 *   the agent's Auto Assign toggle, the project's auto-assign switch and how
 *   many chats the agent has open there (24h, not resolved).
 * PUT /api/auto-assign/agent/:userId
 *   { workspace_id, auto_assign }      the agent's toggle in that project
 *   { workspace_id, project_enabled }  that project's auto-assign switch
 */
import { NextRequest } from 'next/server';
import { requireAuth, getMemberRole } from '@/lib/auth';
import { query, execute } from '@/lib/db';
import { apiSuccess, apiError } from '@/lib/utils';
import { clearAutoAssignCache, sweepWorkspace } from '@/lib/autoAssign';
import { RowDataPacket } from 'mysql2';

type Ctx = { params: { userId: string } };

// Stored roles can be 'Admin' / ' agent' — compare normalised
const isRole = (role: string | null, ...want: string[]) => want.includes(String(role || '').trim().toLowerCase());

export async function GET(req: NextRequest, { params }: Ctx) {
  try {
    const payload = await requireAuth(req);
    const userId = Number(params.userId);
    const rows = await query<RowDataPacket[]>(
      `SELECT w.id, w.name,
         LOWER(TRIM(wm.role)) AS role,
         (m.user_id IS NOT NULL) AS auto_assign,
         COALESCE(s.enabled, 0) AS project_enabled,
         (SELECT COUNT(*) FROM contacts c
          WHERE c.workspace_id = wm.workspace_id AND c.assigned_agent_id = wm.user_id
            AND c.last_inbound_at > DATE_SUB(UTC_TIMESTAMP(), INTERVAL 24 HOUR)
            AND (c.chat_status IS NULL OR c.chat_status != 'resolved')) AS open_chats
       FROM workspace_members wm
       JOIN workspaces w ON w.id = wm.workspace_id
       JOIN workspace_members me
         ON me.workspace_id = wm.workspace_id AND me.user_id = ? AND LOWER(TRIM(me.role)) = 'admin'
       LEFT JOIN auto_assign_agents m ON m.workspace_id = wm.workspace_id AND m.user_id = wm.user_id
       LEFT JOIN auto_assign_settings s ON s.workspace_id = wm.workspace_id
       WHERE wm.user_id = ? AND LOWER(TRIM(wm.role)) IN ('agent','manager')
       ORDER BY w.name`,
      [payload.userId, userId]
    );
    return apiSuccess(rows.map((r) => ({
      id: Number(r.id), name: r.name as string, role: r.role as string,
      auto_assign: !!Number(r.auto_assign), project_enabled: !!Number(r.project_enabled),
      open_chats: Number(r.open_chats) || 0,
    })));
  } catch (err) {
    if (err instanceof Error && err.message === 'UNAUTHORIZED') return apiError('Unauthorized', 401);
    if (err instanceof Error && /auto_assign_(settings|agents)/.test(err.message)) {
      return apiError('Run migration-auto-assign.sql and migration-auto-assign-agents.sql first', 500);
    }
    console.error('[auto-assign/agent GET]', err);
    return apiError('Server error', 500);
  }
}

export async function PUT(req: NextRequest, { params }: Ctx) {
  try {
    const payload = await requireAuth(req);
    const userId = Number(params.userId);
    const body = await req.json() as { workspace_id?: number; auto_assign?: boolean; project_enabled?: boolean };
    const wsId = Number(body.workspace_id);
    if (!wsId) return apiError('workspace_id is required');
    if (!isRole(await getMemberRole(payload.userId, wsId), 'admin')) return apiError('Admin of that project only', 403);
    if (!isRole(await getMemberRole(userId, wsId), 'agent', 'manager')) {
      return apiError('Not an agent or manager of that project', 404);
    }

    if (body.project_enabled !== undefined) {
      await execute(
        `INSERT INTO auto_assign_settings (workspace_id, enabled) VALUES (?, ?)
         ON DUPLICATE KEY UPDATE enabled = VALUES(enabled)`,
        [wsId, body.project_enabled ? 1 : 0]
      );
    }
    if (body.auto_assign !== undefined) {
      if (body.auto_assign) {
        await execute('INSERT IGNORE INTO auto_assign_agents (workspace_id, user_id) VALUES (?, ?)', [wsId, userId]);
      } else {
        await execute('DELETE FROM auto_assign_agents WHERE workspace_id = ? AND user_id = ?', [wsId, userId]);
      }
    }
    clearAutoAssignCache(wsId);
    if (body.project_enabled) await sweepWorkspace(wsId, true);
    return apiSuccess({ updated: true });
  } catch (err) {
    if (err instanceof Error && err.message === 'UNAUTHORIZED') return apiError('Unauthorized', 401);
    if (err instanceof Error && /auto_assign_(settings|agents)/.test(err.message)) {
      return apiError('Run migration-auto-assign.sql and migration-auto-assign-agents.sql first', 500);
    }
    console.error('[auto-assign/agent PUT]', err);
    return apiError('Server error', 500);
  }
}
