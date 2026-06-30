/**
 * GET  /api/webhooks — list all chatbot webhooks for workspace
 * POST /api/webhooks — create a new webhook
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { query, insert } from '@/lib/db';
import { apiSuccess, apiError } from '@/lib/utils';
import { RowDataPacket } from 'mysql2';

export async function GET(req: NextRequest) {
  try {
    const payload = await requireAuth(req);
    const rows = await query<RowDataPacket[]>(
      'SELECT id, name, url, secret, is_active, created_at FROM chatbot_webhooks WHERE workspace_id = ? ORDER BY created_at ASC',
      [payload.workspaceId]
    );
    return apiSuccess(rows);
  } catch (err: unknown) {
    if (err instanceof Error && err.message === 'UNAUTHORIZED') return apiError('Unauthorized', 401);
    return apiError('Server error', 500);
  }
}

export async function POST(req: NextRequest) {
  try {
    const payload = await requireAuth(req);
    const { name, url, secret } = await req.json();

    if (!name?.trim())  return apiError('Name is required', 400);
    if (!url?.trim())   return apiError('URL is required', 400);
    if (!url.startsWith('http')) return apiError('URL must start with http:// or https://', 400);

    const id = await insert(
      'INSERT INTO chatbot_webhooks (workspace_id, name, url, secret) VALUES (?, ?, ?, ?)',
      [payload.workspaceId, name.trim(), url.trim(), secret?.trim() || null]
    );
    return apiSuccess({ id }, 201);
  } catch (err: unknown) {
    if (err instanceof Error && err.message === 'UNAUTHORIZED') return apiError('Unauthorized', 401);
    return apiError('Server error', 500);
  }
}
