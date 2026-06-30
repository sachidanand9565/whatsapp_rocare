/**
 * GET /api/admin/workspaces/[id]/meta-status — LIVE Meta status check (super-admin)
 * DB me credentials hone ka matlab "connected" nahi — ye Meta Graph API se asli
 * status laata hai (active / banned / token invalid / not configured).
 */
import { NextRequest } from 'next/server';
import { requireSuperAdmin } from '@/lib/admin';
import { query } from '@/lib/db';
import { apiSuccess, apiError } from '@/lib/utils';
import { RowDataPacket } from 'mysql2';

const API_VERSION = 'v23.0';

type Params = { params: { id: string } };

export async function GET(req: NextRequest, { params }: Params) {
  try {
    await requireSuperAdmin(req);
    const id = Number(params.id);
    if (!id) return apiError('Invalid id');

    const rows = await query<RowDataPacket[]>(
      'SELECT phone_number_id, access_token FROM workspaces WHERE id = ? LIMIT 1',
      [id]
    );
    if (rows.length === 0) return apiError('Project not found', 404);

    const phoneId = (rows[0].phone_number_id as string) || '';
    const token   = (rows[0].access_token as string) || '';
    if (!phoneId || !token) {
      return apiSuccess({ status: 'not_configured' });
    }

    // Live check against Meta Graph API
    const url = `https://graph.facebook.com/${API_VERSION}/${phoneId}?fields=verified_name,display_phone_number,quality_rating,code_verification_status,platform_type,name_status`;
    let res: Response;
    try {
      res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    } catch {
      return apiSuccess({ status: 'unreachable' });
    }
    const data = await res.json().catch(() => ({}));

    if (!res.ok || data?.error) {
      const err = data?.error || {};
      // Common: token invalid/expired (190), number banned/unavailable, etc.
      return apiSuccess({
        status:  'disconnected',
        code:    err.code ?? res.status,
        message: err.message || `Meta returned HTTP ${res.status}`,
      });
    }

    return apiSuccess({
      status:                  'active',
      verified_name:           data.verified_name,
      display_phone_number:    data.display_phone_number,
      quality_rating:          data.quality_rating,
      code_verification_status: data.code_verification_status,
      platform_type:           data.platform_type,
      name_status:             data.name_status,
    });
  } catch (err) {
    if (err instanceof Error && err.message === 'UNAUTHORIZED') return apiError('Unauthorized', 401);
    if (err instanceof Error && err.message === 'FORBIDDEN')    return apiError('Forbidden — super admin only', 403);
    console.error('[admin/workspaces/[id]/meta-status]', err);
    return apiError('Server error', 500);
  }
}
