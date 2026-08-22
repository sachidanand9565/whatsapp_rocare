/**
 * lib/push.ts — Web Push for incoming-call alerts (tables: migration-push.sql)
 *
 * VAPID keys are generated once and stored in the push_vapid table, so there
 * is nothing to configure. All senders are best-effort: a missing table or a
 * dead subscription must never break the webhook.
 */
import webpush from 'web-push';
import { query, execute } from '@/lib/db';
import { utcNow } from '@/lib/utils';
import { RowDataPacket } from 'mysql2';

let vapidLoaded: { publicKey: string; privateKey: string } | null = null;
let tableMissingUntil = 0;
const tableMissing = () => Date.now() < tableMissingUntil;
function noteMissing(e: unknown): boolean {
  if ((e as { code?: string })?.code !== 'ER_NO_SUCH_TABLE') return false;
  tableMissingUntil = Date.now() + 60_000;
  console.warn('[push] tables missing — run migration-push.sql');
  return true;
}

/** Get (or create on first call) the server's VAPID keypair. Null until migration runs. */
export async function getVapidKeys(): Promise<{ publicKey: string; privateKey: string } | null> {
  if (vapidLoaded) return vapidLoaded;
  if (tableMissing()) return null;
  try {
    const rows = await query<RowDataPacket[]>('SELECT public_key, private_key FROM push_vapid WHERE id = 1 LIMIT 1');
    if (rows.length > 0) {
      vapidLoaded = { publicKey: rows[0].public_key as string, privateKey: rows[0].private_key as string };
      return vapidLoaded;
    }
    const keys = webpush.generateVAPIDKeys();
    // INSERT IGNORE: two racing requests → first wins, re-read below
    await execute(
      'INSERT IGNORE INTO push_vapid (id, public_key, private_key, created_at) VALUES (1, ?, ?, ?)',
      [keys.publicKey, keys.privateKey, utcNow()]
    );
    const again = await query<RowDataPacket[]>('SELECT public_key, private_key FROM push_vapid WHERE id = 1 LIMIT 1');
    vapidLoaded = { publicKey: again[0].public_key as string, privateKey: again[0].private_key as string };
    return vapidLoaded;
  } catch (e) {
    if (!noteMissing(e)) console.warn('[push] vapid load failed:', (e as Error).message);
    return null;
  }
}

export interface PushSubscriptionInput {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

export async function saveSubscription(workspaceId: number, userId: number, sub: PushSubscriptionInput) {
  await execute(
    `INSERT INTO push_subscriptions (workspace_id, user_id, endpoint, p256dh, auth, created_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE workspace_id = VALUES(workspace_id), user_id = VALUES(user_id),
       p256dh = VALUES(p256dh), auth = VALUES(auth)`,
    [workspaceId, userId, sub.endpoint, sub.keys.p256dh, sub.keys.auth, utcNow()]
  );
}

export async function deleteSubscription(endpoint: string) {
  await execute('DELETE FROM push_subscriptions WHERE endpoint = ?', [endpoint]).catch(() => {});
}

/**
 * Send a notification to every subscribed device in the workspace.
 * Fire-and-forget: call WITHOUT await from webhooks. Dead endpoints
 * (uninstalled/expired, HTTP 404/410) are pruned automatically.
 */
export async function sendPushToWorkspace(
  workspaceId: number,
  payload: { title: string; body?: string; tag?: string; url?: string },
  opts?: { userId?: number }
): Promise<{ devices: number }> {
  if (tableMissing()) return { devices: 0 };
  try {
    const vapid = await getVapidKeys();
    if (!vapid) return { devices: 0 };
    const subs = await query<RowDataPacket[]>(
      `SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE workspace_id = ?${opts?.userId ? ' AND user_id = ?' : ''}`,
      opts?.userId ? [workspaceId, opts.userId] : [workspaceId]
    );
    if (subs.length === 0) {
      console.warn(`[push] no subscribed devices for workspace ${workspaceId} — nothing sent`);
      return { devices: 0 };
    }

    const json = JSON.stringify(payload);
    await Promise.all(subs.map(async (s) => {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint as string, keys: { p256dh: s.p256dh as string, auth: s.auth as string } },
          json,
          {
            vapidDetails: {
              subject: 'mailto:admin@limbu.ai',
              publicKey: vapid.publicKey, privateKey: vapid.privateKey,
            },
            TTL: 60,          // a ring older than a minute is useless — drop it
            urgency: 'high',  // wake the device radio for calls
          }
        );
      } catch (e) {
        const code = (e as { statusCode?: number })?.statusCode;
        if (code === 404 || code === 410) await deleteSubscription(s.endpoint as string);
        else console.warn('[push] send failed:', code || (e as Error).message);
      }
    }));
    return { devices: subs.length };
  } catch (e) {
    if (!noteMissing(e)) console.warn('[push]', (e as Error).message);
    return { devices: 0 };
  }
}
