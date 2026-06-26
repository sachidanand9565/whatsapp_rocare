/**
 * GET /api/auth/sso-login?email=<email>
 * Server-to-server SSO lookup. Trusted partner (limbu.ai ka BACKEND) ek email ke liye
 * check karta hai ki WhatsApp account exist karta hai ya nahi, aur agar karta hai to
 * ek short-lived handoff code milta hai jisse user ko bina login kiye dashboard me
 * bheja ja sake (redirect: https://whatsapp.limbu.ai/auth/sso?code=<handoffCode>).
 *
 * SECURITY:
 *  - `x-sso-secret` header == SSO_SHARED_SECRET hona zaroori hai.
 *  - SIRF server-side se call karo (limbu.ai backend). Browser se kabhi nahi —
 *    warna secret leak ho jayega aur koi bhi email ke against login kar lega.
 */
import { NextRequest } from 'next/server';
import { timingSafeEqual } from 'crypto';
import { signHandoffCode } from '@/lib/auth';
import { query } from '@/lib/db';
import { apiSuccess, apiError } from '@/lib/utils';
import { RowDataPacket } from 'mysql2';

function secretOk(provided: string | null): boolean {
  const expected = process.env.SSO_SHARED_SECRET || '';
  if (!expected || !provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export async function GET(req: NextRequest) {
  try {
    if (!process.env.SSO_SHARED_SECRET) {
      return apiError('SSO not configured on server', 503);
    }
    if (!secretOk(req.headers.get('x-sso-secret'))) {
      return apiError('Unauthorized', 401);
    }

    const email = req.nextUrl.searchParams.get('email')?.trim();
    if (!email) return apiError('email is required');

    const users = await query<RowDataPacket[]>(
      'SELECT id, email, is_active FROM users WHERE email = ? LIMIT 1',
      [email]
    );
    if (users.length === 0) return apiSuccess({ exists: false });

    const user = users[0];
    if (!user.is_active) return apiSuccess({ exists: true, active: false });

    // Default (oldest) workspace for this user
    const ws = await query<RowDataPacket[]>(
      `SELECT w.id, wm.role
       FROM workspaces w
       JOIN workspace_members wm ON wm.workspace_id = w.id
       WHERE wm.user_id = ?
       ORDER BY w.id ASC LIMIT 1`,
      [user.id]
    );
    if (ws.length === 0) return apiSuccess({ exists: true, active: true, handoffCode: null });

    const handoffCode = signHandoffCode({
      userId:      user.id as number,
      email:       user.email as string,
      role:        ws[0].role as string,
      workspaceId: ws[0].id as number,
    });

    return apiSuccess({ exists: true, active: true, handoffCode });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[sso-login]', msg);
    return apiError(
      process.env.NODE_ENV === 'development' ? msg : 'Internal server error',
      500
    );
  }
}
