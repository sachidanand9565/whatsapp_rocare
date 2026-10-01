/**
 * POST /api/auth/signup/send-otp  { email }
 * Emails a 6-digit code before the account is created. Unlike the password
 * reset flow this one does say when an email is already registered — signup
 * has to tell you that anyway.
 */
import { NextRequest } from 'next/server';
import { query, insert } from '@/lib/db';
import { apiSuccess, apiError } from '@/lib/utils';
import { sendMail, signupOtpEmail, mailConfigured } from '@/lib/mailer';
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
      console.error('[signup/send-otp] SMTP not configured');
      return apiError('Email service is not configured — contact support', 500);
    }

    const existing = await query<RowDataPacket[]>('SELECT id FROM users WHERE email = ? LIMIT 1', [email]);
    if (existing.length > 0) return apiError('Email already registered — sign in instead', 409);

    const recent = await query<RowDataPacket[]>(
      `SELECT COUNT(*) AS cnt FROM email_verifications
       WHERE email = ? AND created_at > DATE_SUB(UTC_TIMESTAMP(), INTERVAL ? MINUTE)`,
      [email, WINDOW_MINUTES]
    );
    if (Number(recent[0]?.cnt || 0) >= MAX_PER_WINDOW) {
      return apiError(`Too many codes requested — try again in ${WINDOW_MINUTES} minutes`, 429);
    }

    const otp = generateOtp();
    await insert(
      `INSERT INTO email_verifications (email, otp_hash, expires_at)
       VALUES (?, ?, DATE_ADD(UTC_TIMESTAMP(), INTERVAL ? MINUTE))`,
      [email, hashOtp(otp, email), OTP_TTL_MINUTES]
    );

    try {
      await sendMail({ to: email, ...signupOtpEmail(otp, OTP_TTL_MINUTES) });
    } catch (err) {
      console.error('[signup/send-otp] send failed:', err);
      return apiError('Could not send the email right now — try again in a minute', 502);
    }

    return apiSuccess({ sent: true, expires_in_minutes: OTP_TTL_MINUTES });
  } catch (err) {
    console.error('[signup/send-otp]', err);
    if ((err as { code?: string })?.code === 'ER_NO_SUCH_TABLE') {
      return apiError('Email verification is not set up yet — run migration-email-verification.sql on the database', 500);
    }
    return apiError('Server error', 500);
  }
}
