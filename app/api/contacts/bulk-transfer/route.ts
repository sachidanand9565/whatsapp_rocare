/**
 * Move picked chats to one person at once.
 *
 * GET  /api/contacts/bulk-transfer?workspaces=1,2
 *   Who chats can go to: members (admin/manager/agent) of the shown projects
 *   where the caller is admin or manager, with their Active / Break / Offline
 *   status, open chats and which of those projects they are in.
 * POST /api/contacts/bulk-transfer
 *   { contact_ids: number[], to_user_id, workspaces? } → { transferred, skipped }
 *   { contact_ids: number[], to: 'active', workspaces? }  spread over the Active
 *     members of each chat's project, least busy first → { transferred, skipped, to: [{name, count}] }
 *   A chat is skipped when the caller isn't admin/manager of its project or
 *   the target isn't a member of it.
 */
import { NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { apiSuccess, apiError } from '@/lib/utils';
import { managedWorkspaces, listTransferPeople, moveChats, emitMoved, userName } from '@/lib/chatTransfer';
import { RowDataPacket } from 'mysql2';

const MAX_IDS = 2000;

export async function GET(req: NextRequest) {
  try {
    const { wsIds } = await managedWorkspaces(req, req.nextUrl.searchParams.get('workspaces'));
    if (wsIds.length === 0) return apiError('Admin or manager only', 403);
    return apiSuccess(await listTransferPeople(wsIds));
  } catch (err) {
    if (err instanceof Error && err.message === 'UNAUTHORIZED') return apiError('Unauthorized', 401);
    console.error('[contacts/bulk-transfer GET]', err);
    return apiError('Server error', 500);
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as { contact_ids?: unknown[]; to_user_id?: number; to?: string; workspaces?: string };
    const { payload, wsIds } = await managedWorkspaces(req, body.workspaces || null);
    if (wsIds.length === 0) return apiError('Admin or manager only', 403);

    const ids = Array.from(new Set((body.contact_ids || []).map(Number).filter((n) => Number.isInteger(n) && n > 0)));
    if (ids.length === 0) return apiError('Select at least one chat');
    if (ids.length > MAX_IDS) return apiError(`At most ${MAX_IDS} chats at a time`);
    if (body.to === 'active') return spreadToActive(ids, wsIds, await userName(payload.userId, payload.email));

    const toUserId = Number(body.to_user_id);
    if (!toUserId) return apiError('to_user_id is required');

    const [actorName, targetName, targetWs] = await Promise.all([
      userName(payload.userId, payload.email),
      userName(toUserId),
      query<RowDataPacket[]>(
        `SELECT workspace_id FROM workspace_members
         WHERE user_id = ? AND LOWER(TRIM(role)) IN ('admin','manager','agent')`, [toUserId]),
    ]);
    if (!targetName) return apiError('That person was not found', 404);
    const targetIn = new Set(targetWs.map((r) => Number(r.workspace_id)));

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

    const moved: { ws: number; id: number }[] = [];
    for (const [ws, list] of Array.from(byWs.entries())) {
      const changed = await moveChats(ws, list, { id: toUserId, name: targetName }, actorName);
      changed.forEach((id) => moved.push({ ws, id }));
    }
    emitMoved(moved);

    console.log(`[bulk-transfer] ${moved.length} chats → ${targetName} (#${toUserId}) by user #${payload.userId}, projects=${Array.from(byWs.keys()).join(',')}`);
    // skipped = not allowed / not found / already theirs
    return apiSuccess({ transferred: moved.length, skipped: ids.length - moved.length });
  } catch (err) {
    if (err instanceof Error && err.message === 'UNAUTHORIZED') return apiError('Unauthorized', 401);
    console.error('[contacts/bulk-transfer POST]', err);
    return apiError('Server error', 500);
  }
}

/** Each chat to the least busy Active member of its project (never back to its current owner). */
async function spreadToActive(ids: number[], wsIds: number[], actorName: string) {
  const people = (await listTransferPeople(wsIds)).filter((p) => p.status === 'active');
  if (people.length === 0) return apiError('Nobody is Active right now', 409);
  const load = new Map(people.map((p) => [p.id, p.open_chats]));

  const chats = await query<RowDataPacket[]>(
    `SELECT id, workspace_id, assigned_agent_id FROM contacts WHERE id IN (${ids.map(() => '?').join(',')}) ORDER BY id`, ids
  );
  // ws → person → chat ids
  const plan = new Map<number, Map<number, number[]>>();
  for (const c of chats) {
    const ws = Number(c.workspace_id);
    if (!wsIds.includes(ws)) continue;
    const owner = c.assigned_agent_id == null ? null : Number(c.assigned_agent_id);
    const cands = people.filter((p) => p.workspaces.includes(ws) && p.id !== owner);
    if (cands.length === 0) continue;
    const best = cands.reduce((a, b) => ((load.get(b.id) ?? 0) < (load.get(a.id) ?? 0) ? b : a));
    load.set(best.id, (load.get(best.id) ?? 0) + 1);
    const byPerson = plan.get(ws) || new Map<number, number[]>();
    byPerson.set(best.id, [...(byPerson.get(best.id) || []), Number(c.id)]);
    plan.set(ws, byPerson);
  }

  const moved: { ws: number; id: number }[] = [];
  const perPerson = new Map<number, number>();
  for (const [ws, byPerson] of Array.from(plan.entries())) {
    for (const [pid, list] of Array.from(byPerson.entries())) {
      const p = people.find((x) => x.id === pid)!;
      const changed = await moveChats(ws, list, { id: p.id, name: p.name }, actorName);
      changed.forEach((id) => moved.push({ ws, id }));
      perPerson.set(pid, (perPerson.get(pid) || 0) + changed.length);
    }
  }
  emitMoved(moved);
  console.log(`[bulk-transfer] ${moved.length} chats spread over Active members by ${actorName}`);
  return apiSuccess({
    transferred: moved.length,
    skipped: ids.length - moved.length,
    to: Array.from(perPerson.entries()).filter(([, n]) => n > 0)
      .map(([pid, count]) => ({ name: people.find((x) => x.id === pid)!.name, count })),
  });
}
