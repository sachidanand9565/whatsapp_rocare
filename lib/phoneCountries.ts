/**
 * lib/phoneCountries.ts — "numbers without a country code are from…" choices
 * for CSV imports (client-safe; normalizePhone in lib/utils applies them).
 */
export const PHONE_COUNTRIES: { code: string; label: string }[] = [
  { code: '91',  label: 'India (+91)' },
  { code: '44',  label: 'United Kingdom (+44)' },
  { code: '1',   label: 'USA / Canada (+1)' },
  { code: '971', label: 'UAE (+971)' },
  { code: '966', label: 'Saudi Arabia (+966)' },
  { code: '61',  label: 'Australia (+61)' },
  { code: '65',  label: 'Singapore (+65)' },
  { code: '977', label: 'Nepal (+977)' },
];

/** Header of a per-row country code column: country_code / country code / country. */
export const COUNTRY_COL_RE = /^country[\s_-]*(code)?$/i;
