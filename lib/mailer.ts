/**
 * lib/mailer.ts — outgoing email over SMTP (password-reset OTP today).
 *
 * Env:
 *   SMTP_HOST   (required)  e.g. smtp.gmail.com
 *   SMTP_PORT   (optional)  default 587; 465 switches to implicit TLS
 *   SMTP_USER   (required)  mailbox login
 *   SMTP_PASS   (required)  mailbox password / app password
 *   MAIL_FROM   (optional)  default "Limbu AI <SMTP_USER>"
 */
import nodemailer, { type Transporter } from 'nodemailer';

let transporter: Transporter | null = null;

export function mailConfigured(): boolean {
  return !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
}

function getTransporter(): Transporter {
  if (transporter) return transporter;
  if (!mailConfigured()) throw new Error('Email not configured — set SMTP_HOST, SMTP_USER and SMTP_PASS');

  const port = Number(process.env.SMTP_PORT) || 587;
  transporter = nodemailer.createTransport({
    host:   process.env.SMTP_HOST,
    port,
    secure: port === 465,                 // 465 = implicit TLS, 587 = STARTTLS
    auth: { user: process.env.SMTP_USER as string, pass: process.env.SMTP_PASS as string },
  });
  return transporter;
}

export async function sendMail(opts: { to: string; subject: string; html: string; text: string }) {
  const from = process.env.MAIL_FROM || `Limbu AI <${process.env.SMTP_USER}>`;
  await getTransporter().sendMail({ from, ...opts });
}

/** Signup verification OTP mail */
export function signupOtpEmail(code: string, minutes: number) {
  const text =
    `Your Limbu AI verification code is ${code}.\n\n` +
    `Enter it to finish creating your account. It expires in ${minutes} minutes. ` +
    `If you did not sign up, ignore this email.`;

  const html = `
  <div style="font-family:system-ui,-apple-system,'Segoe UI',sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#111">
    <h2 style="margin:0 0 4px;font-size:18px">Verify your email</h2>
    <p style="margin:0 0 20px;color:#666;font-size:14px">Enter this code to finish creating your Limbu AI account.</p>
    <div style="background:#f3faf7;border:1px solid #cdebe0;border-radius:12px;padding:18px;text-align:center">
      <div style="font-size:32px;font-weight:700;letter-spacing:8px;color:#075E54">${code}</div>
      <div style="margin-top:6px;font-size:12px;color:#666">Expires in ${minutes} minutes</div>
    </div>
    <p style="margin:20px 0 0;color:#888;font-size:12px">Didn't sign up? You can ignore this email.</p>
  </div>`;

  return { subject: `${code} is your Limbu AI verification code`, text, html };
}

/** Password-reset OTP mail — plain text is what most inboxes show in the preview. */
export function otpEmail(code: string, minutes: number) {
  const text =
    `Your Limbu AI password reset code is ${code}.\n\n` +
    `It expires in ${minutes} minutes. If you did not request a password reset, ignore this email — your password stays unchanged.`;

  const html = `
  <div style="font-family:system-ui,-apple-system,'Segoe UI',sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#111">
    <h2 style="margin:0 0 4px;font-size:18px">Reset your password</h2>
    <p style="margin:0 0 20px;color:#666;font-size:14px">Use this code to set a new password for your Limbu AI account.</p>
    <div style="background:#f3faf7;border:1px solid #cdebe0;border-radius:12px;padding:18px;text-align:center">
      <div style="font-size:32px;font-weight:700;letter-spacing:8px;color:#075E54">${code}</div>
      <div style="margin-top:6px;font-size:12px;color:#666">Expires in ${minutes} minutes</div>
    </div>
    <p style="margin:20px 0 0;color:#888;font-size:12px">
      Didn't ask for this? Ignore this email — your password stays unchanged.
    </p>
  </div>`;

  return { subject: `${code} is your Limbu AI password reset code`, text, html };
}
