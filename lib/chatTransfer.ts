/**
 * Shared by the bulk chat-transfer routes:
 *   /api/contacts/bulk-transfer   picked chats → one person
 *   /api/contacts/transfer-all    every chat of one person → one person / Active members
 */
import { NextRequest } from 'next/server';
import { requireAuth, resolveWorkspaceScopes } from '@/lib/auth';
import { query, execute } from '@/lib/db';
import { utcNow } from '@/lib/utils';
import { emitLocalSSE } from '@/lib/sse';
import { logAgentEventBulk } from '@/lib/agentEvents';
import { ONLINE_WINDOW_MIN } from '@/lib/autoAssign';
import { RowDataPacket } from 'mysql2';

export const MAX_LIVE = 100;   // per-chat live updates beyond this would flood every open inbox

export interface TransferPerson {
  id: number; name: string;
  status: string;              // active | break | offline | unknown (not in auto-assign)
  open_chats: number;          // across the given projects, last 24h, not resolved
  workspaces: number[]; roles: string[];
}

const norm = (r: string | null | undefined) => String(r || '').trim().toLowerCase();

/** Caller + the shown projects where they are admin or manager. */
export async function managedWorkspaces(req: NextRequest, workspaces: string | null) {
  const payload = await requireAuth(req);
  const scopes = await resolveWorkspaceScopes(payload, workspaces);
  return { payload, wsIds: scopes.filter((s) => ['admin', 'manager'].includes(norm(s.role))).map((s) => s.workspaceId) };
}

/** Everyone chats can go to in these projects, Active first, then least busy. */
export async function listTransferPeople(wsIds: number[]): Promise<TransferPerson[]> {
  if (wsIds.length === 0) return [];
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

  const people = new Map<number, TransferPerson>();
  for (const r of rows) {
    const id = Number(r.id);
    const p = people.get(id) || {
      id, name: String(r.name || `User ${id}`),
      status: r.status == null ? 'unknown' : Number(r.fresh) ? String(r.status) : 'offline',
      open_chats: openBy.get(id) || 0, workspaces: [], roles: [],
    };
    p.workspaces.push(Number(r.workspace_id));
    if (!p.roles.includes(r.role)) p.roles.push(r.role);
    people.set(id, p);
  }
  const rank: Record<string, number> = { active: 0, unknown: 1, break: 2, offline: 3 };
  return Array.from(people.values())
    .sort((a, b) => (rank[a.status] ?? 1) - (rank[b.status] ?? 1) || a.open_chats - b.open_chats || a.name.localeCompare(b.name));
}

export async function userName(userId: number, fallback = ''): Promise<string> {
  const r = await query<RowDataPacket[]>('SELECT name FROM users WHERE id = ? LIMIT 1', [userId]);
  return String(r[0]?.name || fallback);
}

/**
 * Give `ids` (all in project `ws`) to `to`. Same fields as a single transfer —
 * intervened_by = who transferred — plus a system line in each chat.
 * Returns the ids that actually changed owner.
 */
export async function moveChats(ws: number, ids: number[], to: { id: number; name: string }, actorName: string): Promise<number[]> {
  if (ids.length === 0) return [];
  const where = `FROM contacts c WHERE c.workspace_id = ? AND c.id IN (${ids.map(() => '?').join(',')})
                   AND (c.assigned_agent_id IS NULL OR c.assigned_agent_id != ?)`;
  const params = [ws, ...ids, to.id];
  const changing = await query<RowDataPacket[]>(`SELECT c.id ${where}`, params);
  if (changing.length === 0) return [];
  const changeIds = changing.map((r) => Number(r.id));

  await logAgentEventBulk(ws, to.id, 'assigned', where, params);
  await execute(
    `UPDATE contacts SET assigned_agent_id = ?, intervened_by = ?
     WHERE workspace_id = ? AND id IN (${changeIds.map(() => '?').join(',')})`,
    [to.id, actorName, ws, ...changeIds]
  );
  const t = utcNow();
  const text = `Transferred to ${to.name} by ${actorName}`;
  await execute(
    `INSERT INTO messages (workspace_id, contact_id, direction, type, content, status, sent_at, created_at)
     VALUES ${changeIds.map(() => "(?, ?, 'outbound', 'system', ?, 'delivered', ?, ?)").join(',')}`,
    changeIds.flatMap((id) => [ws, id, text, t, t])
  );
  return changeIds;
}

/** Live: the new owner sees them, the old owner loses them (skipped for big moves). */
export function emitMoved(moved: { ws: number; id: number }[]) {
  if (moved.length > MAX_LIVE) return;
  for (const m of moved) emitLocalSSE({ type: 'chat_assigned', workspaceId: m.ws, contactId: m.id });
}
