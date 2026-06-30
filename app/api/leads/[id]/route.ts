/**
 * GET    /api/leads/[id]  — get single lead
 * PATCH  /api/leads/[id]  — update lead (stage, notes, assigned_to, deal_value, etc.)
 * DELETE /api/leads/[id]  — delete lead
 */
import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { query, execute, insert } from '@/lib/db';
import { apiSuccess, apiError, utcNow } from '@/lib/utils';
import { RowDataPacket } from 'mysql2';

type Ctx = { params: { id: string } };

export async function GET(req: NextRequest, { params }: Ctx) {
  try {
    const payload = await requireAuth(req);
    const [lead] = await query<RowDataPacket[]>(
      `SELECT l.*, u.name AS assigned_name
       FROM leads l
       LEFT JOIN users u ON u.id = l.assigned_to
       WHERE l.id = ? AND l.workspace_id = ?`,
      [Number(params.id), payload.workspaceId]
    );
    if (!lead) return apiError('Not found', 404);
    return apiSuccess(lead);
  } catch (err) {
    if (err instanceof Error && err.message === 'UNAUTHORIZED') return apiError('Unauthorized', 401);
    return apiError('Server error', 500);
  }
}

export async function PATCH(req: NextRequest, { params }: Ctx) {
  try {
    const payload = await requireAuth(req);
    const body = await req.json();
    const id   = Number(params.id);
    const now  = utcNow();

    // Log stage change as activity
    if (body.stage !== undefined) {
      const [current] = await query<RowDataPacket[]>(
        'SELECT stage FROM leads WHERE id = ? AND workspace_id = ?',
        [id, payload.workspaceId]
      );
      if (current && current.stage !== body.stage) {
        await insert(
          `INSERT INTO lead_activities (lead_id, type, description, done_by, created_at) VALUES (?, ?, ?, ?, ?)`,
          [id, 'stage_change', `Stage changed: ${current.stage} → ${body.stage}`, payload.userId, now]
        );
      }
    }

    const allowed = ['name', 'phone', 'email', 'stage', 'assigned_to', 'deal_value', 'notes', 'contact_id', 'source'];
    const updates: string[] = [];
    const vals: unknown[]   = [];
    for (const key of allowed) {
      if (key in body) {
        updates.push(`${key} = ?`);
        vals.push(body[key]);
      }
    }
    if (!updates.length) return apiError('Nothing to update', 400);

    updates.push('updated_at = ?');
    vals.push(now, id, payload.workspaceId);

    await execute(
      `UPDATE leads SET ${updates.join(', ')} WHERE id = ? AND workspace_id = ?`,
      vals
    );
    return apiSuccess({ updated: true });
  } catch (err) {
    if (err instanceof Error && err.message === 'UNAUTHORIZED') return apiError('Unauthorized', 401);
    return apiError('Server error', 500);
  }
}

export async function DELETE(req: NextRequest, { params }: Ctx) {
  try {
    const payload = await requireAuth(req);
    await execute(
      'DELETE FROM leads WHERE id = ? AND workspace_id = ?',
      [Number(params.id), payload.workspaceId]
    );
    return apiSuccess({ deleted: true });
  } catch (err) {
    if (err instanceof Error && err.message === 'UNAUTHORIZED') return apiError('Unauthorized', 401);
    return apiError('Server error', 500);
  }
}
