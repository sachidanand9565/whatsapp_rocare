/**
 * lib/autoAssign.ts — hand each new chat to one Active auto-assign agent.
 *
 * Only for projects where an admin turned auto-assign on (auto_assign_settings),
 * and only to the agents/managers whose "Auto Assign" toggle is on
 * (auto_assign_agents). The webhook lands on the other panel, so assignment runs
 * here from the relayed new_message (app/api/sse-relay) plus a sweep on every
 * panel heartbeat (app/api/availability).
 *
 * Rules:
 *  - Candidates: auto-assign members with status 'active' and a heartbeat in the
 *    last 5 minutes. Admins never get chats automatically.
 *  - A new message on an unassigned chat goes to the candidate with the fewest
 *    open chats (24h window, not resolved), ties → whoever got a chat longest
 *    ago. Agents assigned to one of the contact's campaigns get first pick.
 *  - Nobody Active → the chat stays unassigned (the pool everyone sees) until
 *    someone intervenes, which assigns it to them. Old pool chats are never
 *    handed out later; only a new message from the customer is.
 *  - A chat stays with its owner while they are available. Chats owned by an
 *    auto-assign member who went on Break / Offline and still waiting for a
 *    reply move to another candidate, or back to the pool if there is none.
 *    Chats someone took by hand (intervene / transfer) by a non-member stay put.
 */
import { query, execute } from '@/lib/db';
import { emitLocalSSE } from '@/lib/sse';
import { logAgentEvent } from '@/lib/agentEvents';
import { RowDataPacket } from 'mysql2';

export const ONLINE_WINDOW_MIN = 5;
// Sweep backup for a missed relay: unassigned chats this fresh still get assigned.
const MISSED_RELAY_MIN = 3;
// NOTE: contacts.last_inbound_at is UTC but the DB server's NOW() is not
// (it runs ~7h behind), so every time window here uses UTC_TIMESTAMP().

export interface AutoAssignSettings { enabled: boolean; maxChats: number; }

const CACHE_TTL_MS = 30_000;
const settingsCache = new Map<number, { s: AutoAssignSettings; at: number }>();
const membersCache  = new Map<number, { ids: Set<number>; at: number }>();

export async function getAutoAssignSettings(workspaceId: number): Promise<AutoAssignSettings> {
  const cached = settingsCache.get(workspaceId);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.s;
  let s: AutoAssignSettings = { enabled: false, maxChats: 0 };
  try {
    const rows = await query<RowDataPacket[]>(
      'SELECT enabled, max_chats FROM auto_assign_settings WHERE workspace_id = ? LIMIT 1',
      [workspaceId]
    );
    if (rows.length) s = { enabled: !!rows[0].enabled, maxChats: Number(rows[0].max_chats) || 0 };
  } catch {
    // Table not created yet (migration-auto-assign.sql) → treat as off
  }
  settingsCache.set(workspaceId, { s, at: Date.now() });
  return s;
}

/** Users whose "Auto Assign" toggle is on in this project. */
export async function getAutoAssignMembers(workspaceId: number): Promise<Set<number>> {
  const cached = membersCache.get(workspaceId);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.ids;
  let ids = new Set<number>();
  try {
    const rows = await query<RowDataPacket[]>(
      'SELECT user_id FROM auto_assign_agents WHERE workspace_id = ?',
      [workspaceId]
    );
    ids = new Set(rows.map((r) => Number(r.user_id)));
  } catch {
    // Table not created yet (migration-auto-assign-agents.sql) → nobody
  }
  membersCache.set(workspaceId, { ids, at: Date.now() });
  return ids;
}

export function clearAutoAssignCache(workspaceId: number) {
  settingsCache.delete(workspaceId);
  membersCache.delete(workspaceId);
}

/**
 * Visibility: an auto-assign member sees their own chats plus the unassigned
 * pool. Everyone else keeps the usual rules.
 */
export async function poolView(workspaceId: number, role: string, userId: number): Promise<boolean> {
  // Stored roles may be 'Agent' / ' agent' (MySQL compares them case-insensitively)
  const r = String(role || '').trim().toLowerCase();
  if (r !== 'agent' && r !== 'manager') return false;
  if (!(await getAutoAssignSettings(workspaceId)).enabled) return false;
  return (await getAutoAssignMembers(workspaceId)).has(userId);
}

interface Candidate { userId: number; load: number; lastAssigned: number; }

async function loadCandidates(workspaceId: number): Promise<Candidate[]> {
  const rows = await query<RowDataPacket[]>(
    `SELECT wm.user_id, aa.last_assigned_at
     FROM workspace_members wm
     JOIN auto_assign_agents m ON m.workspace_id = wm.workspace_id AND m.user_id = wm.user_id
     JOIN agent_availability aa ON aa.user_id = wm.user_id
     WHERE wm.workspace_id = ? AND wm.role IN ('manager','agent')
       AND aa.status = 'active'
       AND aa.last_seen_at > UTC_TIMESTAMP() - INTERVAL ${ONLINE_WINDOW_MIN} MINUTE`,
    [workspaceId]
  );
  if (rows.length === 0) return [];
  const ids = rows.map((r) => Number(r.user_id));
  const loads = await query<RowDataPacket[]>(
    `SELECT assigned_agent_id, COUNT(*) AS n FROM contacts
     WHERE workspace_id = ? AND assigned_agent_id IN (${ids.map(() => '?').join(',')})
       AND last_inbound_at > DATE_SUB(UTC_TIMESTAMP(), INTERVAL 24 HOUR)
       AND (chat_status IS NULL OR chat_status != 'resolved')
     GROUP BY assigned_agent_id`,
    [workspaceId, ...ids]
  );
  const loadOf = new Map(loads.map((r) => [Number(r.assigned_agent_id), Number(r.n)]));
  return rows.map((r) => ({
    userId:       Number(r.user_id),
    load:         loadOf.get(Number(r.user_id)) || 0,
    lastAssigned: r.last_assigned_at ? new Date(r.last_assigned_at).getTime() : 0,
  }));
}

async function pick(candidates: Candidate[], maxChats: number, contactId: number): Promise<Candidate | null> {
  const open = maxChats ? candidates.filter((c) => c.load < maxChats) : candidates;
  if (open.length === 0) return null;
  let pool = open;
  const camp = await query<RowDataPacket[]>(
    `SELECT DISTINCT ca.agent_id FROM campaign_contacts cc
     JOIN campaign_assignments ca ON ca.campaign_id = cc.campaign_id
     WHERE cc.contact_id = ?`,
    [contactId]
  );
  if (camp.length) {
    const campIds = new Set(camp.map((r) => Number(r.agent_id)));
    const preferred = open.filter((c) => campIds.has(c.userId));
    if (preferred.length) pool = preferred;
  }
  return [...pool].sort((a, b) => a.load - b.load || a.lastAssigned - b.lastAssigned)[0];
}

/**
 * Move one chat to `next` (null = back to the unassigned pool) unless someone
 * else changed its owner meanwhile.
 */
async function assign(workspaceId: number, contactId: number, from: number | null, next: Candidate | null) {
  const changed = await execute(
    'UPDATE contacts SET assigned_agent_id = ? WHERE id = ? AND workspace_id = ? AND assigned_agent_id <=> ?',
    [next ? next.userId : null, contactId, workspaceId, from]
  );
  if (!changed) return false;
  if (next) {
    next.load += 1;
    next.lastAssigned = Date.now();
    await execute('UPDATE agent_availability SET last_assigned_at = UTC_TIMESTAMP(3) WHERE user_id = ?', [next.userId]);
    await logAgentEvent(workspaceId, next.userId, contactId, 'assigned');
  }
  emitLocalSSE({ type: 'chat_assigned', workspaceId, contactId });
  return true;
}

/** New inbound message: keep the chat with an available owner, else hand it on. */
export async function autoAssignContact(workspaceId: number, contactId: number): Promise<boolean> {
  const settings = await getAutoAssignSettings(workspaceId);
  if (!settings.enabled) return false;
  const rows = await query<RowDataPacket[]>(
    'SELECT assigned_agent_id FROM contacts WHERE id = ? AND workspace_id = ? LIMIT 1',
    [contactId, workspaceId]
  );
  if (rows.length === 0) return false;
  const owner = rows[0].assigned_agent_id == null ? null : Number(rows[0].assigned_agent_id);

  // Taken by hand by someone outside auto-assign (admin, toggle off) → leave it
  if (owner != null && !(await getAutoAssignMembers(workspaceId)).has(owner)) return false;

  const candidates = await loadCandidates(workspaceId);
  if (owner != null && candidates.some((c) => c.userId === owner)) return false;
  const next = await pick(candidates, settings.maxChats, contactId);
  // Nobody free: an unassigned chat just stays in the pool; an absent owner's
  // chat goes back to it so everyone can see it
  if (!next && owner == null) return false;
  return assign(workspaceId, contactId, owner, next);
}

const lastSweep = new Map<number, number>();
const SWEEP_EVERY_MS = 30_000;

/**
 * Chats waiting for a reply (customer spoke last, 24h window) that need a new
 * owner: owned by an auto-assign member now on Break / Offline, or unassigned
 * and only minutes old (the relay for it was missed).
 * `force` skips the throttle — used right after someone goes on Break.
 */
export async function sweepWorkspace(workspaceId: number, force = false): Promise<number> {
  if (!force && Date.now() - (lastSweep.get(workspaceId) || 0) < SWEEP_EVERY_MS) return 0;
  lastSweep.set(workspaceId, Date.now());
  const settings = await getAutoAssignSettings(workspaceId);
  if (!settings.enabled) return 0;

  const candidates = await loadCandidates(workspaceId);

  const rows = await query<RowDataPacket[]>(
    `SELECT c.id, c.assigned_agent_id
     FROM contacts c
     LEFT JOIN auto_assign_agents m ON m.workspace_id = c.workspace_id AND m.user_id = c.assigned_agent_id
     LEFT JOIN agent_availability aa ON aa.user_id = c.assigned_agent_id
     WHERE c.workspace_id = ?
       AND c.last_inbound_at > DATE_SUB(UTC_TIMESTAMP(), INTERVAL 24 HOUR)
       AND (c.last_message_at IS NULL OR c.last_inbound_at >= c.last_message_at)
       AND (c.chat_status IS NULL OR c.chat_status != 'resolved')
       AND (
         (c.assigned_agent_id IS NULL AND c.last_inbound_at > DATE_SUB(UTC_TIMESTAMP(), INTERVAL ${MISSED_RELAY_MIN} MINUTE))
         OR (
           m.user_id IS NOT NULL
           AND (aa.user_id IS NULL OR aa.status != 'active'
                OR aa.last_seen_at IS NULL
                OR aa.last_seen_at < UTC_TIMESTAMP() - INTERVAL ${ONLINE_WINDOW_MIN} MINUTE)
         )
       )
     ORDER BY c.last_inbound_at ASC
     LIMIT 50`,
    [workspaceId]
  );

  let moved = 0;
  for (const r of rows) {
    const from = r.assigned_agent_id == null ? null : Number(r.assigned_agent_id);
    const next = await pick(candidates, settings.maxChats, Number(r.id));
    if (!next && from == null) continue;
    if (await assign(workspaceId, Number(r.id), from, next)) moved++;
  }
  return moved;
}

/** Sweep every auto-assign project this user belongs to. */
export async function sweepForUser(userId: number, force = false): Promise<void> {
  const rows = await query<RowDataPacket[]>(
    `SELECT s.workspace_id FROM auto_assign_settings s
     JOIN workspace_members wm ON wm.workspace_id = s.workspace_id AND wm.user_id = ?
     WHERE s.enabled = 1`,
    [userId]
  ).catch(() => [] as RowDataPacket[]);
  for (const r of rows) await sweepWorkspace(Number(r.workspace_id), force);
}

/** Is this user an auto-assign member in any project that has it on? (header toggle) */
export async function isAutoAssignAnywhere(userId: number): Promise<boolean> {
  const rows = await query<RowDataPacket[]>(
    `SELECT 1 FROM auto_assign_agents m
     JOIN auto_assign_settings s ON s.workspace_id = m.workspace_id AND s.enabled = 1
     WHERE m.user_id = ? LIMIT 1`,
    [userId]
  ).catch(() => [] as RowDataPacket[]);
  return rows.length > 0;
}
