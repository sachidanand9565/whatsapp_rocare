/**
 * lib/activeCalls.ts — calls currently ringing, per workspace.
 *
 * SSE has no replay: a panel opened AFTER the incoming_call event (e.g. the
 * agent tapped the push notification) would never learn about the ringing
 * call. The webhook / relay records it here; GET /api/calling/ringing serves it
 * so a CallManager can show the popup mid-ring.
 * Several customers can ring the same number at once — every ringing call is
 * kept, by call id.
 *
 * Stored in the ringing_calls table (migration-ringing-calls.sql) so every
 * server instance sees the same list — on Vercel each relayed event reaches
 * only one instance. Until that table exists, falls back to this process's memory.
 */
import { query, execute } from '@/lib/db';
import { RowDataPacket } from 'mysql2';

export interface RingingCall {
  callId:      string;
  workspaceId: number;
  contactId?:  number;
  callerName:  string;
  callerPhone: string;
  sdp?:        string;   // caller's SDP offer — needed to answer
  at:          number;   // Date.now() when ringing started
}

// WhatsApp rings out in ~60s; keep a small buffer then treat as stale.
const TTL_MS = 75_000;

const memory = new Map<number, Map<string, RingingCall>>();

// null = not checked yet; flips to false once if the table is missing
let tableReady: boolean | null = null;
function tableMissing(err: unknown) {
  if (err instanceof Error && /ringing_calls/.test(err.message)) tableReady = false;
}

export async function setRinging(workspaceId: number, call: Omit<RingingCall, 'at' | 'workspaceId'>) {
  let calls = memory.get(workspaceId);
  if (!calls) { calls = new Map(); memory.set(workspaceId, calls); }
  calls.set(call.callId, { ...call, workspaceId, at: Date.now() });
  if (tableReady === false) return;
  try {
    await execute(
      `INSERT INTO ringing_calls (call_id, workspace_id, contact_id, caller_name, caller_phone, sdp, created_at)
       VALUES (?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(3))
       ON DUPLICATE KEY UPDATE sdp = VALUES(sdp)`,
      [call.callId, workspaceId, call.contactId ?? null, call.callerName || '', call.callerPhone || '', call.sdp ?? null]
    );
    tableReady = true;
  } catch (err) { tableMissing(err); }
}

/** Clear when the call is answered/rejected/ended. callId omitted = clear all. */
export async function clearRinging(workspaceId: number, callId?: string) {
  const calls = memory.get(workspaceId);
  if (calls) {
    if (callId) calls.delete(callId); else calls.clear();
    if (calls.size === 0) memory.delete(workspaceId);
  }
  if (tableReady === false) return;
  try {
    if (callId) await execute('DELETE FROM ringing_calls WHERE call_id = ?', [callId]);
    else await execute('DELETE FROM ringing_calls WHERE workspace_id = ?', [workspaceId]);
  } catch (err) { tableMissing(err); }
}

/**
 * Every call still ringing in these workspaces, oldest first.
 * `shared` = read from the table every instance writes to, so a call missing
 * from the list really has stopped ringing (the panel may drop its popup).
 */
export async function getRingingCalls(workspaceIds: number[]): Promise<{ calls: RingingCall[]; shared: boolean }> {
  if (workspaceIds.length === 0) return { calls: [], shared: tableReady !== false };
  if (tableReady !== false) {
    try {
      const rows = await query<RowDataPacket[]>(
        `SELECT call_id, workspace_id, contact_id, caller_name, caller_phone, sdp,
           TIMESTAMPDIFF(MICROSECOND, created_at, UTC_TIMESTAMP(3)) DIV 1000 AS age_ms
         FROM ringing_calls
         WHERE workspace_id IN (${workspaceIds.map(() => '?').join(',')})
           AND created_at > UTC_TIMESTAMP(3) - INTERVAL ${TTL_MS / 1000} SECOND
         ORDER BY created_at ASC`,
        workspaceIds
      );
      tableReady = true;
      // Stale rows (rang out with no terminate event seen) — tidy up now and then
      if (Math.random() < 0.05) {
        execute(`DELETE FROM ringing_calls WHERE created_at < UTC_TIMESTAMP(3) - INTERVAL ${TTL_MS / 1000} SECOND`).catch(() => {});
      }
      const now = Date.now();
      return {
        shared: true,
        calls: rows.map((r) => ({
          callId:      r.call_id as string,
          workspaceId: Number(r.workspace_id),
          contactId:   r.contact_id == null ? undefined : Number(r.contact_id),
          callerName:  (r.caller_name as string) || '',
          callerPhone: (r.caller_phone as string) || '',
          sdp:         (r.sdp as string) || undefined,
          at:          now - Number(r.age_ms),
        })),
      };
    } catch (err) { tableMissing(err); }
  }
  const now = Date.now();
  const calls: RingingCall[] = [];
  for (const ws of workspaceIds) {
    const m = memory.get(ws);
    if (!m) continue;
    for (const [id, c] of Array.from(m)) {
      if (now - c.at > TTL_MS) m.delete(id); else calls.push(c);
    }
  }
  return { calls: calls.sort((a, b) => a.at - b.at), shared: false };
}
