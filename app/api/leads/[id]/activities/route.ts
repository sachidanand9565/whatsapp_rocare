/**
 * GET  /api/leads/[id]/activities  — list activities for a lead
 * POST /api/leads/[id]/activities  — add activity (note, call, followup, etc.)
 */
import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { query, insert } from '@/lib/db';
import { apiSuccess, apiError, utcNow } from '@/lib/utils';
import { RowDataPacket } from 'mysql2';

type Ctx = { params: { id: string } };

export async function GET(req: NextRequest, { params }: Ctx) {
  try {
    requireAuth(req);
    const rows = await query<RowDataPacket[]>(
      `SELECT a.*, u.name AS done_by_name
       FROM lead_activities a
       LEFT JOIN users u ON u.id = a.done_by
       WHERE a.lead_id = ?
       ORDER BY a.created_at DESC`,
      [Number(params.id)]
    );
    return apiSuccess(rows);
  } catch (err) {
    if (err instanceof Error && err.message === 'UNAUTHORIZED') return apiError('Unauthorized', 401);
    return apiError('Server error', 500);
  }
}

export async function POST(req: NextRequest, { params }: Ctx) {
  try {
    const payload = requireAuth(req);
    const { type, description, scheduled_at } = await req.json();
    if (!description) return apiError('description is required', 400);

    const id = await insert(
      `INSERT INTO lead_activities (lead_id, type, description, done_by, scheduled_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [Number(params.id), type || 'note', description, payload.userId, scheduled_at || null, utcNow()]
    );
    return apiSuccess({ id });
  } catch (err) {
    if (err instanceof Error && err.message === 'UNAUTHORIZED') return apiError('Unauthorized', 401);
    return apiError('Server error', 500);
  }
}
