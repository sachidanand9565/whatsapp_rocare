/**
 * POST /api/auth/sso-exchange
 * Cross-domain login handoff: ek short-lived handoff code ko asli session (token +
 * workspaces) me exchange karta hai. limbu.ai signup/login se `handoffCode` leta hai,
 * user ko /auth/sso?code=... pe redirect karta hai, aur ye route session bana deta hai.
 */
import { NextRequest } from 'next/server';
import { verifyHandoffCode, signToken } from '@/lib/auth';
import { query } from '@/lib/db';
import { apiSuccess, apiError } from '@/lib/utils';
import { RowDataPacket } from 'mysql2';

export async function POST(req: NextRequest) {
  try {
    const { code } = await req.json();
    if (!code) return apiError('Missing code');

    let claims;
    try {
      claims = verifyHandoffCode(code);
    } catch {
      return apiError('Invalid or expired login code', 401);
    }

    const users = await query<RowDataPacket[]>(
      'SELECT id, name, email, is_active FROM users WHERE id = ? LIMIT 1',
      [claims.userId]
    );
    if (users.length === 0) return apiError('User not found', 404);
    const user = users[0];
    if (!user.is_active) return apiError('Account disabled', 403);

    const workspaces = await query<RowDataPacket[]>(
      `SELECT w.id, w.name, w.phone_number_id, w.plan, wm.role
       FROM workspaces w
       JOIN workspace_members wm ON wm.workspace_id = w.id
       WHERE wm.user_id = ?
       ORDER BY w.id ASC`,
      [user.id]
    );
    if (workspaces.length === 0) return apiError('No workspace found for this account', 403);

    // Code me jo workspace tha use prefer karo, warna default (pehla)
    const current = workspaces.find((w) => w.id === claims.workspaceId) || workspaces[0];

    const token = signToken({
      userId:      user.id as number,
      email:       user.email as string,
      role:        current.role as string,
      workspaceId: current.id as number,
    });

    const response = apiSuccess({
      token,
      user: { id: user.id, name: user.name, email: user.email, role: current.role },
      workspaceId: current.id,
      workspaces:  workspaces.map((w) => ({ id: w.id, name: w.name, phone_number_id: w.phone_number_id, plan: w.plan, role: w.role })),
    });
    response.cookies.set('token', token, {
      httpOnly: true,
      secure:   process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge:   60 * 60 * 24 * 7,
      path:     '/',
    });
    return response;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[sso-exchange]', msg);
    return apiError(
      process.env.NODE_ENV === 'development' ? msg : 'Internal server error',
      500
    );
  }
}
