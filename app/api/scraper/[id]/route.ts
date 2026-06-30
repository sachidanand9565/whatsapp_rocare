/**
 * GET    /api/scraper/[id]  — fetch single session with places JSON
 * DELETE /api/scraper/[id]  — delete session
 */
import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { query, execute } from '@/lib/db';
import { apiSuccess, apiError } from '@/lib/utils';
import { RowDataPacket } from 'mysql2';

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const payload = await requireAuth(req);
    const rows = await query<RowDataPacket[]>(
      `SELECT * FROM scraper_sessions WHERE id = ? AND workspace_id = ? LIMIT 1`,
      [params.id, payload.workspaceId]
    );
    if (rows.length === 0) return apiError('Not found', 404);
    const session = rows[0];
    if (typeof session.places === 'string') session.places = JSON.parse(session.places);
    return apiSuccess(session);
  } catch (err: unknown) {
    if (err instanceof Error && err.message === 'UNAUTHORIZED') return apiError('Unauthorized', 401);
    return apiError('Server error', 500);
  }
}

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const payload = await requireAuth(req);
    const { places } = await req.json() as { places: unknown[] };
    if (!Array.isArray(places)) return apiError('places array required');
    const phoneCount = (places as { phone?: string }[]).filter((p) => p.phone).length;
    const affected = await execute(
      `UPDATE scraper_sessions SET places = ?, total_count = ?, phone_count = ? WHERE id = ? AND workspace_id = ?`,
      [JSON.stringify(places), places.length, phoneCount, params.id, payload.workspaceId]
    );
    if (affected === 0) return apiError('Not found', 404);
    return apiSuccess({ updated: true, total_count: places.length, phone_count: phoneCount });
  } catch (err: unknown) {
    if (err instanceof Error && err.message === 'UNAUTHORIZED') return apiError('Unauthorized', 401);
    return apiError('Server error', 500);
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const payload = await requireAuth(req);
    const affected = await execute(
      `DELETE FROM scraper_sessions WHERE id = ? AND workspace_id = ?`,
      [params.id, payload.workspaceId]
    );
    if (affected === 0) return apiError('Not found', 404);
    return apiSuccess({ deleted: true });
  } catch (err: unknown) {
    if (err instanceof Error && err.message === 'UNAUTHORIZED') return apiError('Unauthorized', 401);
    return apiError('Server error', 500);
  }
}
