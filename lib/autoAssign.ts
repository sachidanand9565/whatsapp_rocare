/**
 * lib/autoAssign.ts — hand each chat to one Active agent/manager.
 *
 * Only for projects where an admin turned auto-assign on (auto_assign_settings).
 * The webhook lands on the other panel, so assignment runs here from the relayed
 * new_message (app/api/sse-relay) plus a sweep on every panel heartbeat
 * (app/api/availability) that catches missed relays and chats left with someone
 * who went on Break / Offline.
 *
 * Rules:
 *  - Candidates: workspace members with role manager/agent, status 'active' and
 *    a heartbeat in the last 5 minutes. Admins never get chats automatically.
 *  - A chat stays with its owner while the owner is available (or is an admin).
 *  - Otherwise it goes to the candidate with the fewest open chats (24h window,
 *    not resolved), ties → whoever got a chat longest ago. Agents assigned to one
 *    of the contact's campaigns get first pick.
 *  - The sweep only moves chats waiting for a reply (last message is inbound).
 */
import { query, execute } from '@/lib/db';
import { emitLocalSSE } from '@/lib/sse';
import { RowDataPacket } from 'mysql2';

export const ONLINE_WINDOW_MIN = 5;

export interface AutoAssignSettings { enabled: boolean; maxChats: number; }

const SETTINGS_TTL_MS = 30_000;
const settingsCache = new Map<number, { s: AutoAssignSettings; at: number }>();

export async function getAutoAssignSettings(workspaceId: number): Promise<AutoAssignSettings> {
  const cached = settingsCache.get(workspaceId);
  if (cached && Date.now() - cached.at < SETTINGS_TTL_MS) return cached.s;
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

export function clearAutoAssignCache(workspaceId: number) {
  settingsCache.delete(workspaceId);
}

/** Visibility: with auto-assign on, managers and agents see only their own chats. */
export async function ownChatsOnly(workspaceId: number, role: string): Promise<boolean> {
  if (role !== 'agent' && role !== 'manager') return false;
  return (await getAutoAssignSettings(workspaceId)).enabled;
}

interface Candidate { userId: number; load: number; lastAssigned: number; }

async function loadCandidates(workspaceId: number, maxChats: number): Promise<Candidate[]> {
  const rows = await query<RowDataPacket[]>(
    `SELECT wm.user_id, aa.last_assigned_at
     FROM workspace_members wm
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
       AND last_inbound_at > DATE_SUB(NOW(), INTERVAL 24 HOUR)
       AND (chat_status IS NULL OR chat_status != 'resolved')
     GROUP BY assigned_agent_id`,
    [workspaceId, ...ids]
  );
  const loadOf = new Map(loads.map((r) => [Number(r.assigned_agent_id), Number(r.n)]));
  return rows
    .map((r) => ({
      userId:       Number(r.user_id),
      load:         loadOf.get(Number(r.user_id)) || 0,
      lastAssigned: r.last_assigned_at ? new Date(r.last_assigned_at).getTime() : 0,
    }))
    .filter((c) => !maxChats || c.load < maxChats);
}

async function adminIds(workspaceId: number): Promise<Set<number>> {
  const rows = await query<RowDataPacket[]>(
    "SELECT user_id FROM workspace_members WHERE workspace_id = ? AND role = 'admin'",
    [workspaceId]
  );
  return new Set(rows.map((r) => Number(r.user_id)));
}

async function pick(candidates: Candidate[], contactId: number): Promise<Candidate | null> {
  if (candidates.length === 0) return null;
  let pool = candidates;
  const camp = await query<RowDataPacket[]>(
    `SELECT DISTINCT ca.agent_id FROM campaign_contacts cc
     JOIN campaign_assignments ca ON ca.campaign_id = cc.campaign_id
     WHERE cc.contact_id = ?`,
    [contactId]
  );
  if (camp.length) {
    const campIds = new Set(camp.map((r) => Number(r.agent_id)));
    const preferred = candidates.filter((c) => campIds.has(c.userId));
    if (preferred.length) pool = preferred;
  }
  return [...pool].sort((a, b) => a.load - b.load || a.lastAssigned - b.lastAssigned)[0];
}

/** Move one chat to `next` unless someone else changed its owner meanwhile. */
async function assign(workspaceId: number, contactId: number, from: number | null, next: Candidate) {
  const changed = await execute(
    'UPDATE contacts SET assigned_agent_id = ? WHERE id = ? AND workspace_id = ? AND assigned_agent_id <=> ?',
    [next.userId, contactId, workspaceId, from]
  );
  if (!changed) return false;
  next.load += 1;
  next.lastAssigned = Date.now();
  await execute('UPDATE agent_availability SET last_assigned_at = UTC_TIMESTAMP(3) WHERE user_id = ?', [next.userId]);
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

  const candidates = await loadCandidates(workspaceId, 0);
  if (owner != null) {
    if (candidates.some((c) => c.userId === owner)) return false;
    if ((await adminIds(workspaceId)).has(owner)) return false;
  }
  const open = settings.maxChats ? candidates.filter((c) => c.load < settings.maxChats) : candidates;
  const next = await pick(open, contactId);
  return next ? assign(workspaceId, contactId, owner, next) : false;
}

const lastSweep = new Map<number, number>();
const SWEEP_EVERY_MS = 30_000;

/**
 * Waiting chats (customer spoke last, 24h window) that nobody available owns:
 * unassigned, or owned by someone on Break / Offline / no longer a member.
 * `force` skips the throttle — used right after someone goes on Break.
 */
export async function sweepWorkspace(workspaceId: number, force = false): Promise<number> {
  if (!force && Date.now() - (lastSweep.get(workspaceId) || 0) < SWEEP_EVERY_MS) return 0;
  lastSweep.set(workspaceId, Date.now());
  const settings = await getAutoAssignSettings(workspaceId);
  if (!settings.enabled) return 0;

  const candidates = await loadCandidates(workspaceId, settings.maxChats);
  if (candidates.length === 0) return 0;

  const rows = await query<RowDataPacket[]>(
    `SELECT c.id, c.assigned_agent_id
     FROM contacts c
     LEFT JOIN workspace_members wm ON wm.workspace_id = c.workspace_id AND wm.user_id = c.assigned_agent_id
     LEFT JOIN agent_availability aa ON aa.user_id = c.assigned_agent_id
     WHERE c.workspace_id = ?
       AND c.last_inbound_at > DATE_SUB(NOW(), INTERVAL 24 HOUR)
       AND (c.last_message_at IS NULL OR c.last_inbound_at >= c.last_message_at)
       AND (c.chat_status IS NULL OR c.chat_status != 'resolved')
       AND (
         c.assigned_agent_id IS NULL
         OR (
           (wm.role IS NULL OR wm.role != 'admin')
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
    const open = settings.maxChats ? candidates.filter((c) => c.load < settings.maxChats) : candidates;
    const next = await pick(open, Number(r.id));
    if (!next) break;
    const from = r.assigned_agent_id == null ? null : Number(r.assigned_agent_id);
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
