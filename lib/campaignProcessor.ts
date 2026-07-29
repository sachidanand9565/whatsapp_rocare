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
import pool, { query, execute, insert } from '@/lib/db';
import { sendTemplateMessage } from '@/lib/whatsapp';
import { buildComponents, parseJson } from '@/lib/campaignComponents';
import { sleep, utcNow } from '@/lib/utils';
import { RowDataPacket } from 'mysql2';

const BATCH_SIZE  = 500; // messages per tick
const CONCURRENCY = 10;  // messages sent in parallel (well under Meta's 80/sec limit)
// Meta's Cloud API cap is ~80 msg/sec. We fire CONCURRENCY messages ~simultaneously
// per chunk, so the delay between chunks must be sized for the whole chunk, not a
// single message — CONCURRENCY / TARGET_MSG_PER_SEC seconds, converted to ms — with
// margin below Meta's cap.
const TARGET_MSG_PER_SEC = 50;
const CHUNK_DELAY_MS = Math.ceil((CONCURRENCY / TARGET_MSG_PER_SEC) * 1000);
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

    async function sendOne(contact: RowDataPacket) {
      try {
        // Per-contact vars override campaign vars (CSV mode)
        const rowVars = parseJson<Record<string, string>>(contact.row_vars as string, {});
        const components = buildComponents(camp, contact.phone as string, contact.contact_name as string | null, rowVars);
        const result = await sendTemplateMessage(
          camp.access_token as string,
          camp.phone_number_id as string,
          contact.phone as string,
          camp.tname as string,
          camp.language as string,
          components
        );

        const wamid = (result?.messages as Record<string, unknown>[])?.[0]?.id as string;

        let bodyText = (camp.body_text as string) || '';
        const vars   = parseJson<Record<string, string>>(camp.template_vars as string, {});
        const allVars = { ...vars, ...rowVars };
        for (const [k, v] of Object.entries(allVars)) {
          bodyText = bodyText.replace(new RegExp(`\\{\\{${k}\\}\\}`, 'g'), v);
        }
        let buttons: unknown[] = [];
        try { buttons = JSON.parse((camp.buttons as string) || '[]'); } catch { buttons = []; }

        // Header media actually used in this send — campaign override if set,
        // else the template's static value — so the stored bubble matches what was sent.
        const campaignVarsForHeader = parseJson<Record<string, string>>(camp.template_vars as string, {});
        const sentHeaderContent = campaignVarsForHeader._header_media || camp.header_content || '';

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

        const t = utcNow();
        const msgId = await insert(
          `INSERT INTO messages (workspace_id, contact_id, wamid, direction, type, content, campaign_id, status, sent_at, created_at)
           VALUES (?, ?, ?, 'outbound', 'template', ?, ?, 'sent', ?, ?)`,
          [workspaceId, contact.contact_id, wamid, templateContent, campaignId, t, t]
        );

        await execute(
          'UPDATE campaign_contacts SET status = ?, message_id = ?, sent_at = ? WHERE id = ?',
          ['sent', msgId, t, contact.cc_id]
        );
        return true;
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
        await execute(
          'UPDATE campaign_contacts SET status = ?, error = ? WHERE id = ?',
          ['failed', errMessage.slice(0, 1000), contact.cc_id]
        );
        return false;
      }
    }

    for (let i = 0; i < contacts.length; i += CONCURRENCY) {
      // Stop starting new chunks near the deadline — leftover rows stay pending
      // and the next tick picks them up.
      if (Date.now() >= deadlineAt) break;
      const chunk = contacts.slice(i, i + CONCURRENCY);
      const results = await Promise.all(chunk.map((c) => sendOne(c)));
      for (const ok of results) ok ? sentCount++ : failedCount++;
      if (i + CONCURRENCY < contacts.length) await sleep(CHUNK_DELAY_MS);
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
