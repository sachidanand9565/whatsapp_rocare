/**
 * GET /api/calling/settings — live calling status from Meta + workspace prefs
 * PUT /api/calling/settings — enable/disable calling on Meta, set call icon
 *                             visibility, missed-call auto-reply template
 *
 * WhatsApp Business Calling API needs the phone number on messaging tier
 * ≥ 2000/day; below that Meta rejects enabling and we surface the reason.
 */
import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { query, execute } from '@/lib/db';
import { apiSuccess, apiError } from '@/lib/utils';
import { getCallingSettings, updateCallingSettings, CallingSettings } from '@/lib/whatsapp';
import { s3Configured } from '@/lib/s3';
import { RowDataPacket } from 'mysql2';

// migration-calling.sql adds the calling_* / missed_call_* columns; until it
// runs, fall back to the base columns so the page still loads (prefs read as off).
let callingColumnsAvailable = true;
async function loadWorkspace(workspaceId: number) {
  if (callingColumnsAvailable) {
    try {
      const rows = await query<RowDataPacket[]>(
        `SELECT id, access_token, phone_number_id, calling_enabled,
                missed_call_template, missed_call_template_lang,
                record_calls, recording_retention_days
         FROM workspaces WHERE id = ? LIMIT 1`,
        [workspaceId]
      );
      return rows[0];
    } catch (e) {
      if ((e as { code?: string })?.code !== 'ER_BAD_FIELD_ERROR') throw e;
      callingColumnsAvailable = false;
      console.warn('[calling/settings] run migration-calling.sql — calling columns missing on workspaces');
    }
  }
  const rows = await query<RowDataPacket[]>(
    'SELECT id, access_token, phone_number_id FROM workspaces WHERE id = ? LIMIT 1',
    [workspaceId]
  );
  return rows[0];
}

export async function GET(req: NextRequest) {
  try {
    const payload = await requireAuth(req);
    const ws = await loadWorkspace(payload.workspaceId);
    if (!ws) return apiError('Workspace not found', 404);
    if (!ws.access_token || !ws.phone_number_id) {
      return apiSuccess({ configured: false, calling: null, phone: null,
        missed_call_template: null, missed_call_template_lang: 'en' });
    }

    let calling: CallingSettings | null = null;
    let phone: Record<string, unknown> | null = null;
    let meta_error: string | null = null;
    try {
      const live = await getCallingSettings(ws.access_token as string, ws.phone_number_id as string);
      calling = live.calling;
      phone   = live.phone;
    } catch (e) {
      const err = e as { response?: { data?: { error?: { message?: string } } } };
      meta_error = err?.response?.data?.error?.message || (e as Error).message;
    }

    // Keep the local mirror in sync with what Meta says
    if (calling?.status) {
      const enabled = calling.status === 'ENABLED' ? 1 : 0;
      if (Number(ws.calling_enabled) !== enabled) {
        await execute('UPDATE workspaces SET calling_enabled = ? WHERE id = ?', [enabled, ws.id]).catch(() => {});
      }
    }

    // Tier string like "TIER_1K" | "TIER_2K" | "TIER_10K" | "TIER_100K" | "TIER_UNLIMITED"
    const tier = String(phone?.messaging_limit_tier || '');
    const tierNum = tier === 'TIER_UNLIMITED' ? Infinity
      : Number((tier.match(/TIER_(\d+)K/) || [])[1] || 0) * 1000;
    const tier_ok = tierNum >= 2000;

    return apiSuccess({
      configured: true,
      calling,
      phone,
      tier_ok,
      meta_error,
      missed_call_template:      ws.missed_call_template || null,
      missed_call_template_lang: ws.missed_call_template_lang || 'en',
      record_calls:              !!ws.record_calls,
      recording_retention_days:  Number(ws.recording_retention_days ?? 90),
      recording_storage_ready:   s3Configured(),
    });
  } catch (err: unknown) {
    if (err instanceof Error && err.message === 'UNAUTHORIZED') return apiError('Unauthorized', 401);
    console.error('[calling/settings GET]', err);
    return apiError('Server error', 500);
  }
}

export async function PUT(req: NextRequest) {
  try {
    const payload = await requireAuth(req);
    if (payload.role !== 'admin') return apiError('Admin only', 403);
    const ws = await loadWorkspace(payload.workspaceId);
    if (!ws) return apiError('Workspace not found', 404);

    const body = await req.json() as {
      enabled?: boolean;
      call_icon_visibility?: 'DEFAULT' | 'DISABLE_ALL';
      missed_call_template?: string | null;
      missed_call_template_lang?: string;
      record_calls?: boolean;
      recording_retention_days?: number;
    };

    // ── Local prefs (no Meta call needed) ──
    if ('record_calls' in body || 'recording_retention_days' in body) {
      if (!callingColumnsAvailable) {
        return apiError('Run migration-calling.sql first — recording columns are missing on the workspaces table', 400);
      }
      if (body.record_calls && !s3Configured()) {
        return apiError('Recording storage (S3) is not configured on the server — set S3_BUCKET / S3_REGION first', 400);
      }
      const sets: string[] = []; const vals: (number)[] = [];
      if ('record_calls' in body) { sets.push('record_calls = ?'); vals.push(body.record_calls ? 1 : 0); }
      if ('recording_retention_days' in body) {
        sets.push('recording_retention_days = ?');
        vals.push(Math.max(0, Math.min(3650, Number(body.recording_retention_days) || 0)));
      }
      await execute(`UPDATE workspaces SET ${sets.join(', ')} WHERE id = ?`, [...vals, ws.id]);
    }
    if ('missed_call_template' in body) {
      if (!callingColumnsAvailable) {
        return apiError('Run migration-calling.sql first — the missed-call columns are missing on the workspaces table', 400);
      }
      await execute(
        'UPDATE workspaces SET missed_call_template = ?, missed_call_template_lang = ? WHERE id = ?',
        [body.missed_call_template || null, body.missed_call_template_lang || 'en', ws.id]
      );
    }

    // ── Meta-side calling settings ──
    if ('enabled' in body || 'call_icon_visibility' in body) {
      if (!ws.access_token || !ws.phone_number_id) {
        return apiError('WhatsApp not connected in this workspace', 400);
      }
      const calling: CallingSettings = {};
      if ('enabled' in body) {
        calling.status = body.enabled ? 'ENABLED' : 'DISABLED';
        // Callback permission prompt lets customers grant business-initiated
        // calls right from the call screen — on by default when enabling.
        if (body.enabled) calling.callback_permission_status = 'ENABLED';
      }
      if (body.call_icon_visibility) calling.call_icon_visibility = body.call_icon_visibility;

      try {
        await updateCallingSettings(ws.access_token as string, ws.phone_number_id as string, calling);
      } catch (e) {
        const err = e as { response?: { data?: { error?: { message?: string; code?: number; error_user_msg?: string } } } };
        const me = err?.response?.data?.error;
        const detail = me?.error_user_msg || me?.message || (e as Error).message;
        console.warn('[calling/settings] Meta update failed:', JSON.stringify(me || detail));
        return apiError(`Meta rejected the change: ${detail}`, 502);
      }
      // Local mirror is best-effort — Meta is the source of truth (GET re-syncs it)
      if ('enabled' in body && callingColumnsAvailable) {
        await execute('UPDATE workspaces SET calling_enabled = ? WHERE id = ?', [body.enabled ? 1 : 0, ws.id])
          .catch((e) => console.warn('[calling/settings] mirror update skipped:', (e as Error).message));
      }
    }

    return apiSuccess({ updated: true });
  } catch (err: unknown) {
    if (err instanceof Error && err.message === 'UNAUTHORIZED') return apiError('Unauthorized', 401);
    console.error('[calling/settings PUT]', err);
    return apiError('Server error', 500);
  }
}
