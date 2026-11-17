/**
 * Move many chats to one person at once — e.g. an agent went home, hand
 * their chats to someone who is Active.
 *
 * GET  /api/contacts/bulk-transfer?workspaces=1,2
 *   Who chats can go to: members (admin/manager/agent) of the shown projects
 *   where the caller is admin or manager, with their Active / Break / Offline
 *   status, open chats and which of those projects they are in.
 * POST /api/contacts/bulk-transfer
 *   { contact_ids: number[], to_user_id, workspaces? } → { transferred, skipped }
 *   A chat is skipped when the caller isn't admin/manager of its project or
 *   the target isn't a member of it.
 */
import { NextRequest } from 'next/server';
import { requireAuth, resolveWorkspaceScopes } from '@/lib/auth';
import { query, execute } from '@/lib/db';
import { apiSuccess, apiError, utcNow } from '@/lib/utils';
import { emitLocalSSE } from '@/lib/sse';
import { logAgentEventBulk } from '@/lib/agentEvents';
import { ONLINE_WINDOW_MIN } from '@/lib/autoAssign';
import { RowDataPacket } from 'mysql2';

const MAX_IDS  = 2000;
const MAX_LIVE = 100;   // per-chat live updates beyond this would flood every open inbox

const norm = (r: string | null | undefined) => String(r || '').trim().toLowerCase();

/** Projects (of the shown ones) where the caller may hand chats around. */
async function managedWorkspaces(req: NextRequest, workspaces: string | null) {
  const payload = await requireAuth(req);
  const scopes = await resolveWorkspaceScopes(payload, workspaces);
  return { payload, wsIds: scopes.filter((s) => ['admin', 'manager'].includes(norm(s.role))).map((s) => s.workspaceId) };
}

export async function GET(req: NextRequest) {
  try {
    const { wsIds } = await managedWorkspaces(req, req.nextUrl.searchParams.get('workspaces'));
    if (wsIds.length === 0) return apiError('Admin or manager only', 403);
    const inList = wsIds.map(() => '?').join(',');

    const memberSql = (withStatus: boolean) => `
      SELECT wm.user_id AS id, u.name, LOWER(TRIM(wm.role)) AS role, wm.workspace_id,
        ${withStatus
          ? `a.status, (a.last_seen_at > UTC_TIMESTAMP() - INTERVAL ${ONLINE_WINDOW_MIN} MINUTE) AS fresh`
          : 'NULL AS status, 0 AS fresh'}
      FROM workspace_members wm
      JOIN users u ON u.id = wm.user_id
      ${withStatus ? 'LEFT JOIN agent_availability a ON a.user_id = wm.user_id' : ''}
      WHERE wm.workspace_id IN (${inList})
        AND LOWER(TRIM(wm.role)) IN ('admin','manager','agent')
        AND (u.is_active IS NULL OR u.is_active = 1)`;
    const rows = await query<RowDataPacket[]>(memberSql(true), wsIds)
      .catch(() => query<RowDataPacket[]>(memberSql(false), wsIds));   // availability table missing

    const open = await query<RowDataPacket[]>(
      `SELECT assigned_agent_id AS id, COUNT(*) AS n FROM contacts
       WHERE workspace_id IN (${inList}) AND assigned_agent_id IS NOT NULL
         AND (chat_status IS NULL OR chat_status != 'resolved')
         AND last_inbound_at > UTC_TIMESTAMP() - INTERVAL 24 HOUR
       GROUP BY assigned_agent_id`,
      wsIds
    );
    const openBy = new Map(open.map((r) => [Number(r.id), Number(r.n) || 0]));

    const people = new Map<number, { id: number; name: string; status: string; open_chats: number; workspaces: number[]; roles: string[] }>();
    for (const r of rows) {
      const id = Number(r.id);
      const p = people.get(id) || {
        id, name: String(r.name || `User ${id}`),
        // No status row = not in auto-assign, availability unknown
        status: r.status == null ? 'unknown' : Number(r.fresh) ? String(r.status) : 'offline',
        open_chats: openBy.get(id) || 0, workspaces: [], roles: [],
      };
      p.workspaces.push(Number(r.workspace_id));
      if (!p.roles.includes(r.role)) p.roles.push(r.role);
      people.set(id, p);
    }
    const rank: Record<string, number> = { active: 0, unknown: 1, break: 2, offline: 3 };
    const list = Array.from(people.values())
      .sort((a, b) => (rank[a.status] ?? 1) - (rank[b.status] ?? 1) || a.open_chats - b.open_chats || a.name.localeCompare(b.name));
    return apiSuccess(list);
  } catch (err) {
    if (err instanceof Error && err.message === 'UNAUTHORIZED') return apiError('Unauthorized', 401);
    console.error('[contacts/bulk-transfer GET]', err);
    return apiError('Server error', 500);
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as { contact_ids?: unknown[]; to_user_id?: number; workspaces?: string };
    const { payload, wsIds } = await managedWorkspaces(req, body.workspaces || null);
    if (wsIds.length === 0) return apiError('Admin or manager only', 403);

    const toUserId = Number(body.to_user_id);
    if (!toUserId) return apiError('to_user_id is required');
    const ids = Array.from(new Set((body.contact_ids || []).map(Number).filter((n) => Number.isInteger(n) && n > 0)));
    if (ids.length === 0) return apiError('Select at least one chat');
    if (ids.length > MAX_IDS) return apiError(`At most ${MAX_IDS} chats at a time`);

    const [actor, target, targetWs] = await Promise.all([
      query<RowDataPacket[]>('SELECT name, email FROM users WHERE id = ? LIMIT 1', [payload.userId]),
      query<RowDataPacket[]>('SELECT name FROM users WHERE id = ? LIMIT 1', [toUserId]),
      query<RowDataPacket[]>(
        `SELECT workspace_id FROM workspace_members
         WHERE user_id = ? AND LOWER(TRIM(role)) IN ('admin','manager','agent')`, [toUserId]),
    ]);
    if (!target[0]) return apiError('That person was not found', 404);
    const actorName  = String(actor[0]?.name || payload.email);
    const targetName = String(target[0].name);
    const targetIn   = new Set(targetWs.map((r) => Number(r.workspace_id)));

    // Group the chats by project; keep only projects both sides qualify for
    const chats = await query<RowDataPacket[]>(
      `SELECT id, workspace_id FROM contacts WHERE id IN (${ids.map(() => '?').join(',')})`, ids
    );
    const byWs = new Map<number, number[]>();
    for (const c of chats) {
      const ws = Number(c.workspace_id);
      if (!wsIds.includes(ws) || !targetIn.has(ws)) continue;
      byWs.set(ws, [...(byWs.get(ws) || []), Number(c.id)]);
    }

    let transferred = 0;
    const moved: { ws: number; id: number }[] = [];
    for (const [ws, list] of Array.from(byWs.entries())) {
      const where = `FROM contacts c WHERE c.workspace_id = ? AND c.id IN (${list.map(() => '?').join(',')})
                       AND (c.assigned_agent_id IS NULL OR c.assigned_agent_id != ?)`;
      const params = [ws, ...list, toUserId];
      const changing = await query<RowDataPacket[]>(`SELECT c.id ${where}`, params);
      if (changing.length === 0) continue;
      const changeIds = changing.map((r) => Number(r.id));

      await logAgentEventBulk(ws, toUserId, 'assigned', where, params);
      // Same fields as a single transfer: intervened_by = who transferred
      transferred += await execute(
        `UPDATE contacts SET assigned_agent_id = ?, intervened_by = ?
         WHERE workspace_id = ? AND id IN (${changeIds.map(() => '?').join(',')})`,
        [toUserId, actorName, ws, ...changeIds]
      );
      const t = utcNow();
      const text = `Transferred to ${targetName} by ${actorName}`;
      await execute(
        `INSERT INTO messages (workspace_id, contact_id, direction, type, content, status, sent_at, created_at)
         VALUES ${changeIds.map(() => "(?, ?, 'outbound', 'system', ?, 'delivered', ?, ?)").join(',')}`,
        changeIds.flatMap((id) => [ws, id, text, t, t])
      );
      changeIds.forEach((id) => moved.push({ ws, id }));
    }

    // Live: new owner sees them, the old owner loses them
    if (moved.length <= MAX_LIVE) {
      for (const m of moved) emitLocalSSE({ type: 'chat_assigned', workspaceId: m.ws, contactId: m.id });
    }

    console.log(`[bulk-transfer] ${transferred} chats → ${targetName} (#${toUserId}) by ${actor[0]?.email || payload.userId}, projects=${Array.from(byWs.keys()).join(',')}`);
    // skipped = not allowed / not found / already theirs
    return apiSuccess({ transferred, skipped: ids.length - transferred });
  } catch (err) {
    if (err instanceof Error && err.message === 'UNAUTHORIZED') return apiError('Unauthorized', 401);
    console.error('[contacts/bulk-transfer POST]', err);
    return apiError('Server error', 500);
  }
}
