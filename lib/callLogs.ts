/**
 * lib/callLogs.ts — call history writes (table: call_logs, see migration-calling.sql)
 *
 * All writers are best-effort: if the migration hasn't run yet the table is
 * missing and we log once + skip, never breaking webhooks or the softphone.
 */
import { execute } from '@/lib/db';
import { utcNow } from '@/lib/utils';

let tableMissing = false;
function isMissing(e: unknown): boolean {
  return (e as { code?: string })?.code === 'ER_NO_SUCH_TABLE';
}
async function safe(fn: () => Promise<unknown>) {
  if (tableMissing) return;
  try { await fn(); } catch (e) {
    if (isMissing(e)) { tableMissing = true; console.warn('[call_logs] table missing — run migration-calling.sql'); }
    else console.warn('[call_logs]', (e as Error).message);
  }
}

/** Ringing started (connect webhook, or we placed an outbound call). */
export async function logCallStart(o: {
  workspaceId: number; contactId: number | null; callId: string;
  direction: 'inbound' | 'outbound'; agentId?: number | null; startedAt?: string;
}) {
  const now = utcNow();
  await safe(() => execute(
    `INSERT INTO call_logs (workspace_id, contact_id, call_id, direction, status, agent_id, started_at, created_at)
     VALUES (?, ?, ?, ?, 'ringing', ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       contact_id = COALESCE(VALUES(contact_id), contact_id),
       agent_id   = COALESCE(VALUES(agent_id),   agent_id)`,
    [o.workspaceId, o.contactId, o.callId, o.direction, o.agentId ?? null, o.startedAt || now, now]
  ));
}

/** Agent answered (inbound accept) — attribute the call to them. */
export async function logCallAnswered(callId: string, agentId: number) {
  await safe(() => execute(
    'UPDATE call_logs SET agent_id = ?, answered_at = COALESCE(answered_at, ?) WHERE call_id = ?',
    [agentId, utcNow(), callId]
  ));
}

/** Agent pressed Decline. */
export async function logCallRejected(callId: string, agentId: number) {
  await safe(() => execute(
    "UPDATE call_logs SET status = 'rejected', agent_id = COALESCE(agent_id, ?), ended_at = COALESCE(ended_at, ?) WHERE call_id = ?",
    [agentId, utcNow(), callId]
  ));
}

/** Terminate webhook — final outcome. Inserts if we somehow never saw the ring. */
export async function logCallEnded(o: {
  workspaceId: number; contactId: number | null; callId: string;
  direction: 'inbound' | 'outbound'; answered: boolean; durationSec: number;
  startedAt?: string; endedAt?: string;
}) {
  const now = utcNow();
  const finalStatus = o.answered ? 'completed' : 'missed';
  await safe(() => execute(
    `INSERT INTO call_logs (workspace_id, contact_id, call_id, direction, status, started_at, ended_at, duration_sec, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       contact_id   = COALESCE(VALUES(contact_id), contact_id),
       -- keep an explicit agent 'rejected' verdict; otherwise Meta's outcome wins
       status       = IF(status = 'rejected' AND VALUES(status) = 'missed', 'rejected', VALUES(status)),
       started_at   = COALESCE(started_at, VALUES(started_at)),
       ended_at     = VALUES(ended_at),
       duration_sec = VALUES(duration_sec)`,
    [o.workspaceId, o.contactId, o.callId, o.direction, finalStatus, o.startedAt || now, o.endedAt || now, o.durationSec, now]
  ));
}
