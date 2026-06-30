/**
 * lib/admin.ts
 * Platform super-admin gate. Super-admin = email in SUPER_ADMIN_EMAILS env,
 * OR users.is_super_admin = 1 in DB.
 */
import { NextRequest } from 'next/server';
import { requireAuth, isSuperAdminEmail, type JWTPayload } from '@/lib/auth';
import { query } from '@/lib/db';
import { RowDataPacket } from 'mysql2';

export async function isSuperAdmin(payload: JWTPayload): Promise<boolean> {
  if (isSuperAdminEmail(payload.email)) return true;
  const rows = await query<RowDataPacket[]>(
    'SELECT is_super_admin FROM users WHERE id = ? LIMIT 1',
    [payload.userId]
  );
  return !!rows[0]?.is_super_admin;
}

// Throws 'UNAUTHORIZED' (no/invalid token) or 'FORBIDDEN' (not super-admin)
export async function requireSuperAdmin(req: NextRequest): Promise<JWTPayload> {
  const payload = requireAuth(req);
  if (!(await isSuperAdmin(payload))) throw new Error('FORBIDDEN');
  return payload;
}
