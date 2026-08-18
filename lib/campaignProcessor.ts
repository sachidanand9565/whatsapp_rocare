/**
 * lib/campaignProcessor.ts
 * Campaign send engine — runs one processing "tick" over all running campaigns.
 *
 * Called from:
 *  - the internal in-app cron (instrumentation.ts starts it on server boot;
 *    the app runs on a long-lived AWS server, so setInterval survives — no
 *    platform cron needed)
 *  - GET /api/campaigns/process (manual trigger / external cron), which runs
 *    it in the background and responds immediately so proxies never 504
 */
import pool, { query, execute } from '@/lib/db';
import { sendTemplateMessage } from '@/lib/whatsapp';
import { buildComponents, parseJson } from '@/lib/campaignComponents';
import { sleep, utcNow } from '@/lib/utils';
import { RowDataPacket } from 'mysql2';

const BATCH_SIZE  = 2000; // messages per tick
const CONCURRENCY = 80;   // messages fired in parallel per wave (= Meta's default 80/sec cap)
// Meta's Cloud API throughput cap is 80 msg/sec per phone number (default tier).
// We fire a wave of CONCURRENCY sends in parallel, then pace waves so the
// sustained rate stays at TARGET_MSG_PER_SEC. The wave's own HTTP time counts
// toward its pacing window — a slow wave gets no extra sleep on top, so real
// throughput stays close to the target instead of latency + fixed delay.
const TARGET_MSG_PER_SEC = 70;
const WAVE_WINDOW_MS = Math.ceil((CONCURRENCY / TARGET_MSG_PER_SEC) * 1000);
// Stop starting new work this many ms into a tick so one tick finishes before
// the next interval fires (per-campaign DB locks also guard against overlap).
const TICK_DEADLINE_MS = 50_000;
const CRON_INTERVAL_MS = 60_000;

export interface TickCampaignResult { campaignId: number; sent: number; failed: number; note?: string }
export interface TickResult { campaigns: TickCampaignResult[]; message?: string }

// Overlap guard within this process — a slow tick must not stack on the next one
let tickRunning = false;
let cronStarted = false;

/** Start the in-app every-minute processor. Safe to call more than once. */
export function startInternalCron() {
  if (cronStarted) return;
  cronStarted = true;
  console.log('[campaign-cron] internal scheduler started (every 60s)');
  const timer = setInterval(() => {
    runProcessTick(null).catch((err) => console.error('[campaign-cron]', err));
  }, CRON_INTERVAL_MS);
  // Never keep the process alive just for the scheduler
  timer.unref?.();

  // Daily housekeeping: expire old call recordings per workspace retention
  // (first run 5 min after boot, then every 24h). Deferred import — callLogs
  // pulls in the S3 SDK, no need to load it on the hot path.
  const purge = () => import('@/lib/callLogs')
    .then((m) => m.purgeExpiredRecordings())
    .catch((err) => console.error('[recording-purge]', err));
  const first = setTimeout(() => { purge(); const daily = setInterval(purge, 24 * 60 * 60 * 1000); daily.unref?.(); }, 5 * 60 * 1000);
  first.unref?.();
}

/** Run one processing tick. onlyId limits it to a single campaign (full budget). */
export async function runProcessTick(onlyId: number | null): Promise<TickResult> {
  if (tickRunning) return { campaigns: [], message: 'tick already running' };
  tickRunning = true;
  const deadlineAt = Date.now() + TICK_DEADLINE_MS;

  try {
    // All running campaigns, oldest first — every campaign gets a turn each tick
    // (a single LIMIT 1 pick let an old API campaign with a big queue starve
    // newer broadcasts indefinitely).
    const camps = await query<RowDataPacket[]>(
      `SELECT c.*, t.name as tname, t.language, t.body_text,
              t.header_type, t.header_content, t.footer_text, t.buttons,
              w.access_token, w.phone_number_id
       FROM campaigns c
       JOIN templates t ON t.id = c.template_id
       JOIN workspaces w ON w.id = c.workspace_id
       WHERE c.status = 'running'
         AND (c.campaign_type != 'api' OR EXISTS (
               SELECT 1 FROM campaign_contacts cc
               WHERE cc.campaign_id = c.id AND cc.status = 'pending'))
         ${onlyId ? 'AND c.id = ?' : ''}
       ORDER BY c.started_at ASC`,
      onlyId ? [onlyId] : []
    );

    if (camps.length === 0) {
      return { campaigns: [], message: onlyId ? 'Campaign not running or nothing pending' : 'No running campaigns' };
    }

    // Shared per-tick budget: split fairly across campaigns (each gets at least
    // a meaningful slice; unused slices roll over to later campaigns in the loop).
    let remaining = BATCH_SIZE;
    const summary: TickCampaignResult[] = [];

    for (const camp of camps) {
      if (remaining <= 0 || Date.now() >= deadlineAt) break;

      const campaignId  = camp.id as number;
      const workspaceId = camp.workspace_id as number;

      // Guard against two overlapping invocations processing the same campaign at
      // once (manual trigger overlapping the internal cron, or a second server
      // instance) — without this, both runs can select and send to the same
      // pending contacts, double-sending real messages. A session-scoped named
      // lock on a dedicated connection serializes per-campaign work; non-blocking
      // (timeout 0) so an overlapping run just skips this campaign.
      const lockName = `campaign_process_${campaignId}`;
      const lockConn = await pool.getConnection();
      let lockAcquired = false;
      try {
        const [lockRows] = await lockConn.query('SELECT GET_LOCK(?, 0) AS locked', [lockName]);
        lockAcquired = Number((lockRows as RowDataPacket[])[0]?.locked) === 1;
        if (!lockAcquired) {
          summary.push({ campaignId, sent: 0, failed: 0, note: 'already being processed' });
          continue;
        }
        // Fair slice so the first (oldest) campaign can't eat the whole tick budget.
        // Single-campaign mode gets the full budget.
        const slice = onlyId ? remaining : Math.min(remaining, Math.max(50, Math.ceil(BATCH_SIZE / camps.length)));
        const res = await processBatch(camp, campaignId, workspaceId, slice, deadlineAt);
        remaining -= res.sent + res.failed;
        summary.push({ campaignId, ...res });
      } finally {
        if (lockAcquired) {
          try { await lockConn.query('SELECT RELEASE_LOCK(?)', [lockName]); } catch { /* connection is being released anyway */ }
        }
        lockConn.release();
      }
    }

    return { campaigns: summary };
  } finally {
    tickRunning = false;
  }
}

// Campaigns currently being drained by an immediate post-queue loop (send-bulk
// fire-and-forget) — prevents stacking a second loop on repeated API calls.
const draining = new Set<number>();

/**
 * Send a campaign's whole pending queue NOW — runs process ticks back-to-back
 * (each batch still paced at ~TARGET_MSG_PER_SEC for Meta's rate limit) until
 * nothing is pending, instead of waiting for the 60s cron to send one
 * BATCH_SIZE slice per minute.
 */
export async function drainCampaign(campaignId: number, maxTicks = 60): Promise<void> {
  if (draining.has(campaignId)) return;
  draining.add(campaignId);
  try {
    for (let i = 0; i < maxTicks; i++) {
      const res = await runProcessTick(campaignId);
      if (res.message === 'tick already running') {
        // A cron tick (or another drain) holds the global slot — wait it out.
        await sleep(2000);
        continue;
      }

      // Stop when the queue is empty or the campaign was paused/stopped.
      const rows = await query<RowDataPacket[]>(
        `SELECT COUNT(*) AS cnt FROM campaign_contacts cc
         JOIN campaigns c ON c.id = cc.campaign_id
         WHERE cc.campaign_id = ? AND cc.status = 'pending' AND c.status = 'running'`,
        [campaignId]
      );
      if (Number(rows[0]?.cnt || 0) === 0) return;
      await sleep(1000);
    }
    console.warn(`[drain] campaign ${campaignId}: maxTicks reached with rows still pending — 60s cron will continue`);
  } finally {
    draining.delete(campaignId);
  }
}

async function processBatch(
  camp: RowDataPacket, campaignId: number, workspaceId: number,
  budget: number, deadlineAt: number
): Promise<{ sent: number; failed: number; note?: string }> {
    // Get next batch of pending contacts (include per-row variables from CSV if set)
    const contacts = await query<RowDataPacket[]>(
      `SELECT cc.contact_id, c.phone, c.name as contact_name, cc.id as cc_id,
              cc.variables as row_vars
       FROM campaign_contacts cc
       JOIN contacts c ON c.id = cc.contact_id
       WHERE cc.campaign_id = ? AND cc.status = 'pending'
         AND (c.opted_in IS NULL OR c.opted_in = 1)
       LIMIT ?`,
      [campaignId, budget]
    );

    // Skip opted-out contacts (mark failed so they don't block the queue)
    await execute(
      `UPDATE campaign_contacts cc
       JOIN contacts c ON c.id = cc.contact_id
       SET cc.status = 'failed', cc.error = 'opted_out'
       WHERE cc.campaign_id = ? AND cc.status = 'pending' AND c.opted_in = 0`,
      [campaignId]
    );

    if (contacts.length === 0) {
      // API campaigns are persistent endpoints — never auto-complete them,
      // they just wait for the next /send call (single or bulk).
      if (camp.campaign_type === 'api') {
        return { sent: 0, failed: 0, note: 'api queue drained' };
      }
      // No more pending — complete the campaign
      const failedRows = await query<RowDataPacket[]>(
        `SELECT COUNT(*) as cnt FROM campaign_contacts WHERE campaign_id = ? AND status = 'failed'`,
        [campaignId]
      );
      const sentRows = await query<RowDataPacket[]>(
        `SELECT COUNT(*) as cnt FROM campaign_contacts WHERE campaign_id = ? AND status != 'pending' AND status != 'failed'`,
        [campaignId]
      );
      const failedCnt = Number(failedRows[0]?.cnt || 0);
      const sentCnt   = Number(sentRows[0]?.cnt   || 0);
      const finalStatus = sentCnt === 0 && failedCnt > 0 ? 'failed' : 'completed';
      await execute(
        `UPDATE campaigns SET status = ?, completed_at = ?, sent_count = ?, failed_count = ? WHERE id = ?`,
        [finalStatus, utcNow(), sentCnt, failedCnt, campaignId]
      );
      return { sent: 0, failed: 0, note: `completed (${finalStatus})` };
    }

    // Process batch — send in parallel chunks (CONCURRENCY at a time) instead of one-by-one
    let sentCount = 0;
    let failedCount = 0;

    type WaveOutcome =
      | { ok: true;  ccId: number; contactId: number; wamid: string | null; content: string }
      | { ok: false; ccId: number; error: string };

    // sendOne only talks to Meta — all DB bookkeeping happens per-wave in
    // recordWave. Per-message writes at this concurrency starved the pool and
    // panel/API requests queued behind them (proxy 502s).
    async function sendOne(contact: RowDataPacket): Promise<WaveOutcome> {
      const ccId = contact.cc_id as number;
      try {
        // Per-contact vars override campaign vars (CSV mode)
        const rowVars = parseJson<Record<string, string>>(contact.row_vars as string, {});
        const components = buildComponents(camp, contact.phone as string, contact.contact_name as string | null, rowVars);
        // Meta rate-limit (130429 / HTTP 429) is transient at this send rate —
        // back off and retry instead of failing the contact.
        let result;
        for (let attempt = 0; ; attempt++) {
          try {
            result = await sendTemplateMessage(
              camp.access_token as string,
              camp.phone_number_id as string,
              contact.phone as string,
              camp.tname as string,
              camp.language as string,
              components
            );
            break;
          } catch (sendErr) {
            const e = sendErr as { response?: { status?: number; data?: { error?: { code?: number } } } };
            const rateLimited = e?.response?.status === 429 || e?.response?.data?.error?.code === 130429;
            if (!rateLimited || attempt >= 2) throw sendErr;
            await sleep(1500 * (attempt + 1));
          }
        }

        const wamid = (result?.messages as Record<string, unknown>[])?.[0]?.id as string;

        let bodyText = (camp.body_text as string) || '';
        const vars   = parseJson<Record<string, string>>(camp.template_vars as string, {});
        const allVars = { ...vars, ...rowVars };
        for (const [k, v] of Object.entries(allVars)) {
          bodyText = bodyText.replace(new RegExp(`\\{\\{${k}\\}\\}`, 'g'), v);
        }
        let buttons: unknown[] = [];
        try { buttons = JSON.parse((camp.buttons as string) || '[]'); } catch { buttons = []; }

        // Header media actually used in this send — per-row override → campaign
        // override → template static value — so the stored bubble matches what was sent.
        const campaignVarsForHeader = parseJson<Record<string, string>>(camp.template_vars as string, {});
        const sentHeaderContent = rowVars._header_media || campaignVarsForHeader._header_media || camp.header_content || '';

        const templateContent = JSON.stringify({
          __type:         'template',
          template_name:  camp.tname,
          header_type:    camp.header_type    || 'NONE',
          header_content: sentHeaderContent,
          body:           bodyText,
          footer:         camp.footer_text    || '',
          buttons,
          workspace_id:   workspaceId,
        });

        return { ok: true, ccId, contactId: contact.contact_id as number, wamid: wamid || null, content: templateContent };
      } catch (err) {
        const axiosErr = err as { response?: { data?: { error?: { message?: string; error_data?: { details?: string } } }; status?: number } };
        if (axiosErr?.response) {
          console.error(`[process] Meta API error for ${contact.phone as string}: status=${axiosErr.response.status} body=`, JSON.stringify(axiosErr.response.data));
        } else {
          console.error(`[process] failed for ${contact.phone as string}:`, err);
        }
        // Store Meta's actual reason, not just "Request failed with status code 400"
        const metaErr    = axiosErr?.response?.data?.error;
        const errMessage = metaErr?.message
          ? `Meta: ${metaErr.message}${metaErr.error_data?.details ? ` — ${metaErr.error_data.details}` : ''}`
          : String(err);
        return { ok: false, ccId, error: errMessage.slice(0, 1000) };
      }
    }

    // Persist a whole wave in ~3 batched queries instead of 2 per message.
    async function recordWave(outcomes: WaveOutcome[]) {
      const sentRows = outcomes.filter((o): o is Extract<WaveOutcome, { ok: true }> => o.ok);
      const failRows = outcomes.filter((o): o is Extract<WaveOutcome, { ok: false }> => !o.ok);
      const t = utcNow();

      if (sentRows.length > 0) {
        try {
          await execute(
            `INSERT INTO messages (workspace_id, contact_id, wamid, direction, type, content, campaign_id, status, sent_at, created_at)
             VALUES ${sentRows.map(() => "(?, ?, ?, 'outbound', 'template', ?, ?, 'sent', ?, ?)").join(',')}`,
            sentRows.flatMap((o) => [workspaceId, o.contactId, o.wamid, o.content, campaignId, t, t])
          );
          // Map inserted message ids back via wamid (unique per send)
          const wamids = sentRows.map((o) => o.wamid).filter((w): w is string => !!w);
          const idRows = wamids.length > 0
            ? await query<RowDataPacket[]>(
                `SELECT id, wamid FROM messages WHERE campaign_id = ? AND wamid IN (${wamids.map(() => '?').join(',')})`,
                [campaignId, ...wamids]
              )
            : [];
          const msgIdByWamid = new Map(idRows.map((r) => [r.wamid as string, r.id as number]));
          await execute(
            `UPDATE campaign_contacts SET status = 'sent', sent_at = ?,
               message_id = CASE id ${sentRows.map(() => 'WHEN ? THEN ?').join(' ')} END
             WHERE id IN (${sentRows.map(() => '?').join(',')})`,
            [t, ...sentRows.flatMap((o) => [o.ccId, o.wamid ? (msgIdByWamid.get(o.wamid) ?? null) : null]), ...sentRows.map((o) => o.ccId)]
          );
        } catch (err) {
          // These messages ARE already sent — the rows must leave 'pending'
          // no matter what, or the next tick re-sends real messages.
          console.error('[process] wave bookkeeping failed:', err);
          await execute(
            `UPDATE campaign_contacts SET status = 'sent', sent_at = ? WHERE id IN (${sentRows.map(() => '?').join(',')})`,
            [t, ...sentRows.map((o) => o.ccId)]
          ).catch((e2) => console.error('[process] CRITICAL: could not mark wave sent — possible double-send next tick:', e2));
        }
      }

      if (failRows.length > 0) {
        await execute(
          `UPDATE campaign_contacts SET status = 'failed',
             error = CASE id ${failRows.map(() => 'WHEN ? THEN ?').join(' ')} END
           WHERE id IN (${failRows.map(() => '?').join(',')})`,
          [...failRows.flatMap((o) => [o.ccId, o.error]), ...failRows.map((o) => o.ccId)]
        ).catch((e) => console.error('[process] failed-rows update error:', e));
      }
    }

    for (let i = 0; i < contacts.length; i += CONCURRENCY) {
      // Stop starting new waves near the deadline — leftover rows stay pending
      // and the next tick picks them up.
      if (Date.now() >= deadlineAt) break;
      const wave = contacts.slice(i, i + CONCURRENCY);
      const waveStart = Date.now();
      const outcomes = await Promise.all(wave.map((c) => sendOne(c)));
      for (const o of outcomes) o.ok ? sentCount++ : failedCount++;
      // Batched bookkeeping counts toward the wave's pacing window too
      await recordWave(outcomes);
      if (i + CONCURRENCY < contacts.length) {
        const remainingWindow = WAVE_WINDOW_MS - (Date.now() - waveStart);
        if (remainingWindow > 0) await sleep(remainingWindow);
      }
    }

    // Update running counts on campaign
    await execute(
      `UPDATE campaigns SET
         sent_count   = sent_count   + ?,
         failed_count = failed_count + ?
       WHERE id = ?`,
      [sentCount, failedCount, campaignId]
    );

    return { sent: sentCount, failed: failedCount };
}
