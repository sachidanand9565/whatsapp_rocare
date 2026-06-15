/**
 * lib/idCrypt.ts
 * Reversible obfuscation for numeric IDs shown in browser URLs
 * (e.g. /campaigns/[id], /flows/[id]) so raw DB IDs aren't exposed.
 * Works in both browser and server (no Node-only crypto APIs).
 */

const KEY = 'wa-flow-id-key-2024';

// Random salt prepended before encoding so short IDs still produce
// a longer, non-obvious token. Decoding just strips the first SALT_LEN chars.
const SALT_LEN = 8;
const SALT_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

function randomSalt(len: number): string {
  let out = '';
  for (let i = 0; i < len; i++) {
    out += SALT_CHARS.charAt(Math.floor(Math.random() * SALT_CHARS.length));
  }
  return out;
}

function toBase64Url(bin: string): string {
  const b64 = typeof window !== 'undefined' ? window.btoa(bin) : Buffer.from(bin, 'binary').toString('base64');
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(b64url: string): string {
  let b64 = b64url.replace(/-/g, '+').replace(/_/g, '/');
  while (b64.length % 4) b64 += '=';
  return typeof window !== 'undefined' ? window.atob(b64) : Buffer.from(b64, 'base64').toString('binary');
}

/** Encode a numeric/string ID into a longer, opaque URL-safe token. */
export function encryptId(id: number | string): string {
  const str = randomSalt(SALT_LEN) + String(id);
  let out = '';
  for (let i = 0; i < str.length; i++) {
    out += String.fromCharCode(str.charCodeAt(i) ^ KEY.charCodeAt(i % KEY.length));
  }
  return toBase64Url(out);
}

/** Decode a token produced by encryptId() back to the original ID string. Returns null if invalid. */
export function decryptId(token: string): string | null {
  try {
    const bin = fromBase64Url(token);
    let out = '';
    for (let i = 0; i < bin.length; i++) {
      out += String.fromCharCode(bin.charCodeAt(i) ^ KEY.charCodeAt(i % KEY.length));
    }
    const id = out.slice(SALT_LEN);
    if (!/^\d+$/.test(id)) return null;
    return id;
  } catch {
    return null;
  }
}
