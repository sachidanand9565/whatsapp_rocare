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
    const search     = sp.get('search')     || '';
    const stage      = sp.get('stage')      || '';
    const source     = sp.get('source')     || '';
    const dateFrom   = sp.get('dateFrom')   || '';
    const dateTo     = sp.get('dateTo')     || '';
    const campaignId = sp.get('campaignId') || '';
    const assignedTo = sp.get('assignedTo') || '';

    let sql = `
      SELECT l.*, u.name AS assigned_name
      FROM leads l
      LEFT JOIN users u ON u.id = l.assigned_to
      ${campaignId ? 'JOIN campaign_contacts cc ON cc.contact_id = l.contact_id AND cc.campaign_id = ?' : ''}
      WHERE l.workspace_id = ?
    `;
    const params: unknown[] = [];
    if (campaignId) params.push(Number(campaignId));
    params.push(payload.workspaceId);

    if (stage)      { sql += ' AND l.stage = ?';  params.push(stage); }
    if (source)     { sql += ' AND l.source = ?'; params.push(source); }
    if (assignedTo) { sql += ' AND l.assigned_to = ?'; params.push(Number(assignedTo)); }
    if (dateFrom)   { sql += ' AND l.created_at >= ?'; params.push(`${dateFrom} 00:00:00`); }
    if (dateTo)     { sql += ' AND l.created_at <= ?'; params.push(`${dateTo} 23:59:59`); }
    if (search) {
      sql += ' AND (l.name LIKE ? OR l.phone LIKE ? OR l.email LIKE ?)';
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }

    sql += ' ORDER BY l.created_at DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    const rows = await query<RowDataPacket[]>(sql, params);

    let countSql = `SELECT COUNT(*) as total FROM leads l
      ${campaignId ? 'JOIN campaign_contacts cc ON cc.contact_id = l.contact_id AND cc.campaign_id = ?' : ''}
      WHERE l.workspace_id = ?`;
    const countParams: unknown[] = [];
    if (campaignId) countParams.push(Number(campaignId));
    countParams.push(payload.workspaceId);
    if (stage)      { countSql += ' AND l.stage = ?';  countParams.push(stage); }
    if (source)     { countSql += ' AND l.source = ?'; countParams.push(source); }
    if (assignedTo) { countSql += ' AND l.assigned_to = ?'; countParams.push(Number(assignedTo)); }
    if (dateFrom)   { countSql += ' AND l.created_at >= ?'; countParams.push(`${dateFrom} 00:00:00`); }
    if (dateTo)     { countSql += ' AND l.created_at <= ?'; countParams.push(`${dateTo} 23:59:59`); }
    if (search) {
      countSql += ' AND (l.name LIKE ? OR l.phone LIKE ? OR l.email LIKE ?)';
      countParams.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }
    const [countRow] = await query<RowDataPacket[]>(countSql, countParams);

    let campaignReplies: number | null = null;
    if (campaignId) {
      const [replyRow] = await query<RowDataPacket[]>(
        `SELECT COUNT(*) as replies
         FROM messages m
         JOIN campaign_contacts cc ON cc.contact_id = m.contact_id AND cc.campaign_id = ?
         WHERE m.direction = 'inbound' AND m.created_at > cc.sent_at`,
        [Number(campaignId)]
      );
      campaignReplies = Number(replyRow.replies || 0);
    }

    // Shared filter fragment (date range + campaign), applied to the dashboard aggregates
    // so the analytics cards reflect whatever date/campaign filter is active.
    let filterSql = `${campaignId ? 'JOIN campaign_contacts cc ON cc.contact_id = l.contact_id AND cc.campaign_id = ?' : ''} WHERE l.workspace_id = ?`;
    const filterParams: unknown[] = [];
    if (campaignId) filterParams.push(Number(campaignId));
    filterParams.push(payload.workspaceId);
    if (dateFrom) { filterSql += ' AND l.created_at >= ?'; filterParams.push(`${dateFrom} 00:00:00`); }
    if (dateTo)   { filterSql += ' AND l.created_at <= ?'; filterParams.push(`${dateTo} 23:59:59`); }

    const stageCounts = await query<RowDataPacket[]>(
      `SELECT l.stage, COUNT(*) as cnt FROM leads l ${filterSql} GROUP BY l.stage`,
      filterParams
    );

    const sourceCounts = await query<RowDataPacket[]>(
      `SELECT l.source, COUNT(*) as cnt FROM leads l ${filterSql} GROUP BY l.source`,
      filterParams
    );

    const [valueRow] = await query<RowDataPacket[]>(
      `SELECT COALESCE(SUM(l.deal_value), 0) as total_value FROM leads l ${filterSql}`,
      filterParams
    );

    const dailyTrend = await query<RowDataPacket[]>(
      `SELECT DATE(l.created_at) as day, COUNT(*) as cnt FROM leads l
       ${filterSql} AND l.created_at >= DATE_SUB(CURDATE(), INTERVAL 6 DAY)
       GROUP BY DATE(l.created_at) ORDER BY day ASC`,
      filterParams
    );

    return apiSuccess({
      data: rows,
      total: countRow.total,
      page,
      stageCounts,
      sourceCounts,
      totalValue: valueRow.total_value,
      dailyTrend,
      campaignReplies,
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
