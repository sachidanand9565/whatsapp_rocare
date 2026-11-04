/**
 * lib/utils.ts
 * General utility helpers
 */
import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { NextResponse } from 'next/server';
import { COUNTRY_COL_RE } from '@/lib/phoneCountries';

// ---- Tailwind class merging ----
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// ---- Standardised API responses ----
export function apiSuccess(data: unknown, status = 200) {
  return NextResponse.json({ success: true, data }, { status });
}

export function apiError(message: string, status = 400) {
  return NextResponse.json({ success: false, error: message }, { status });
}

// ---- Pagination helper ----
export function getPagination(searchParams: URLSearchParams, maxLimit = 100) {
  const page  = Math.max(1, Number(searchParams.get('page') || 1));
  const limit = Math.min(maxLimit, Math.max(1, Number(searchParams.get('limit') || 20)));
  const offset = (page - 1) * limit;
  return { page, limit, offset };
}

// ---- Phone normalizer: ensure E.164 without '+' ----
// "+44 7911 123456" / "0044 7911…" → already international, kept as is.
// countryCode (e.g. '44', '1') = the country for numbers written WITHOUT one:
//   UK "07911 123456" → 447911123456, US "(212) 555-1234" → 12125551234.
// No countryCode → old India rule: 10 digits starting 6-9 get 91
// ("9876543210" → 919876543210; "919876543210" stays).
export function normalizePhone(phone: string, countryCode?: string): string {
  const raw = String(phone || '').trim();
  const digits = raw.replace(/\D/g, '');
  if (!digits) return '';
  if (raw.startsWith('+')) return digits;
  if (digits.startsWith('00')) return digits.slice(2);

  const cc = String(countryCode || '').replace(/\D/g, '');
  if (cc && cc !== '91') {
    // Already carries the code (e.g. 447911123456 / 12125551234) — keep it
    if (digits.startsWith(cc) && digits.length > 10) return digits;
    return cc + digits.replace(/^0+/, '');   // drop the national trunk 0
  }
  if (cc === '91' && digits.length === 11 && digits.startsWith('0')) return '91' + digits.slice(1);
  if (digits.length === 10 && /^[6-9]/.test(digits)) {
    return '91' + digits;
  }
  return digits;
}

/** A CSV row's own country code column, if it has one (country_code / country code / country). */
export function rowCountryCode(row: Record<string, string>): string {
  for (const [k, v] of Object.entries(row)) {
    if (COUNTRY_COL_RE.test(k.trim()) && /\d/.test(v || '')) return String(v).replace(/\D/g, '');
  }
  return '';
}

// ---- UTC datetime helpers (MySQL-safe "YYYY-MM-DD HH:mm:ss" in UTC) ----
// Never use MySQL's NOW() — it depends on server timezone which may not be UTC.
export function utcNow(): string {
  return new Date().toISOString().slice(0, 19).replace('T', ' ');
}
export function unixToUtc(unixSeconds: string | number): string {
  return new Date(Number(unixSeconds) * 1000).toISOString().slice(0, 19).replace('T', ' ');
}

// ---- Sleep (for rate limiting bulk sends) ----
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---- Rate limit: 80 messages / second for Cloud API ----
export const WA_RATE_LIMIT_MS = 15; // ~66/sec, safe below 80/sec limit
