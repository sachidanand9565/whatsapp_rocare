/**
 * GET  /api/failed-webhooks  — list all failed-message webhooks for workspace
 * POST /api/failed-webhooks  — create new webhook
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
      `SELECT fw.id, fw.name, fw.campaign_id, c.name AS campaign_name,
              fw.api_url, fw.api_method, fw.api_headers, fw.is_active, fw.created_at
       FROM failed_msg_webhooks fw
       JOIN campaigns c ON c.id = fw.campaign_id
       WHERE fw.workspace_id = ?
       ORDER BY fw.created_at DESC`,
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
    const { name, campaign_id, api_url, api_method, api_headers } = await req.json();

    if (!name)        return apiError('name is required', 400);
    if (!campaign_id) return apiError('campaign_id is required', 400);
    if (!api_url)     return apiError('api_url is required', 400);

    const id = await insert(
      `INSERT INTO failed_msg_webhooks
         (workspace_id, name, campaign_id, api_url, api_method, api_headers, is_active, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 1, ?)`,
      [
        payload.workspaceId,
        name,
        Number(campaign_id),
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
