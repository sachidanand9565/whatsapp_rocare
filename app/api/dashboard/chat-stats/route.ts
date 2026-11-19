/**
 * GET /api/dashboard/chat-stats?period=today|yesterday|7d|30d&workspaces=1,2,3
 *
 * Chat numbers for the dashboard, over the given projects (the same selection
 * as the combined inbox) — only those where the caller is admin or manager;
 * the rest come back in `skipped`. No `workspaces` = every project they manage.
 *   projects[]  per project — period: chats, new, replied, resolved, intervened,
 *               messages in/out, templates; right now: open (24h), waiting for a
 *               reply, unassigned waiting, intervened
 *   agents[]    per person — right now: open, waiting, intervened; period: chats
 *               they currently hold; plus assigned/intervened/resolved from
 *               agent_chat_events when that table exists
 *   series[]    chats by hour (today/yesterday) or by day (7d/30d), India time
 *
 * "Chats" = contacts that sent at least one message in the period. "New" = their
 * first message ever was in the period. "Replied" = we sent them a non-template
 * message in the period (bot replies count too — messages don't record who sent).
 */
import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { query } from '@/lib/db';
import { apiSuccess, apiError } from '@/lib/utils';
import { ONLINE_WINDOW_MIN } from '@/lib/autoAssign';
import { RowDataPacket } from 'mysql2';

export const maxDuration = 60;

const IST_MS = 5.5 * 60 * 60 * 1000;
// Every messages.type, so the (workspace_id, direction, type, created_at) index can range on created_at
const ALL_TYPES = `('text','image','document','audio','video','template','interactive','reaction','location','contacts','sticker','unknown','')`;
const CACHE_MS = 60_000;
const cache = new Map<string, { at: number; data: unknown }>();

const sqlTime = (ms: number) => new Date(ms).toISOString().slice(0, 19).replace('T', ' ');

/** [start, end) in UTC; days start at midnight India time. */
function periodRange(period: string): { start: string; end: string; byHour: boolean } {
  const now = Date.now();
  const ist = new Date(now + IST_MS);
  const todayStart = Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate()) - IST_MS;
  const end = sqlTime(now + 60_000);
  if (period === 'yesterday') return { start: sqlTime(todayStart - 86_400_000), end: sqlTime(todayStart), byHour: true };
  if (period === '7d')  return { start: sqlTime(todayStart - 6 * 86_400_000),  end, byHour: false };
  if (period === '30d') return { start: sqlTime(todayStart - 29 * 86_400_000), end, byHour: false };
  return { start: sqlTime(todayStart), end, byHour: true };
}

const n = (v: unknown) => Number(v) || 0;

export async function GET(req: NextRequest) {
  try {
    const payload = await requireAuth(req);
    const sp = req.nextUrl.searchParams;
    const period = ['today', 'yesterday', '7d', '30d'].includes(sp.get('period') || '') ? sp.get('period')! : 'today';
    const wanted = Array.from(new Set((sp.get('workspaces') || '').split(',').map(Number).filter((x) => Number.isInteger(x) && x > 0)));

    // Projects this person manages
    const managed = await query<RowDataPacket[]>(
      `SELECT w.id, w.name FROM workspace_members wm JOIN workspaces w ON w.id = wm.workspace_id
       WHERE wm.user_id = ? AND LOWER(TRIM(wm.role)) IN ('admin','manager') ORDER BY w.name`,
      [payload.userId]
    );
    if (managed.length === 0) return apiError('Admin or manager only', 403);
    const allProjects = managed.map((r) => ({ id: Number(r.id), name: String(r.name) }));
    const managedIds = new Set(allProjects.map((p) => p.id));
    const projects = wanted.length === 0 ? allProjects : allProjects.filter((p) => wanted.includes(p.id));
    const skipped  = wanted.filter((id) => !managedIds.has(id));   // selected, but not admin/manager there

    const key = `${payload.userId}:${period}:${projects.map((p) => p.id).join(',')}`;
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < CACHE_MS && sp.get('fresh') !== '1') return apiSuccess(hit.data);

    const wsIds = projects.map((p) => p.id);
    // IN () is invalid SQL — use an id that never exists when nothing is selected
    const inWs = wsIds.length ? wsIds.map(() => '?').join(',') : '?';
    if (!wsIds.length) wsIds.push(0);
    const { start, end, byHour } = periodRange(period);

    const periodChats = `
      SELECT workspace_id, contact_id FROM messages
      WHERE workspace_id IN (${inWs}) AND direction = 'inbound' AND type IN ${ALL_TYPES}
        AND created_at >= ? AND created_at < ?
      GROUP BY workspace_id, contact_id`;

    const [chatRows, msgRows, nowRows, intervenedRows, seriesRows, members, events] = await Promise.all([
      // Period chats per project × current owner
      query<RowDataPacket[]>(
        `SELECT x.workspace_id AS ws, c.assigned_agent_id AS aid, COUNT(*) AS chats,
           SUM(NOT EXISTS (SELECT 1 FROM messages p WHERE p.contact_id = x.contact_id
                           AND p.direction = 'inbound' AND p.created_at < ?)) AS new_chats,
           SUM(EXISTS (SELECT 1 FROM messages r WHERE r.contact_id = x.contact_id
                       AND r.direction = 'outbound' AND r.type NOT IN ('template','')
                       AND r.created_at >= ? AND r.created_at < ?)) AS replied,
           SUM(c.chat_status = 'resolved')   AS resolved,
           SUM(c.chat_status = 'intervened') AS intervened
         FROM (${periodChats}) x JOIN contacts c ON c.id = x.contact_id
         GROUP BY x.workspace_id, c.assigned_agent_id`,
        [start, start, end, ...wsIds, start, end]
      ),
      // Messages in / out
      query<RowDataPacket[]>(
        `SELECT workspace_id AS ws, direction, (type = 'template') AS tpl, COUNT(*) AS n FROM messages
         WHERE workspace_id IN (${inWs}) AND direction IN ('inbound','outbound') AND type IN ${ALL_TYPES}
           AND created_at >= ? AND created_at < ?
         GROUP BY workspace_id, direction, (type = 'template')`,
        [...wsIds, start, end]
      ),
      // Right now: open chats (last 24h) per project × owner
      query<RowDataPacket[]>(
        `SELECT workspace_id AS ws, assigned_agent_id AS aid, COUNT(*) AS open24,
           SUM(last_message_at <= last_inbound_at) AS waiting
         FROM contacts
         WHERE workspace_id IN (${inWs}) AND last_inbound_at >= UTC_TIMESTAMP() - INTERVAL 24 HOUR
           AND (chat_status IS NULL OR chat_status != 'resolved')
         GROUP BY workspace_id, assigned_agent_id`,
        wsIds
      ),
      // Right now: intervened — most rows carry only the intervened_by name
      query<RowDataPacket[]>(
        `SELECT workspace_id AS ws, assigned_agent_id AS aid, TRIM(intervened_by) AS by_name, COUNT(*) AS n
         FROM contacts WHERE workspace_id IN (${inWs}) AND chat_status = 'intervened'
         GROUP BY workspace_id, assigned_agent_id, TRIM(intervened_by)`,
        wsIds
      ),
      // Chats per hour / day, India time
      query<RowDataPacket[]>(
        `SELECT DATE_FORMAT(created_at + INTERVAL 330 MINUTE, ?) AS b, COUNT(DISTINCT contact_id) AS n
         FROM messages
         WHERE workspace_id IN (${inWs}) AND direction = 'inbound' AND type IN ${ALL_TYPES}
           AND created_at >= ? AND created_at < ?
         GROUP BY b ORDER BY b`,
        [byHour ? '%H' : '%Y-%m-%d', ...wsIds, start, end]
      ),
      // People in these projects + Active/Break/Offline
      query<RowDataPacket[]>(
        `SELECT wm.user_id AS id, u.name, LOWER(TRIM(wm.role)) AS role, wm.workspace_id AS ws,
           a.status, (a.last_seen_at > UTC_TIMESTAMP() - INTERVAL ${ONLINE_WINDOW_MIN} MINUTE) AS fresh
         FROM workspace_members wm JOIN users u ON u.id = wm.user_id
         LEFT JOIN agent_availability a ON a.user_id = wm.user_id
         WHERE wm.workspace_id IN (${inWs}) AND LOWER(TRIM(wm.role)) IN ('admin','manager','agent')`,
        wsIds
      ).catch(() => query<RowDataPacket[]>(
        `SELECT wm.user_id AS id, u.name, LOWER(TRIM(wm.role)) AS role, wm.workspace_id AS ws, NULL AS status, 0 AS fresh
         FROM workspace_members wm JOIN users u ON u.id = wm.user_id
         WHERE wm.workspace_id IN (${inWs}) AND LOWER(TRIM(wm.role)) IN ('admin','manager','agent')`,
        wsIds
      )),
      // History per person — only once migration-agent-chat-events.sql has run
      query<RowDataPacket[]>(
        `SELECT user_id AS id, event, COUNT(DISTINCT contact_id) AS n FROM agent_chat_events
         WHERE workspace_id IN (${inWs}) AND created_at >= ? AND created_at < ?
         GROUP BY user_id, event`,
        [...wsIds, start, end]
      ).catch(() => null),
    ]);

    // ── per project ──
    const blank = () => ({
      chats: 0, new_chats: 0, replied: 0, resolved: 0, intervened_period: 0,
      msgs_in: 0, msgs_out: 0, templates: 0,
      open24: 0, waiting: 0, unassigned_waiting: 0, intervened_now: 0,
    });
    const byWs = new Map(projects.map((p) => [p.id, { id: p.id, name: p.name, ...blank() }]));
    for (const r of chatRows) {
      const p = byWs.get(n(r.ws)); if (!p) continue;
      p.chats += n(r.chats); p.new_chats += n(r.new_chats); p.replied += n(r.replied);
      p.resolved += n(r.resolved); p.intervened_period += n(r.intervened);
    }
    for (const r of msgRows) {
      const p = byWs.get(n(r.ws)); if (!p) continue;
      if (r.direction === 'inbound') p.msgs_in += n(r.n);
      else { p.msgs_out += n(r.n); if (n(r.tpl)) p.templates += n(r.n); }
    }
    for (const r of nowRows) {
      const p = byWs.get(n(r.ws)); if (!p) continue;
      p.open24 += n(r.open24); p.waiting += n(r.waiting);
      if (r.aid == null) p.unassigned_waiting += n(r.waiting);
    }
    for (const r of intervenedRows) {
      const p = byWs.get(n(r.ws)); if (p) p.intervened_now += n(r.n);
    }

    // ── per person ──
    type Person = {
      id: number | null; name: string; role: string; status: string; projects: string[];
      open24: number; waiting: number; intervened_now: number; period_chats: number; period_resolved: number;
      assigned: number | null; intervened: number | null; resolved: number | null;
    };
    const wsName = new Map(projects.map((p) => [p.id, p.name]));
    const people = new Map<string, Person>();
    const byName = new Map<string, string>();   // lower(name) → key
    const rank: Record<string, number> = { admin: 0, manager: 1, agent: 2 };
    for (const m of members) {
      const k = `u${n(m.id)}`;
      const p = people.get(k) || {
        id: n(m.id), name: String(m.name || `User ${m.id}`), role: String(m.role),
        status: m.status == null ? 'unknown' : n(m.fresh) ? String(m.status) : 'offline',
        projects: [], open24: 0, waiting: 0, intervened_now: 0, period_chats: 0, period_resolved: 0,
        assigned: events ? 0 : null, intervened: events ? 0 : null, resolved: events ? 0 : null,
      };
      // "manager" beats "agent" etc. when roles differ across projects
      if ((rank[m.role] ?? 3) < (rank[p.role] ?? 3)) p.role = String(m.role);
      const pn = wsName.get(n(m.ws)); if (pn && !p.projects.includes(pn)) p.projects.push(pn);
      people.set(k, p);
      byName.set(p.name.trim().toLowerCase(), k);
    }
    const personFor = (aid: unknown, name?: string | null): Person | null => {
      if (aid != null) return people.get(`u${n(aid)}`) || null;
      const nm = String(name || '').trim();
      if (!nm) return null;
      const k = byName.get(nm.toLowerCase());
      if (k) return people.get(k)!;
      // Someone no longer in the project — still show their intervened chats
      const ek = `n:${nm.toLowerCase()}`;
      if (!people.has(ek)) {
        people.set(ek, { id: null, name: nm, role: '', status: 'unknown', projects: [], open24: 0, waiting: 0,
          intervened_now: 0, period_chats: 0, period_resolved: 0, assigned: null, intervened: null, resolved: null });
        byName.set(nm.toLowerCase(), ek);
      }
      return people.get(ek)!;
    };
    for (const r of chatRows) { const p = r.aid != null ? personFor(r.aid) : null; if (p) { p.period_chats += n(r.chats); p.period_resolved += n(r.resolved); } }
    for (const r of nowRows) { const p = r.aid != null ? personFor(r.aid) : null; if (p) { p.open24 += n(r.open24); p.waiting += n(r.waiting); } }
    for (const r of intervenedRows) { const p = personFor(r.aid, r.by_name); if (p) p.intervened_now += n(r.n); }
    for (const e of events || []) {
      const p = people.get(`u${n(e.id)}`);
      if (p && (e.event === 'assigned' || e.event === 'intervened' || e.event === 'resolved')) p[e.event as 'assigned'] = n(e.n);
    }

    const projectList = Array.from(byWs.values()).sort((a, b) => b.chats - a.chats || b.open24 - a.open24 || a.name.localeCompare(b.name));
    const agentList = Array.from(people.values())
      // Hide people with nothing to show, except agents/managers (they should be visible even at 0)
      .filter((p) => p.role === 'agent' || p.role === 'manager' ||
        p.open24 + p.intervened_now + p.period_chats + (p.assigned || 0) + (p.resolved || 0) + (p.intervened || 0) > 0)
      .sort((a, b) => (b.open24 + b.intervened_now + b.period_chats) - (a.open24 + a.intervened_now + a.period_chats) || a.name.localeCompare(b.name));

    const totals = blank();
    for (const p of projectList) for (const k of Object.keys(totals) as (keyof typeof totals)[]) totals[k] += p[k];

    // Full axis: every hour 00–23, or every day of the range
    const counts = new Map(seriesRows.map((r) => [String(r.b), n(r.n)]));
    const series: { label: string; chats: number }[] = [];
    if (byHour) {
      for (let h = 0; h < 24; h++) { const b = String(h).padStart(2, '0'); series.push({ label: `${b}:00`, chats: counts.get(b) || 0 }); }
    } else {
      const days = period === '7d' ? 7 : 30;
      const startMs = Date.parse(start.replace(' ', 'T') + 'Z') + IST_MS;
      for (let d = 0; d < days; d++) {
        const day = new Date(startMs + d * 86_400_000).toISOString().slice(0, 10);
        series.push({ label: day.slice(8, 10) + '/' + day.slice(5, 7), chats: counts.get(day) || 0 });
      }
    }

    const data = {
      period, start, end, byHour,
      allProjects, skipped, totals, projects: projectList, agents: agentList, series,
      eventsAvailable: events !== null,
      generatedAt: new Date().toISOString(),
    };
    cache.set(key, { at: Date.now(), data });
    if (cache.size > 500) cache.delete(cache.keys().next().value as string);
    return apiSuccess(data);
  } catch (err) {
    if (err instanceof Error && err.message === 'UNAUTHORIZED') return apiError('Unauthorized', 401);
    console.error('[dashboard/chat-stats]', err);
    return apiError('Server error', 500);
  }
}
