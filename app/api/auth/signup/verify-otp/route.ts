/**
 * POST /api/auth/signup/verify-otp  { email, otp }
 * Exchanges the emailed code for a token that /api/auth/signup requires.
 */
import { NextRequest } from 'next/server';
import { query, execute } from '@/lib/db';
import { apiSuccess, apiError } from '@/lib/utils';
import { hashOtp } from '@/lib/otp';
import { RowDataPacket } from 'mysql2';
import crypto from 'crypto';

const MAX_ATTEMPTS      = 5;
const SIGNUP_TTL_MINUTES = 30;   // time to finish the form after verifying

export async function POST(req: NextRequest) {
  try {
    const body  = await req.json().catch(() => ({}));
    const email = String(body.email || '').trim().toLowerCase();
    const otp   = String(body.otp   || '').trim();

    if (!email || !/^\d{6}$/.test(otp)) return apiError('Enter the 6-digit code from your email');

    const rows = await query<RowDataPacket[]>(
      `SELECT id, otp_hash, attempts FROM email_verifications
       WHERE email = ? AND used_at IS NULL AND expires_at > UTC_TIMESTAMP()
       ORDER BY id DESC LIMIT 1`,
      [email]
    );
    const row = rows[0];
    if (!row) return apiError('That code has expired — request a new one');
    if (Number(row.attempts) >= MAX_ATTEMPTS) {
      return apiError('Too many wrong attempts — request a new code', 429);
    }

    if (hashOtp(otp, email) !== row.otp_hash) {
      await execute('UPDATE email_verifications SET attempts = attempts + 1 WHERE id = ?', [row.id]);
      const left = MAX_ATTEMPTS - Number(row.attempts) - 1;
      return apiError(left > 0 ? `Wrong code — ${left} attempt(s) left` : 'Too many wrong attempts — request a new code');
    }

    const verifyToken = crypto.randomBytes(32).toString('hex');
    await execute(
      `UPDATE email_verifications
       SET verify_token = ?, expires_at = DATE_ADD(UTC_TIMESTAMP(), INTERVAL ? MINUTE)
       WHERE id = ?`,
      [verifyToken, SIGNUP_TTL_MINUTES, row.id]
    );

    return apiSuccess({ verifyToken, expires_in_minutes: SIGNUP_TTL_MINUTES });
  } catch (err) {
    console.error('[signup/verify-otp]', err);
    return apiError('Server error', 500);
  }
}
