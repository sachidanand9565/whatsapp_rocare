/**
 * GET  /api/leads  — list leads (paginated, filterable by stage/source/search)
 * POST /api/leads  — create lead
 */
import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { query, insert } from '@/lib/db';
import { apiSuccess, apiError, getPagination, utcNow } from '@/lib/utils';
import { RowDataPacket } from 'mysql2';

export async function GET(req: NextRequest) {
  try {
    const payload = requireAuth(req);
    const sp = new URL(req.url).searchParams;
    const { limit, offset, page } = getPagination(sp, 500);
    const search = sp.get('search') || '';
    const stage  = sp.get('stage')  || '';
    const source = sp.get('source') || '';

    let sql = `
      SELECT l.*, u.name AS assigned_name
      FROM leads l
      LEFT JOIN users u ON u.id = l.assigned_to
      WHERE l.workspace_id = ?
    `;
    const params: unknown[] = [payload.workspaceId];

    if (stage)  { sql += ' AND l.stage = ?';  params.push(stage); }
    if (source) { sql += ' AND l.source = ?'; params.push(source); }
    if (search) {
      sql += ' AND (l.name LIKE ? OR l.phone LIKE ? OR l.email LIKE ?)';
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }

    const countParams = [...params];
    sql += ' ORDER BY l.created_at DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    const rows = await query<RowDataPacket[]>(sql, params);

    const [countRow] = await query<RowDataPacket[]>(
      `SELECT COUNT(*) as total FROM leads WHERE workspace_id = ?${stage ? ' AND stage = ?' : ''}`,
      stage ? [payload.workspaceId, stage] : [payload.workspaceId]
    );

    const stageCounts = await query<RowDataPacket[]>(
      `SELECT stage, COUNT(*) as cnt FROM leads WHERE workspace_id = ? GROUP BY stage`,
      [payload.workspaceId]
    );

    const sourceCounts = await query<RowDataPacket[]>(
      `SELECT source, COUNT(*) as cnt FROM leads WHERE workspace_id = ? GROUP BY source`,
      [payload.workspaceId]
    );

    const [valueRow] = await query<RowDataPacket[]>(
      `SELECT COALESCE(SUM(deal_value), 0) as total_value FROM leads WHERE workspace_id = ?`,
      [payload.workspaceId]
    );

    const dailyTrend = await query<RowDataPacket[]>(
      `SELECT DATE(created_at) as day, COUNT(*) as cnt FROM leads
       WHERE workspace_id = ? AND created_at >= DATE_SUB(CURDATE(), INTERVAL 6 DAY)
       GROUP BY DATE(created_at) ORDER BY day ASC`,
      [payload.workspaceId]
    );

    return apiSuccess({
      data: rows,
      total: countRow.total,
      page,
      stageCounts,
      sourceCounts,
      totalValue: valueRow.total_value,
      dailyTrend,
    });
  } catch (err) {
    if (err instanceof Error && err.message === 'UNAUTHORIZED') return apiError('Unauthorized', 401);
    return apiError('Server error', 500);
  }
}

export async function POST(req: NextRequest) {
  try {
    const payload = requireAuth(req);
    const { name, phone, email, source, stage, assigned_to, deal_value, notes, contact_id } = await req.json();

    if (!name && !phone) return apiError('name or phone is required', 400);

    const now = utcNow();
    const id = await insert(
      `INSERT INTO leads
         (workspace_id, contact_id, name, phone, email, source, stage, assigned_to, deal_value, notes, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        payload.workspaceId,
        contact_id   || null,
        name         || null,
        phone        || null,
        email        || null,
        source       || 'manual',
        stage        || 'new',
        assigned_to  || null,
        deal_value   || null,
        notes        || null,
        now,
        now,
      ]
    );

    await insert(
      `INSERT INTO lead_activities (lead_id, type, description, done_by, created_at) VALUES (?, ?, ?, ?, ?)`,
      [id, 'note', 'Lead created', payload.userId, now]
    );

    return apiSuccess({ id });
  } catch (err) {
    if (err instanceof Error && err.message === 'UNAUTHORIZED') return apiError('Unauthorized', 401);
    return apiError('Server error', 500);
  }
}
