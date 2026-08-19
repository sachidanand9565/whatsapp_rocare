/**
 * GET /api/calling/settings — live calling status from Meta + workspace prefs
 * PUT /api/calling/settings — enable/disable calling on Meta, set call icon
 *                             visibility, call hours (calling time window),
 *                             missed-call auto-reply template, recording prefs
 *
 * WhatsApp Business Calling API needs the phone number on messaging tier
 * ≥ 2000/day; below that Meta rejects enabling and we surface the reason.
 */
import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { query, execute } from '@/lib/db';
import { apiSuccess, apiError } from '@/lib/utils';
import { getCallingSettings, updateCallingSettings, CallingSettings, getBusinessProfile, updateBusinessProfile } from '@/lib/whatsapp';
import { callHoursProfileLine, mergeHoursIntoDescription, HOURS_MARKER } from '@/lib/call-hours';
import { s3Configured } from '@/lib/s3';
import { RowDataPacket } from 'mysql2';

// ── Call hours (Meta-native "calling time") ──
// Meta stores these on the phone number and hides/blocks the call button
// outside the window automatically. Times travel as "HHMM" (24h) — the UI
// sends "HH:MM" from <input type="time">, so accept both.
type CallHoursInput = {
  status?: 'ENABLED' | 'DISABLED' | boolean;
  timezone_id?: string;
  weekly_operating_hours?: { day_of_week?: string; open_time?: string; close_time?: string }[];
  holiday_schedule?: { date?: string; start_time?: string; end_time?: string }[];
};
const DAYS = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'];

function toHHMM(v: unknown): string | null {
  const s = String(v ?? '').trim().replace(':', '');
  if (!/^\d{4}$/.test(s)) return null;
  const h = Number(s.slice(0, 2)), m = Number(s.slice(2));
  if (h > 23 || m > 59) return null;
  return s;
}
function isValidTimezone(tz: string): boolean {
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; } catch { return false; }
}

function normalizeCallHours(input: CallHoursInput | undefined):
  { value: NonNullable<CallingSettings['call_hours']> } | { error: string } {
  if (!input || typeof input !== 'object') return { error: 'call_hours must be an object' };
  const enabled = input.status === true || input.status === 'ENABLED';
  const timezone_id = String(input.timezone_id || 'Asia/Kolkata').trim();
  if (!isValidTimezone(timezone_id)) return { error: `Unknown timezone "${timezone_id}"` };

  const weekly: { day_of_week: string; open_time: string; close_time: string }[] = [];
  for (const slot of input.weekly_operating_hours || []) {
    const day = String(slot?.day_of_week || '').toUpperCase();
    if (!DAYS.includes(day)) return { error: `Invalid day "${slot?.day_of_week}"` };
    const open = toHHMM(slot?.open_time), close = toHHMM(slot?.close_time);
    if (!open || !close) return { error: `Invalid time for ${day} — use HH:MM (24h)` };
    if (open >= close) return { error: `${day}: opening time must be before closing time` };
    weekly.push({ day_of_week: day, open_time: open, close_time: close });
  }
  // Meta accepts at most 2 slots per day
  for (const d of DAYS) {
    if (weekly.filter((w) => w.day_of_week === d).length > 2) return { error: `${d}: max 2 time slots per day` };
  }
  if (enabled && weekly.length === 0) return { error: 'Add at least one day with calling hours, or turn call hours off' };

  const holidays: { date: string; start_time: string; end_time: string }[] = [];
  for (const h of input.holiday_schedule || []) {
    const date = String(h?.date || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { error: `Invalid holiday date "${h?.date}" — use YYYY-MM-DD` };
    const start = toHHMM(h?.start_time ?? '0000'), end = toHHMM(h?.end_time ?? '2359');
    if (!start || !end || start >= end) return { error: `Holiday ${date}: invalid time range` };
    holidays.push({ date, start_time: start, end_time: end });
  }

  // Order by day so Meta / the UI show a tidy week
  weekly.sort((a, b) => DAYS.indexOf(a.day_of_week) - DAYS.indexOf(b.day_of_week) || a.open_time.localeCompare(b.open_time));
  const value: NonNullable<CallingSettings['call_hours']> = {
    status: enabled ? 'ENABLED' : 'DISABLED',
    timezone_id,
  };
  // Turning hours OFF with every day unchecked → just flip status; don't send an empty week
  if (weekly.length) value.weekly_operating_hours = weekly;
  if (holidays.length) value.holiday_schedule = holidays;
  return { value };
}

// migration-calling.sql adds the calling_* / missed_call_* / record_* columns;
// until it runs, fall back to the base columns so the page still loads.
// Re-probed on EVERY request (cheap: one indexed row) so that running the
// migration takes effect immediately — no server restart needed.
let callingColumnsAvailable = true;
async function loadWorkspace(workspaceId: number) {
  try {
    const rows = await query<RowDataPacket[]>(
      `SELECT id, access_token, phone_number_id, calling_enabled,
              missed_call_template, missed_call_template_lang,
              record_calls, recording_retention_days
       FROM workspaces WHERE id = ? LIMIT 1`,
      [workspaceId]
    );
    callingColumnsAvailable = true;
    return rows[0];
  } catch (e) {
    if ((e as { code?: string })?.code !== 'ER_BAD_FIELD_ERROR') throw e;
    callingColumnsAvailable = false;
    console.warn('[calling/settings] run migration-calling.sql — calling/recording columns missing on workspaces');
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
    // Is our "📞 Calling hours …" line currently on the WhatsApp business profile?
    let profile_hours_line: string | null = null;
    try {
      const [live, profile] = await Promise.all([
        getCallingSettings(ws.access_token as string, ws.phone_number_id as string),
        getBusinessProfile(ws.access_token as string, ws.phone_number_id as string).catch(() => null),
      ]);
      calling = live.calling;
      phone   = live.phone;
      const found = String(profile?.description || '').split('\n').find((l) => l.trim().startsWith(HOURS_MARKER));
      profile_hours_line = found ? found.trim() : null;
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
      hours_on_profile:          !!profile_hours_line,
      profile_hours_line,
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
      call_hours?: CallHoursInput;
      show_hours_on_profile?: boolean;
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
    if ('enabled' in body || 'call_icon_visibility' in body || 'call_hours' in body || 'show_hours_on_profile' in body) {
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
      if ('call_hours' in body) {
        const parsed = normalizeCallHours(body.call_hours);
        if ('error' in parsed) return apiError(parsed.error, 400);
        calling.call_hours = parsed.value;
      }

      try {
        // Only the profile flag may have been sent — nothing to push to calling settings then
        if (Object.keys(calling).length) {
          await updateCallingSettings(ws.access_token as string, ws.phone_number_id as string, calling);
        }
      } catch (e) {
        const err = e as { response?: { data?: { error?: { message?: string; code?: number; error_user_msg?: string } } } };
        const me = err?.response?.data?.error;
        const detail = me?.error_user_msg || me?.message || (e as Error).message;
        console.warn('[calling/settings] Meta update failed:', JSON.stringify(me || detail));
        return apiError(`Meta rejected the change: ${detail}`, 502);
      }
      // Keep the "📞 Calling hours …" line on the WhatsApp business profile in
      // sync so customers see the window BEFORE they tap call. Explicit flag
      // wins; otherwise refresh the line only if it's already on the profile.
      if (calling.call_hours || 'show_hours_on_profile' in body) {
        try {
          const profile = await getBusinessProfile(ws.access_token as string, ws.phone_number_id as string);
          const current = String(profile.description || '');
          const already = current.split('\n').some((l) => l.trim().startsWith(HOURS_MARKER));
          const want    = 'show_hours_on_profile' in body ? !!body.show_hours_on_profile : already;
          // Hours just saved in this request, else whatever Meta currently has
          const hours   = calling.call_hours
            ?? (want ? (await getCallingSettings(ws.access_token as string, ws.phone_number_id as string)).calling?.call_hours : undefined);
          const line    = want ? callHoursProfileLine(hours) : '';
          const next    = mergeHoursIntoDescription(current, line);
          if (next !== current.trim()) {
            await updateBusinessProfile(ws.access_token as string, ws.phone_number_id as string, { description: next });
          }
        } catch (e) {
          const err = e as { response?: { data?: { error?: { message?: string; error_user_msg?: string } } } };
          const me = err?.response?.data?.error;
          console.warn('[calling/settings] profile hours sync failed:', me?.error_user_msg || me?.message || (e as Error).message);
          return apiError(`Hours saved, but WhatsApp profile update failed: ${me?.error_user_msg || me?.message || (e as Error).message}`, 502);
        }
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
