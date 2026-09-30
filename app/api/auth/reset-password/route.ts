/**
 * POST /api/auth/reset-password  { email, resetToken, password }
 * Sets the new password and logs every existing session out.
 */
import { NextRequest } from 'next/server';
import { query, execute } from '@/lib/db';
import { apiSuccess, apiError } from '@/lib/utils';
import { hashPassword, invalidateUserTokens } from '@/lib/auth';
import { RowDataPacket } from 'mysql2';

export async function POST(req: NextRequest) {
  try {
    const body       = await req.json().catch(() => ({}));
    const email      = String(body.email      || '').trim().toLowerCase();
    const resetToken = String(body.resetToken || '').trim();
    const password   = String(body.password   || '');

    if (!email || !resetToken)   return apiError('Reset session expired — start again');
    if (password.length < 8)     return apiError('Password must be at least 8 characters');

    const rows = await query<RowDataPacket[]>(
      `SELECT id, user_id FROM password_resets
       WHERE reset_token = ? AND email = ? AND used_at IS NULL AND expires_at > UTC_TIMESTAMP()
       LIMIT 1`,
      [resetToken, email]
    );
    const row = rows[0];
    if (!row) return apiError('Reset session expired — start again');

    await execute('UPDATE users SET password = ? WHERE id = ?', [await hashPassword(password), row.user_id]);
    await execute('UPDATE password_resets SET used_at = UTC_TIMESTAMP() WHERE id = ?', [row.id]);
    // Any other pending codes for this email are dead now
    await execute(
      'UPDATE password_resets SET used_at = UTC_TIMESTAMP() WHERE email = ? AND used_at IS NULL',
      [email]
    );
    await invalidateUserTokens(Number(row.user_id));

    return apiSuccess({ reset: true, message: 'Password updated — sign in with your new password' });
  } catch (err) {
    console.error('[reset-password]', err);
    return apiError('Server error', 500);
  }
}
