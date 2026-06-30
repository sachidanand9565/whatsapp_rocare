/**
 * GET    /api/campaigns/[id]/assign  — list agents assigned to this campaign
 * POST   /api/campaigns/[id]/assign  — assign agent(s) to campaign (admin/manager)
 * DELETE /api/campaigns/[id]/assign  — remove assignment (admin/manager)
 */
import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { query, insert } from '@/lib/db';
import { apiSuccess, apiError } from '@/lib/utils';
import { RowDataPacket } from 'mysql2';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, ctx: Ctx) {
  try {
    const payload = await requireAuth(req);
    const { id } = await ctx.params;

    const assignments = await query<RowDataPacket[]>(
      `SELECT u.id, u.name, u.email, u.role, ca.created_at AS assigned_at
       FROM campaign_assignments ca
       JOIN users u ON u.id = ca.agent_id
       WHERE ca.campaign_id = ?`,
      [id]
    );

    return apiSuccess(assignments);
  } catch (err: unknown) {
    if (err instanceof Error && err.message === 'UNAUTHORIZED') return apiError('Unauthorized', 401);
    return apiError('Server error', 500);
  }
}

export async function POST(req: NextRequest, ctx: Ctx) {
  try {
    const payload = await requireAuth(req);
    if (!['admin', 'manager'].includes(payload.role)) return apiError('Admin or Manager only', 403);

    const { id } = await ctx.params;
    const { agent_id } = await req.json();
    if (!agent_id) return apiError('agent_id required');

    await insert(
      `INSERT IGNORE INTO campaign_assignments (campaign_id, agent_id, assigned_by)
       VALUES (?, ?, ?)`,
      [id, agent_id, payload.userId]
    );

    return apiSuccess({ assigned: true });
  } catch (err: unknown) {
    if (err instanceof Error && err.message === 'UNAUTHORIZED') return apiError('Unauthorized', 401);
    return apiError('Server error', 500);
  }
}

export async function DELETE(req: NextRequest, ctx: Ctx) {
  try {
    const payload = await requireAuth(req);
    if (!['admin', 'manager'].includes(payload.role)) return apiError('Admin or Manager only', 403);

    const { id } = await ctx.params;
    const { agent_id } = await req.json();
    if (!agent_id) return apiError('agent_id required');

    await query(
      'DELETE FROM campaign_assignments WHERE campaign_id = ? AND agent_id = ?',
      [id, agent_id]
    );

    return apiSuccess({ removed: true });
  } catch (err: unknown) {
    if (err instanceof Error && err.message === 'UNAUTHORIZED') return apiError('Unauthorized', 401);
    return apiError('Server error', 500);
  }
}
