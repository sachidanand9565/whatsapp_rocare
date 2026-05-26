/**
 * lib/utils.ts
 * General utility helpers
 */
import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { NextResponse } from 'next/server';

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
// Auto-adds India country code (91) for 10-digit numbers starting with 6-9
// Handles both: "919876543210" (already full) and "9876543210" (10-digit)
export function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 10 && /^[6-9]/.test(digits)) {
    return '91' + digits;
  }
  return digits;
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
