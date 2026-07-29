/**
 * GET /api/campaigns/process
 * Triggers a campaign processing tick (see lib/campaignProcessor.ts).
 *
 * By default the tick runs in the BACKGROUND and this responds immediately —
 * the app runs on a long-lived AWS server, so the work continues after the
 * response and proxies/load-balancers never hit their timeout (504).
 * Pass ?sync=1 to wait for the tick's result (debugging / scripts).
 * Pass ?campaignId=N to process a single campaign with the full batch budget.
 *
 * Note: the in-app scheduler (instrumentation.ts) already runs a tick every
 * minute — this endpoint is for manual triggers and external cron fallback.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { runProcessTick } from '@/lib/campaignProcessor';

export async function GET(req: NextRequest) {
  // Accept either: cron secret OR a valid user JWT (manual trigger from UI)
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = req.headers.get('authorization') || '';

  const isCron    = cronSecret && authHeader === `Bearer ${cronSecret}`;
  let isUser = false;
  try { await requireAuth(req); isUser = true; } catch { isUser = false; }

  if (cronSecret && !isCron && !isUser) {
    return new NextResponse('Unauthorized', { status: 401 });
  }

  const onlyId = Number(req.nextUrl.searchParams.get('campaignId') || 0) || null;
  const sync   = req.nextUrl.searchParams.get('sync') === '1';

  try {
    if (sync) {
      const result = await runProcessTick(onlyId);
      return NextResponse.json({ ok: true, ...result });
    }
    // Fire-and-forget: the tick keeps running after we respond
    runProcessTick(onlyId).catch((err) => console.error('[campaigns/process]', err));
    return NextResponse.json({ ok: true, started: true });
  } catch (err) {
    console.error('[campaigns/process]', err);
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
  }
}
