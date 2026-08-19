/**
 * Calling-hours text helpers — pure functions, safe to import from both
 * server routes and client pages.
 *
 * Meta blocks calls outside `call_hours` but does not reliably TELL the
 * customer what the hours are. So we render a short human line like
 *   📞 Calling hours (IST): Mon–Fri 9:00 AM–6:00 PM · Sat 10:00 AM–2:00 PM · Sun closed
 * and keep it synced into the WhatsApp Business Profile description, where
 * customers see it before they call.
 */

export interface CallHourSlotLite { day_of_week: string; open_time: string; close_time: string }
export interface CallHoursLite {
  status?: 'ENABLED' | 'DISABLED' | string;
  timezone_id?: string;
  weekly_operating_hours?: CallHourSlotLite[];
}

export const CALL_DAYS = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'];
const SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** Marker that starts the auto-managed line inside the profile description. */
export const HOURS_MARKER = '📞 Calling hours';
/** Meta limit for whatsapp_business_profile.description */
export const PROFILE_DESCRIPTION_MAX = 512;

export function fmt12h(t: string): string {
  const s = String(t || '').replace(':', '');
  if (s.length !== 4) return t;
  const h = Number(s.slice(0, 2)), m = s.slice(2);
  return `${((h + 11) % 12) + 1}:${m} ${h < 12 ? 'AM' : 'PM'}`;
}

/** "Asia/Kolkata" → "IST", "America/New_York" → "EST"/"EDT", falls back to the id. */
export function tzLabel(tz: string): string {
  if (tz === 'Asia/Kolkata' || tz === 'Asia/Calcutta') return 'IST';
  try {
    const part = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'short' })
      .formatToParts(new Date()).find((p) => p.type === 'timeZoneName')?.value;
    // Intl gives "GMT+4" for many zones — that's fine, still readable
    return part || tz;
  } catch { return tz; }
}

/**
 * Compact weekly summary. Consecutive days with identical slots are merged:
 *   Mon–Fri 9:00 AM–6:00 PM · Sat 10:00 AM–2:00 PM · Sun closed
 * Days with no slot are collapsed into a single "closed" group at the end
 * unless every day is open.
 */
export function summarizeWeek(hours: CallHoursLite): string {
  const byDay = CALL_DAYS.map((d) => {
    const slots = (hours.weekly_operating_hours || [])
      .filter((s) => String(s.day_of_week).toUpperCase() === d)
      .map((s) => ({ o: String(s.open_time).replace(':', ''), c: String(s.close_time).replace(':', '') }))
      .sort((a, b) => a.o.localeCompare(b.o));
    return slots.map((s) => `${fmt12h(s.o)}–${fmt12h(s.c)}`).join(' & ');
  });

  // Group consecutive days with identical text
  const groups: { from: number; to: number; text: string }[] = [];
  byDay.forEach((text, i) => {
    const last = groups[groups.length - 1];
    if (last && last.text === text && last.to === i - 1) last.to = i;
    else groups.push({ from: i, to: i, text });
  });

  const open   = groups.filter((g) => g.text);
  const closed = CALL_DAYS.map((_, i) => i).filter((i) => !byDay[i]);
  const label  = (g: { from: number; to: number }) =>
    g.from === g.to ? SHORT[g.from] : g.to === g.from + 1 ? `${SHORT[g.from]}, ${SHORT[g.to]}` : `${SHORT[g.from]}–${SHORT[g.to]}`;

  const parts = open.map((g) => `${label(g)} ${g.text}`);
  if (closed.length && closed.length < 7) {
    // Merge closed days into ranges too
    const cg: { from: number; to: number }[] = [];
    closed.forEach((i) => {
      const last = cg[cg.length - 1];
      if (last && last.to === i - 1) last.to = i; else cg.push({ from: i, to: i });
    });
    parts.push(`${cg.map(label).join(', ')} closed`);
  }
  return parts.join(' · ');
}

/** The full line we place in the profile description. Empty string when hours are off. */
export function callHoursProfileLine(hours: CallHoursLite | null | undefined): string {
  if (!hours || hours.status !== 'ENABLED') return '';
  const week = summarizeWeek(hours);
  if (!week) return '';
  return `${HOURS_MARKER} (${tzLabel(hours.timezone_id || 'Asia/Kolkata')}): ${week}`;
}

/** Remove any previously auto-inserted hours line from a description. */
export function stripHoursLine(description: string): string {
  return String(description || '')
    .split('\n')
    .filter((l) => !l.trim().startsWith(HOURS_MARKER))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Merge (or remove, when line is '') the hours line into a description, respecting Meta's length cap. */
export function mergeHoursIntoDescription(description: string, line: string): string {
  const base = stripHoursLine(description);
  if (!line) return base;
  const room = PROFILE_DESCRIPTION_MAX - line.length - 2; // "\n\n"
  const head = base.length > room ? base.slice(0, Math.max(0, room - 1)).trimEnd() + '…' : base;
  return head ? `${head}\n\n${line}` : line;
}
