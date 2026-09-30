/**
 * POST /api/auth/forgot-password  { email }
 * Emails a 6-digit OTP. The response never says whether the email exists —
 * otherwise this endpoint becomes a way to discover registered accounts.
 */
import { NextRequest } from 'next/server';
import { query, insert } from '@/lib/db';
import { apiSuccess, apiError } from '@/lib/utils';
import { sendMail, otpEmail, mailConfigured } from '@/lib/mailer';
import { hashOtp, generateOtp } from '@/lib/otp';
import { RowDataPacket } from 'mysql2';

const OTP_TTL_MINUTES = 10;
const MAX_PER_WINDOW  = 3;      // codes per email…
const WINDOW_MINUTES  = 15;     // …within this many minutes

export async function POST(req: NextRequest) {
  try {
    const body  = await req.json().catch(() => ({}));
    const email = String(body.email || '').trim().toLowerCase();

    if (!email || !email.includes('@')) return apiError('Enter a valid email address');
    if (!mailConfigured()) {
      console.error('[forgot-password] SMTP not configured');
      return apiError('Email service is not configured — contact support', 500);
    }

    const ok = apiSuccess({ sent: true, message: 'If that email is registered, a code is on its way.' });

    const users = await query<RowDataPacket[]>(
      'SELECT id, name, is_active FROM users WHERE email = ? LIMIT 1',
      [email]
    );
    const user = users[0];
    if (!user || Number(user.is_active) === 0) return ok;   // silent no-op

    // Rate limit per email so a stranger can't flood someone's inbox
    const recent = await query<RowDataPacket[]>(
      `SELECT COUNT(*) AS cnt FROM password_resets
       WHERE email = ? AND created_at > DATE_SUB(UTC_TIMESTAMP(), INTERVAL ? MINUTE)`,
      [email, WINDOW_MINUTES]
    );
    if (Number(recent[0]?.cnt || 0) >= MAX_PER_WINDOW) {
      return apiError(`Too many reset codes requested — try again in ${WINDOW_MINUTES} minutes`, 429);
    }

    const otp = generateOtp();
    await insert(
      `INSERT INTO password_resets (user_id, email, otp_hash, expires_at)
       VALUES (?, ?, ?, DATE_ADD(UTC_TIMESTAMP(), INTERVAL ? MINUTE))`,
      [user.id, email, hashOtp(otp, email), OTP_TTL_MINUTES]
    );

    const mail = otpEmail(otp, OTP_TTL_MINUTES);
    try {
      await sendMail({ to: email, ...mail });
    } catch (err) {
      console.error('[forgot-password] send failed:', err);
      return apiError('Could not send the email right now — try again in a minute', 502);
    }

    return ok;
  } catch (err) {
    console.error('[forgot-password]', err);
    return apiError('Server error', 500);
  }
}
