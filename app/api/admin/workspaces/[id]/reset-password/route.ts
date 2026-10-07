/**
 * POST /api/admin/workspaces/[id]/reset-password — set the project owner's
 * login password (super-admin only).
 *   body: { password?: string }   // omitted → a strong one is generated
 * Returns the plaintext password ONCE so the admin can pass it on; every
 * existing session of that user is logged out.
 */
import { NextRequest } from 'next/server';
import { requireSuperAdmin } from '@/lib/admin';
import { hashPassword, invalidateUserTokens } from '@/lib/auth';
import { execute, query } from '@/lib/db';
import { apiSuccess, apiError } from '@/lib/utils';
import { RowDataPacket } from 'mysql2';
import crypto from 'crypto';

type Params = { params: { id: string } };

// No look-alike characters (0/O, 1/l) — these get read out over the phone
const ALPHABET = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function generatePassword(length = 12): string {
  const bytes = crypto.randomBytes(length);
  return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join('');
}

export async function POST(req: NextRequest, { params }: Params) {
  try {
    await requireSuperAdmin(req);
    const id = Number(params.id);
    if (!id) return apiError('Invalid id');

    const body     = await req.json().catch(() => ({}));
    const supplied = String(body.password || '').trim();
    if (supplied && supplied.length < 8) {
      return apiError('Password must be at least 8 characters');
    }

    const rows = await query<RowDataPacket[]>(
      `SELECT ou.id, ou.email, ou.name
       FROM workspaces w JOIN users ou ON ou.id = w.owner_id
       WHERE w.id = ? LIMIT 1`,
      [id]
    );
    const owner = rows[0];
    if (!owner) return apiError('Project owner not found', 404);

    const password = supplied || generatePassword();
    await execute('UPDATE users SET password = ? WHERE id = ?', [await hashPassword(password), owner.id]);
    await invalidateUserTokens(Number(owner.id));

    return apiSuccess({
      password,
      email:     owner.email,
      name:      owner.name,
      generated: !supplied,
    });
  } catch (err) {
    if (err instanceof Error && err.message === 'UNAUTHORIZED') return apiError('Unauthorized', 401);
    if (err instanceof Error && err.message === 'FORBIDDEN')    return apiError('Forbidden — super admin only', 403);
    console.error('[admin/reset-password]', err);
    return apiError('Server error', 500);
  }
}
