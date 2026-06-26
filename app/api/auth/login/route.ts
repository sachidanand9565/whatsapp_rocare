/**
 * POST /api/auth/login
 */
import { NextRequest } from 'next/server';
import { comparePassword, signToken, signHandoffCode } from '@/lib/auth';
import { query } from '@/lib/db';
import { apiSuccess, apiError } from '@/lib/utils';
import { RowDataPacket } from 'mysql2';

export async function POST(req: NextRequest) {
  try {
    const { email, password } = await req.json();
    if (!email || !password) return apiError('Email and password required');

    // Get user
    const users = await query<RowDataPacket[]>(
      'SELECT id, name, email, password, role, is_active FROM users WHERE email = ? LIMIT 1',
      [email]
    );
    if (users.length === 0) return apiError('Invalid credentials', 401);

    const user = users[0];
    const valid = await comparePassword(password, user.password as string);
    if (!valid) return apiError('Invalid credentials', 401);
    if (!user.is_active) return apiError('Account disabled', 403);

    // Get ALL workspaces for this user (ordered by id so first is oldest/default)
    const workspaces = await query<RowDataPacket[]>(
      `SELECT w.id, w.name, w.phone_number_id, w.plan, wm.role
       FROM workspaces w
       JOIN workspace_members wm ON wm.workspace_id = w.id
       WHERE wm.user_id = ?
       ORDER BY w.id ASC`,
      [user.id]
    );
    if (workspaces.length === 0) return apiError('No workspace found for this account', 403);

    const defaultWs = workspaces[0];

    const token = signToken({
      userId:      user.id as number,
      email:       user.email as string,
      role:        defaultWs.role as string,
      workspaceId: defaultWs.id as number,
    });

    const handoffCode = signHandoffCode({
      userId:      user.id as number,
      email:       user.email as string,
      role:        defaultWs.role as string,
      workspaceId: defaultWs.id as number,
    });

    const response = apiSuccess({
      token,
      handoffCode,
      user: { id: user.id, name: user.name, email: user.email, role: defaultWs.role },
      workspaceId: defaultWs.id,
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
    console.error('[login]', msg);
    return apiError(
      process.env.NODE_ENV === 'development' ? msg : 'Internal server error',
      500
    );
  }
}
