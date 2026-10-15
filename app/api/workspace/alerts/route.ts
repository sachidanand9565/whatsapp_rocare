/**
 * GET  /api/workspace/alerts — alert settings + the last few alerts sent
 * POST /api/workspace/alerts — { enabled, extraEmails: string[] }
 *
 * These are the account-health emails (payment failure, ban, dead token) that
 * lib/alerts.ts sends when message sending breaks.
 */
import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { query } from '@/lib/db';
import { apiSuccess, apiError } from '@/lib/utils';
import { saveAlertSettings } from '@/lib/alerts';
import { RowDataPacket } from 'mysql2';

const MISSING_TABLE = 'Alerts are not set up yet — run migration-alerts.sql on the database';

export async function GET(req: NextRequest) {
  try {
    const payload = await requireAuth(req);

    const owner = await query<RowDataPacket[]>(
      'SELECT u.email FROM workspaces w JOIN users u ON u.id = w.owner_id WHERE w.id = ? LIMIT 1',
      [payload.workspaceId]
    );

    const rows = await query<RowDataPacket[]>(
      'SELECT enabled, extra_emails FROM alert_settings WHERE workspace_id = ? LIMIT 1',
      [payload.workspaceId]
    );
    const recent = await query<RowDataPacket[]>(
      `SELECT alert_type, error_code, detail, recipients, sent_at
       FROM alert_log WHERE workspace_id = ? ORDER BY id DESC LIMIT 5`,
      [payload.workspaceId]
    );

    return apiSuccess({
      // No row yet means alerts are on — silence should be opted into, not defaulted to
      enabled:      rows.length === 0 ? true : Number(rows[0].enabled) === 1,
      extra_emails: String(rows[0]?.extra_emails || '').split(',').map((e) => e.trim()).filter(Boolean),
      owner_email:  (owner[0]?.email as string) || '',
      recent,
    });
  } catch (err) {
    if (err instanceof Error && err.message === 'UNAUTHORIZED') return apiError('Unauthorized', 401);
    if ((err as { code?: string })?.code === 'ER_NO_SUCH_TABLE') return apiError(MISSING_TABLE, 500);
    console.error('[workspace/alerts GET]', err);
    return apiError('Server error', 500);
  }
}

export async function POST(req: NextRequest) {
  try {
    const payload = await requireAuth(req);
    const body    = await req.json().catch(() => ({}));

    const enabled = body.enabled !== false;
    const extras  = (Array.isArray(body.extraEmails) ? body.extraEmails : [])
      .map((e: unknown) => String(e || '').trim().toLowerCase())
      .filter(Boolean)
      .slice(0, 5);

    for (const e of extras) {
      if (!e.includes('@')) return apiError(`"${e}" is not a valid email address`);
    }

    await saveAlertSettings(payload.workspaceId, enabled, extras);
    return apiSuccess({ saved: true });
  } catch (err) {
    if (err instanceof Error && err.message === 'UNAUTHORIZED') return apiError('Unauthorized', 401);
    if ((err as { code?: string })?.code === 'ER_NO_SUCH_TABLE') return apiError(MISSING_TABLE, 500);
    console.error('[workspace/alerts POST]', err);
    return apiError('Server error', 500);
  }
}
