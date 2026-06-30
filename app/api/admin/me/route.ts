/**
 * GET /api/admin/me — check if current user is a platform super-admin
 */
import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { isSuperAdmin } from '@/lib/admin';
import { apiSuccess, apiError } from '@/lib/utils';

export async function GET(req: NextRequest) {
  try {
    const payload = await requireAuth(req);
    const ok = await isSuperAdmin(payload);
    return apiSuccess({ isSuperAdmin: ok, email: payload.email });
  } catch (err) {
    if (err instanceof Error && err.message === 'UNAUTHORIZED') return apiError('Unauthorized', 401);
    return apiError('Server error', 500);
  }
}
