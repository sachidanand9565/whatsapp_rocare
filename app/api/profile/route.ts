/**
 * GET  /api/profile  — get current user's details
 * PUT  /api/profile  — update name/email/phone/password
 *   On password change: invalidates all other sessions, returns new token
 */
import { NextRequest } from 'next/server';
import { requireAuth, hashPassword, comparePassword, signToken, invalidateUserTokens } from '@/lib/auth';
import { query, execute } from '@/lib/db';
import { apiSuccess, apiError } from '@/lib/utils';
import { RowDataPacket } from 'mysql2';

export async function GET(req: NextRequest) {
  try {
    const payload = requireAuth(req);

    const rows = await query<RowDataPacket[]>(
      'SELECT id, name, email, phone FROM users WHERE id = ? LIMIT 1',
      [payload.userId]
    );
    if (rows.length === 0) return apiError('User not found', 404);

    return apiSuccess(rows[0]);
  } catch (err: unknown) {
    if (err instanceof Error && err.message === 'UNAUTHORIZED') return apiError('Unauthorized', 401);
    return apiError('Server error', 500);
  }
}

export async function PUT(req: NextRequest) {
  try {
    const payload = requireAuth(req);
    const { name, email, phone, current_password, new_password } = await req.json();

    const userRows = await query<RowDataPacket[]>(
      'SELECT id, name, email, phone, password FROM users WHERE id = ? LIMIT 1',
      [payload.userId]
    );
    if (userRows.length === 0) return apiError('User not found', 404);
    const user = userRows[0];

    // ── Password change flow ─────────────────────────────────
    let newToken: string | null = null;
    if (new_password) {
      if (!current_password) return apiError('Current password required');
      const valid = await comparePassword(current_password, user.password as string);
      if (!valid) return apiError('Current password is incorrect', 400);
      if (new_password.length < 6) return apiError('New password must be at least 6 characters', 400);

      const hashed = await hashPassword(new_password);
      await execute(
        'UPDATE users SET password = ?, plain_password = ? WHERE id = ?',
        [hashed, new_password, payload.userId]
      );

      // Invalidate all existing sessions for this user
      invalidateUserTokens(payload.userId);

      // Issue a fresh token for the current session
      newToken = signToken({
        userId:      payload.userId,
        email:       (email || user.email) as string,
        role:        payload.role,
        workspaceId: payload.workspaceId,
      });
    }

    // ── Profile details update (email is not changeable) ────
    if (name || phone !== undefined) {
      const updates: string[] = [];
      const params: unknown[] = [];
      if (name)                { updates.push('name = ?');  params.push(name); }
      if (phone !== undefined) { updates.push('phone = ?'); params.push(phone || null); }
      if (updates.length > 0) {
        params.push(payload.userId);
        await execute(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`, params);
      }
    }

    return apiSuccess({
      updated: true,
      ...(newToken ? { token: newToken } : {}),
    });
  } catch (err: unknown) {
    if (err instanceof Error && err.message === 'UNAUTHORIZED') return apiError('Unauthorized', 401);
    return apiError('Server error', 500);
  }
}
