/**
 * GET  /api/scraper  — list all sessions for this workspace
 * POST /api/scraper  — save a new scrape session
 */
import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { query, insert } from '@/lib/db';
import { apiSuccess, apiError } from '@/lib/utils';
import { RowDataPacket } from 'mysql2';

export async function GET(req: NextRequest) {
  try {
    const payload = requireAuth(req);
    const rows = await query<RowDataPacket[]>(
      `SELECT id, city, category, total_count, phone_count, created_at
       FROM scraper_sessions
       WHERE workspace_id = ?
       ORDER BY created_at DESC`,
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
    const payload = requireAuth(req);
    const { city, category, places } = await req.json() as {
      city:     string;
      category: string;
      places:   unknown[];
    };
    if (!city || !category || !Array.isArray(places)) return apiError('city, category, places required');

    const phoneCount = (places as { phone?: string }[]).filter((p) => p.phone).length;

    const id = await insert(
      `INSERT INTO scraper_sessions (workspace_id, city, category, places, total_count, phone_count)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [payload.workspaceId, city.trim(), category.trim(), JSON.stringify(places), places.length, phoneCount]
    );
    return apiSuccess({ id, city, category, total_count: places.length, phone_count: phoneCount }, 201);
  } catch (err: unknown) {
    if (err instanceof Error && err.message === 'UNAUTHORIZED') return apiError('Unauthorized', 401);
    return apiError('Server error', 500);
  }
}
