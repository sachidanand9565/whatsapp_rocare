/**
 * GET /api/agents/[id]/campaigns — campaigns assigned to this agent
 */
import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { query } from '@/lib/db';
import { apiSuccess, apiError } from '@/lib/utils';
import { RowDataPacket } from 'mysql2';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, ctx: Ctx) {
  try {
    const payload = await requireAuth(req);
    if (!['admin', 'manager'].includes(payload.role)) return apiError('Admin or Manager only', 403);

    const { id } = await ctx.params;

    const campaigns = await query<RowDataPacket[]>(
      `SELECT c.id, c.name, c.status, c.campaign_type, t.name AS template_name
       FROM campaign_assignments ca
       JOIN campaigns c ON c.id = ca.campaign_id
       LEFT JOIN templates t ON t.id = c.template_id
       WHERE ca.agent_id = ? AND c.workspace_id = ?
       ORDER BY c.created_at DESC`,
      [id, payload.workspaceId]
    );

    return apiSuccess(campaigns);
  } catch (err: unknown) {
    if (err instanceof Error && err.message === 'UNAUTHORIZED') return apiError('Unauthorized', 401);
    return apiError('Server error', 500);
  }
}
