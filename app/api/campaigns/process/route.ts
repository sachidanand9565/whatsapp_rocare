/**
 * GET /api/campaigns/process
 * Called every minute by Vercel Cron.
 * Picks the oldest running campaign and sends the next batch of messages.
 */
import { NextRequest, NextResponse } from 'next/server';
import pool, { query, execute, insert } from '@/lib/db';
import { sendTemplateMessage } from '@/lib/whatsapp';
import { buildComponents, parseJson } from '@/lib/campaignComponents';
import { sleep, utcNow } from '@/lib/utils';
import { requireAuth } from '@/lib/auth';
import { RowDataPacket } from 'mysql2';

export const maxDuration = 55; // stay under Vercel's 60s limit

const BATCH_SIZE  = 500; // messages per cron invocation
const CONCURRENCY = 10;  // messages sent in parallel (well under Meta's 80/sec limit)
// Meta's Cloud API cap is ~80 msg/sec. We fire CONCURRENCY messages ~simultaneously
// per chunk, so the delay between chunks must be sized for the whole chunk, not a
// single message — CONCURRENCY / TARGET_MSG_PER_SEC seconds, converted to ms — with
// margin below Meta's cap. (Previously slept a fixed 15ms between chunks of 10,
// which works out to ~666 msg/sec — 8x over the limit, causing Meta 429s that were
// then recorded as permanent per-contact failures.)
const TARGET_MSG_PER_SEC = 50;
const CHUNK_DELAY_MS = Math.ceil((CONCURRENCY / TARGET_MSG_PER_SEC) * 1000);
// Stop starting new work this many ms into the tick — leaves margin under the
// 55s maxDuration so in-flight sends and DB writes finish instead of being killed.
const TICK_DEADLINE_MS = 45_000;

export async function GET(req: NextRequest) {
  // Accept either: Vercel cron secret OR a valid user JWT (manual trigger from UI)
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = req.headers.get('authorization') || '';

  const isCron    = cronSecret && authHeader === `Bearer ${cronSecret}`;
  let isUser = false;
  try { await requireAuth(req); isUser = true; } catch { isUser = false; }

  if (cronSecret && !isCron && !isUser) {
    return new NextResponse('Unauthorized', { status: 401 });
  }

  const tickStart  = Date.now();
  const deadlineAt = tickStart + TICK_DEADLINE_MS;

  // Optional: process a single campaign only (detail page "Process now" button)
  const onlyId = Number(req.nextUrl.searchParams.get('campaignId') || 0) || null;

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
      return NextResponse.json({ ok: true, message: onlyId ? 'Campaign not running or nothing pending' : 'No running campaigns' });
    }

    // Shared per-tick budget: split fairly across campaigns (each gets at least
    // a meaningful slice; unused slices roll over to later campaigns in the loop).
    let remaining = BATCH_SIZE;
    const summary: { campaignId: number; sent: number; failed: number; note?: string }[] = [];

    for (const camp of camps) {
      if (remaining <= 0 || Date.now() >= deadlineAt) break;

      const campaignId  = camp.id as number;
      const workspaceId = camp.workspace_id as number;

      // Guard against two overlapping invocations processing the same campaign at
      // once (cron tick still running when the next tick fires, or a manual
      // "process now" from the UI overlapping cron) — without this, both runs can
      // select and send to the same pending contacts, double-sending real messages.
      // A session-scoped named lock on a dedicated connection serializes per-campaign
      // work; non-blocking (timeout 0) so an overlapping run just skips this campaign
      // instead of queuing behind it.
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

    return NextResponse.json({ ok: true, campaigns: summary });
  } catch (err) {
    console.error('[campaigns/process]', err);
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
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
      // and the next cron tick picks them up.
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

