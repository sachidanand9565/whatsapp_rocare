/**
 * GET  /api/chatbot  — list rules
 * POST /api/chatbot  — create rule
 */
import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { query, insert } from '@/lib/db';
import { apiSuccess, apiError } from '@/lib/utils';
import { RowDataPacket } from 'mysql2';

export async function GET(req: NextRequest) {
  try {
    const payload = await requireAuth(req);
    const rules = await query<RowDataPacket[]>(
      'SELECT * FROM chatbot_rules WHERE workspace_id = ? ORDER BY priority DESC, id ASC',
      [payload.workspaceId]
    );
    return apiSuccess(rules);
  } catch (err: unknown) {
    if (err instanceof Error && err.message === 'UNAUTHORIZED') return apiError('Unauthorized', 401);
    return apiError('Server error', 500);
  }
}

export async function POST(req: NextRequest) {
  try {
    const payload = await requireAuth(req);
    const {
      trigger_type, trigger_value,
      response_type, response_text,
      response_template_id, flow_data, priority,
    } = await req.json();

    if (!trigger_type || !response_type) return apiError('trigger_type and response_type are required');

    const id = await insert(
      `INSERT INTO chatbot_rules
       (workspace_id, trigger_type, trigger_value, response_type, response_text, response_template_id, flow_data, priority)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        payload.workspaceId,
        trigger_type, trigger_value || null,
        response_type, response_text || null,
        response_template_id || null,
        JSON.stringify(flow_data || []),
        priority || 0,
      ]
    );
    return apiSuccess({ id }, 201);
  } catch (err: unknown) {
    if (err instanceof Error && err.message === 'UNAUTHORIZED') return apiError('Unauthorized', 401);
    console.error('[chatbot POST]', err);
    return apiError('Server error', 500);
  }
}
