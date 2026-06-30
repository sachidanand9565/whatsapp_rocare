/**
 * POST /api/admin/login — dedicated super-admin login (no workspace required).
 * Platform admin panel workspace-scoped nahi hai, isliye normal /api/auth/login
 * ki "workspace required" condition yahan apply nahi hoti.
 */
import { NextRequest } from 'next/server';
import { comparePassword, signToken, isSuperAdminEmail } from '@/lib/auth';
import { query } from '@/lib/db';
import { apiSuccess, apiError } from '@/lib/utils';
import { RowDataPacket } from 'mysql2';

export async function POST(req: NextRequest) {
  try {
    const { email, password } = await req.json();
    if (!email || !password) return apiError('Email and password required');

    const users = await query<RowDataPacket[]>(
      'SELECT id, name, email, password, is_active FROM users WHERE email = ? LIMIT 1',
      [email]
    );
    if (users.length === 0) return apiError('Invalid credentials', 401);

    const u = users[0];
    const valid = await comparePassword(password, u.password as string);
    if (!valid) return apiError('Invalid credentials', 401);
    if (!u.is_active) return apiError('Account disabled', 403);

    // Super-admin check: env email (no column needed) OR users.is_super_admin
    let isSuper = isSuperAdminEmail(u.email as string);
    if (!isSuper) {
      try {
        const f = await query<RowDataPacket[]>('SELECT is_super_admin FROM users WHERE id = ? LIMIT 1', [u.id]);
        isSuper = !!f[0]?.is_super_admin;
      } catch { /* is_super_admin column may not exist yet */ }
    }
    if (!isSuper) return apiError('This account is not a super-admin.', 403);

    // workspaceId 0 — admin APIs platform-level hain, workspace use nahi karte
    const token = signToken({ userId: u.id as number, email: u.email as string, role: 'admin', workspaceId: 0 });

    return apiSuccess({ token, user: { id: u.id, name: u.name, email: u.email } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[admin/login]', msg);
    return apiError(process.env.NODE_ENV === 'development' ? msg : 'Internal server error', 500);
  }
}
