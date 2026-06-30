/**
 * GET  /api/crm  — list all CRM integrations for workspace
 * POST /api/crm  — create new CRM integration
 */
import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { query, insert } from '@/lib/db';
import { apiSuccess, apiError, utcNow } from '@/lib/utils';
import { RowDataPacket } from 'mysql2';

export async function GET(req: NextRequest) {
  try {
    const payload = await requireAuth(req);
    const rows = await query<RowDataPacket[]>(
      `SELECT id, name, template_name, api_url, api_method, api_headers, is_active, created_at
       FROM crm_integrations WHERE workspace_id = ? ORDER BY created_at DESC`,
      [payload.workspaceId]
    );
    return apiSuccess(rows);
  } catch (err) {
    if (err instanceof Error && err.message === 'UNAUTHORIZED') return apiError('Unauthorized', 401);
    return apiError('Server error', 500);
  }
}

export async function POST(req: NextRequest) {
  try {
    const payload = await requireAuth(req);
    const { name, template_name, api_url, api_method, api_headers } = await req.json();

    if (!name)          return apiError('name is required', 400);
    if (!template_name) return apiError('template_name is required', 400);
    if (!api_url)       return apiError('api_url is required', 400);

    const id = await insert(
      `INSERT INTO crm_integrations
         (workspace_id, name, template_name, api_url, api_method, api_headers, is_active, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 1, ?)`,
      [
        payload.workspaceId,
        name,
        template_name,
        api_url,
        api_method || 'POST',
        api_headers || null,
        utcNow(),
      ]
    );
    return apiSuccess({ id });
  } catch (err) {
    if (err instanceof Error && err.message === 'UNAUTHORIZED') return apiError('Unauthorized', 401);
    return apiError('Server error', 500);
  }
}
