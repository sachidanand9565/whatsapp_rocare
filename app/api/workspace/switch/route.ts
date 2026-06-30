/**
 * POST /api/workspace/switch
 * Body: { workspaceId: number }
 * Verifies user has access → issues new JWT with that workspaceId
 */
import { NextRequest } from 'next/server';
import { requireAuth, signToken } from '@/lib/auth';
import { query } from '@/lib/db';
import { apiSuccess, apiError } from '@/lib/utils';
import { RowDataPacket } from 'mysql2';

export async function POST(req: NextRequest) {
  try {
    const payload = await requireAuth(req);
    const { workspaceId } = await req.json();
    if (!workspaceId) return apiError('workspaceId is required');

    // Verify user is a member of the requested workspace
    const rows = await query<RowDataPacket[]>(
      'SELECT role FROM workspace_members WHERE workspace_id = ? AND user_id = ? LIMIT 1',
      [workspaceId, payload.userId]
    );
    if (rows.length === 0) return apiError('Access denied', 403);

    const role = rows[0].role as string;
    const newToken = signToken({
      userId:      payload.userId,
      email:       payload.email,
      role,
      workspaceId: Number(workspaceId),
    });

    const response = apiSuccess({ token: newToken, workspaceId: Number(workspaceId), role });
    response.cookies.set('token', newToken, {
      httpOnly: true,
      secure:   process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge:   60 * 60 * 24 * 7,
      path:     '/',
    });
    return response;
  } catch (err) {
    if (err instanceof Error && err.message === 'UNAUTHORIZED') return apiError('Unauthorized', 401);
    return apiError('Server error', 500);
  }
}
