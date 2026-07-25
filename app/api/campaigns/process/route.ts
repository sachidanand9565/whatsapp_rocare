/**
 * GET /api/campaigns/process
 * Called every minute by Vercel Cron.
 * Picks the oldest running campaign and sends the next batch of messages.
 */
import { NextRequest, NextResponse } from 'next/server';
import pool, { query, execute, insert } from '@/lib/db';
import { sendTemplateMessage } from '@/lib/whatsapp';
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

  try {
    // Find oldest running campaign
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
       ORDER BY c.started_at ASC
       LIMIT 1`,
      []
    );

    if (camps.length === 0) {
      return NextResponse.json({ ok: true, message: 'No running campaigns' });
    }

    const camp = camps[0];
    const campaignId  = camp.id as number;
    const workspaceId = camp.workspace_id as number;

    // Guard against two overlapping invocations processing the same campaign at
    // once (cron tick still running when the next tick fires, or a manual
    // "process now" from the UI overlapping cron) — without this, both runs can
    // select and send to the same pending contacts, double-sending real messages.
    // A session-scoped named lock on a dedicated connection serializes per-campaign
    // work; non-blocking (timeout 0) so an overlapping run just skips this tick
    // instead of queuing behind it.
    const lockName = `campaign_process_${campaignId}`;
    const lockConn = await pool.getConnection();
    let lockAcquired = false;
    try {
      const [lockRows] = await lockConn.query('SELECT GET_LOCK(?, 0) AS locked', [lockName]);
      lockAcquired = Number((lockRows as RowDataPacket[])[0]?.locked) === 1;
      if (!lockAcquired) {
        return NextResponse.json({ ok: true, message: `Campaign ${campaignId} already being processed` });
      }
      return await processBatch(camp, campaignId, workspaceId);
    } finally {
      if (lockAcquired) {
        try { await lockConn.query('SELECT RELEASE_LOCK(?)', [lockName]); } catch { /* connection is being released anyway */ }
      }
      lockConn.release();
    }
  } catch (err) {
    console.error('[campaigns/process]', err);
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
  }
}

async function processBatch(camp: RowDataPacket, campaignId: number, workspaceId: number) {
    // Get next batch of pending contacts (include per-row variables from CSV if set)
    const contacts = await query<RowDataPacket[]>(
      `SELECT cc.contact_id, c.phone, c.name as contact_name, cc.id as cc_id,
              cc.variables as row_vars
       FROM campaign_contacts cc
       JOIN contacts c ON c.id = cc.contact_id
       WHERE cc.campaign_id = ? AND cc.status = 'pending'
         AND (c.opted_in IS NULL OR c.opted_in = 1)
       LIMIT ?`,
      [campaignId, BATCH_SIZE]
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
      // they just wait for the next send-bulk/send call.
      if (camp.campaign_type === 'api') {
        return NextResponse.json({ ok: true, message: `API campaign ${campaignId} queue drained` });
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
      return NextResponse.json({ ok: true, message: `Campaign ${campaignId} completed` });
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
        const axiosErr = err as { response?: { data?: unknown; status?: number } };
        if (axiosErr?.response) {
          console.error(`[process] Meta API error for ${contact.phone as string}: status=${axiosErr.response.status} body=`, JSON.stringify(axiosErr.response.data));
        } else {
          console.error(`[process] failed for ${contact.phone as string}:`, err);
        }
        await execute(
          'UPDATE campaign_contacts SET status = ?, error = ? WHERE id = ?',
          ['failed', String(err), contact.cc_id]
        );
        return false;
      }
    }

    for (let i = 0; i < contacts.length; i += CONCURRENCY) {
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

    return NextResponse.json({
      ok: true,
      campaignId,
      batchSent: sentCount,
      batchFailed: failedCount,
      remaining: 'check next cron',
    });
}

function buildComponents(camp: RowDataPacket, contactPhone: string, contactName: string | null, rowVars: Record<string, string> = {}): object[] {
  const components: object[] = [];
  const headerType    = (camp.header_type as string || '').toUpperCase();
  // Use campaign-level header_media override if set, else fall back to template default
  const campaignVarsRaw = parseJson<Record<string, string>>(camp.template_vars as string, {});
  const headerMediaOverride = campaignVarsRaw._header_media || '';
  const headerContent = headerMediaOverride || (camp.header_content as string) || '';

  if (['IMAGE', 'DOCUMENT', 'VIDEO'].includes(headerType) && headerContent) {
    const mediaType = headerType.toLowerCase() as 'image' | 'document' | 'video';
    const isMediaId = headerContent.startsWith('media_id:');
    const mediaId   = isMediaId ? headerContent.replace('media_id:', '') : '';
    const isUrl     = !isMediaId && headerContent.startsWith('http');
    components.push({
      type: 'header',
      parameters: [{
        type: mediaType,
        [mediaType]: isMediaId ? { id: mediaId } : isUrl ? { link: headerContent } : { id: headerContent },
      }],
    });
  }
  // Per-contact CSV vars take priority over campaign-level template_vars
  const campaignVars = parseJson<Record<string, string>>(camp.template_vars as string, {});
  const merged = { ...campaignVars, ...rowVars }; // CSV row overrides campaign defaults
  // Resolve {{contact_name}} / {{contact_phone}} placeholders
  const resolvedVars = Object.fromEntries(
    Object.entries(merged).map(([k, v]) => [
      k,
      String(v)
        .replace(/\{\{contact_name\}\}/gi,  contactName || contactPhone)
        .replace(/\{\{contact_phone\}\}/gi, contactPhone),
    ])
  );
  const sortedKeys = Object.keys(resolvedVars).sort((a, b) => Number(a) - Number(b));
  const params = sortedKeys.map((k) => ({ type: 'text', text: resolvedVars[k] }));
  if (params.length > 0) {
    components.push({ type: 'body', parameters: params });
  }
  return components;
}

function parseJson<T>(val: unknown, fallback: T): T {
  if (!val) return fallback;
  if (typeof val === 'object') return val as T;
  try { return JSON.parse(val as string) as T; } catch { return fallback; }
}
