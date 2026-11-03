/**
 * POST /api/contacts/bulk-resolve
 * Resolve EVERY chat whose latest button reply matches — e.g. all
 * "Not Interested" taps in one go. Optionally scoped to one campaign.
 * Body: { button_reply: "Not Interested", campaign_id?: 12 }
 * → { resolved: n }
 *
 * Roles: admin & manager → whole workspace. agent → only the chats they can
 * see in their inbox (same visibility rule as GET /api/contacts).
 */
import { NextRequest } from 'next/server';
import { requireAuth, resolveWorkspaceScopes, WorkspaceScope } from '@/lib/auth';
import { query, execute } from '@/lib/db';
import { apiSuccess, apiError } from '@/lib/utils';
import { RowDataPacket } from 'mysql2';
import { poolView } from '@/lib/autoAssign';
import { logAgentEventBulk } from '@/lib/agentEvents';

export async function POST(req: NextRequest) {
  try {
    const payload = await requireAuth(req);

    const body = await req.json() as { button_reply?: string; campaign_id?: number; workspaces?: string };
    const buttonReply = String(body.button_reply || '').trim();
    if (!buttonReply) return apiError('button_reply is required', 400);
    const campaignId = Number(body.campaign_id) || 0;

    // Combined inbox: every shown project, each with this user's role there
    const scopes = await resolveWorkspaceScopes(payload, body.workspaces || null);
    let resolved = 0;
    for (const scope of scopes) resolved += await resolveIn(scope, payload.userId, buttonReply, campaignId);

    // Audit trail in server logs — bulk actions should be traceable
    const u = await query<RowDataPacket[]>('SELECT email FROM users WHERE id = ? LIMIT 1', [payload.userId]).catch(() => []);
    console.log(`[bulk-resolve] ${resolved} chats resolved (reply="${buttonReply}"${campaignId ? `, campaign=${campaignId}` : ''}, projects=${scopes.map((s) => s.workspaceId).join(',')}) by ${(u as RowDataPacket[])[0]?.email || payload.userId}`);

    return apiSuccess({ resolved });
  } catch (err) {
    if (err instanceof Error && err.message === 'UNAUTHORIZED') return apiError('Unauthorized', 401);
    console.error('[contacts/bulk-resolve]', err);
    return apiError('Server error', 500);
  }
}

async function resolveIn({ workspaceId, role }: WorkspaceScope, userId: number, buttonReply: string, campaignId: number) {
  // Same "latest tap wins" rule as the inbox filter, so what you see is what
  // gets resolved. Only currently-unresolved chats count toward the total.
  let where = `
    WHERE c.workspace_id = ?
      AND (c.chat_status IS NULL OR c.chat_status != 'resolved')
      AND (SELECT bm.content FROM messages bm
           WHERE bm.contact_id = c.id AND bm.direction = 'inbound'
             AND (bm.type = 'button' OR (bm.type = '' AND bm.content NOT LIKE '⚠%' AND bm.content NOT LIKE '{%'))
           ORDER BY bm.id DESC LIMIT 1) = ?`;
  const params: unknown[] = [workspaceId, buttonReply];

  // Agents: mirror the inbox visibility rule so they can only resolve what
  // they can see — their assigned chats, plus the unassigned pool limited to
  // their campaigns (or everything unassigned if they have no campaigns).
  if (await poolView(workspaceId, role, userId)) {
    // Auto-assign member: own chats + the unassigned pool
    where += ` AND (c.assigned_agent_id = ${Number(userId)} OR c.assigned_agent_id IS NULL)`;
  } else if (role === 'agent') {
    const uid = Number(userId);
    where += ` AND (
      c.assigned_agent_id = ${uid}
      OR (
        c.assigned_agent_id IS NULL
        AND (
          NOT EXISTS (SELECT 1 FROM campaign_assignments WHERE agent_id = ${uid} LIMIT 1)
          OR c.id IN (
            SELECT cc.contact_id FROM campaign_contacts cc
            JOIN campaign_assignments ca ON ca.campaign_id = cc.campaign_id
            WHERE ca.agent_id = ${uid}
          )
        )
      )
    )`;
  }
  if (campaignId) {
    where += ` AND c.id IN (
      SELECT contact_id FROM campaign_contacts WHERE campaign_id = ?
      UNION
      SELECT contact_id FROM messages WHERE campaign_id = ? AND direction = 'outbound'
    )`;
    params.push(campaignId, campaignId);
  }

  // Log first — after the UPDATE these chats no longer match "unresolved"
  await logAgentEventBulk(workspaceId, userId, 'resolved', `FROM contacts c ${where}`, params);
  return execute(`UPDATE contacts c SET c.chat_status = 'resolved' ${where}`, params);   // returns affectedRows
}
