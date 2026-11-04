/**
 * lib/phoneImport.ts — read a phone number from an imported CSV, any country.
 *
 * Checked against real numbering rules (libphonenumber), in this order:
 *  1. "+44 7911 123456" / "0044 7911 123456" → international as written.
 *  2. Digits that already start with a country code ("447911123456",
 *     "12125551234", "971501234567") → kept. Needs 11+ digits so a bare
 *     10-digit national number isn't misread as some other country's.
 *  3. Otherwise the number is national for `countryCode` (the import's
 *     "numbers without a country code are from…" choice, default India):
 *     UK "07911 123456" → 447911123456, US "(212) 555-1234" → 12125551234.
 * Returns digits without '+' (E.164), or null when no reading is a valid number.
 */
import { parsePhoneNumberFromString, type CountryCode } from 'libphonenumber-js/max';

// Calling code → region for the national-number reading (see lib/phoneCountries)
const REGION: Record<string, CountryCode> = {
  '91': 'IN', '44': 'GB', '1': 'US', '971': 'AE', '966': 'SA',
  '61': 'AU', '65': 'SG', '977': 'NP',
};

function valid(text: string, region?: CountryCode): string | null {
  const p = parsePhoneNumberFromString(text, region);
  return p && p.isValid() ? p.number.slice(1) : null;
}

export function parseImportPhone(raw: string, countryCode?: string): string | null {
  const text = String(raw || '').trim();
  const digits = text.replace(/\D/g, '');
  if (digits.length < 6) return null;

  if (text.startsWith('+')) return valid('+' + digits);
  if (digits.startsWith('00')) return valid('+' + digits.slice(2));

  if (digits.length >= 11) {
    const intl = valid('+' + digits);
    if (intl) return intl;
  }
  const region = REGION[String(countryCode || '91').replace(/\D/g, '')] || 'IN';
  return valid(digits, region);
}
