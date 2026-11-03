/**
 * GET  /api/availability — my status: active | break | offline
 * POST /api/availability — { status } to switch, or { heartbeat: true } every
 *   minute from an open panel. A heartbeat turns Offline back into Active (fresh
 *   login / reopened panel) but leaves Break alone. Both run the auto-assign
 *   sweep for the user's projects; going on Break / Offline sweeps right away so
 *   their waiting chats move to whoever is Active.
 * Both return autoAssign: whether this user gets chats automatically anywhere.
 */
import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { query, execute } from '@/lib/db';
import { apiSuccess, apiError } from '@/lib/utils';
import { sweepForUser, isAutoAssignAnywhere, ONLINE_WINDOW_MIN } from '@/lib/autoAssign';
import { RowDataPacket } from 'mysql2';

const STATUSES = ['active', 'break', 'offline'] as const;
type Status = typeof STATUSES[number];

async function myStatus(userId: number): Promise<Status> {
  const rows = await query<RowDataPacket[]>(
    `SELECT status,
       last_seen_at > UTC_TIMESTAMP() - INTERVAL ${ONLINE_WINDOW_MIN} MINUTE AS fresh
     FROM agent_availability WHERE user_id = ? LIMIT 1`,
    [userId]
  );
  if (!rows.length || !rows[0].fresh) return 'offline';
  return rows[0].status as Status;
}

export async function GET(req: NextRequest) {
  try {
    const payload = await requireAuth(req);
    return apiSuccess({ status: await myStatus(payload.userId), autoAssign: await isAutoAssignAnywhere(payload.userId) });
  } catch (err) {
    if (err instanceof Error && err.message === 'UNAUTHORIZED') return apiError('Unauthorized', 401);
    console.error('[availability GET]', err);
    return apiError('Server error', 500);
  }
}

export async function POST(req: NextRequest) {
  try {
    const payload = await requireAuth(req);
    const body = await req.json().catch(() => ({})) as { status?: string; heartbeat?: boolean };

    if (body.status) {
      if (!STATUSES.includes(body.status as Status)) return apiError('Invalid status');
      await execute(
        `INSERT INTO agent_availability (user_id, status, last_seen_at) VALUES (?, ?, UTC_TIMESTAMP())
         ON DUPLICATE KEY UPDATE status = VALUES(status), last_seen_at = UTC_TIMESTAMP()`,
        [payload.userId, body.status]
      );
      await sweepForUser(payload.userId, body.status !== 'active');
    } else if (body.heartbeat) {
      await execute(
        `INSERT INTO agent_availability (user_id, status, last_seen_at) VALUES (?, 'active', UTC_TIMESTAMP())
         ON DUPLICATE KEY UPDATE status = IF(status = 'offline', 'active', status), last_seen_at = UTC_TIMESTAMP()`,
        [payload.userId]
      );
      await sweepForUser(payload.userId);
    } else {
      return apiError('status or heartbeat is required');
    }
    // autoAssign: the header shows the Active / Break switch only to auto-assign members
    return apiSuccess({ status: await myStatus(payload.userId), autoAssign: await isAutoAssignAnywhere(payload.userId) });
  } catch (err) {
    if (err instanceof Error && err.message === 'UNAUTHORIZED') return apiError('Unauthorized', 401);
    console.error('[availability POST]', err);
    return apiError('Server error', 500);
  }
}
