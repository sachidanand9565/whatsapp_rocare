/**
 * GET  /api/quick-replies  — list saved quick replies for workspace
 * POST /api/quick-replies  — create a new quick reply
 */
import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { query, insert } from '@/lib/db';
import { apiSuccess, apiError } from '@/lib/utils';
import { RowDataPacket } from 'mysql2';

export async function GET(req: NextRequest) {
  try {
    const payload = await requireAuth(req);
    const rows = await query<RowDataPacket[]>(
      'SELECT id, title, content FROM quick_replies WHERE workspace_id = ? ORDER BY title ASC',
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
    const { title, content } = await req.json();
    if (!title?.trim() || !content?.trim()) return apiError('Title and content are required');

    const id = await insert(
      'INSERT INTO quick_replies (workspace_id, title, content) VALUES (?, ?, ?)',
      [payload.workspaceId, title.trim(), content.trim()]
    );
    return apiSuccess({ id, title: title.trim(), content: content.trim() }, 201);
  } catch (err) {
    if (err instanceof Error && err.message === 'UNAUTHORIZED') return apiError('Unauthorized', 401);
    return apiError('Server error', 500);
  }
}
