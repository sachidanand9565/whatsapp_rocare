/**
 * lib/otp.ts — password-reset codes.
 * The OTP is never stored, only this hash (the email is mixed in so a code
 * stolen from one row can't be replayed against another).
 */
import crypto from 'crypto';

export function hashOtp(otp: string, email: string): string {
  return crypto.createHash('sha256').update(`${otp}:${email}`).digest('hex');
}

/** 6 digits, zero-padded, from a cryptographic source */
export function generateOtp(): string {
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
}
