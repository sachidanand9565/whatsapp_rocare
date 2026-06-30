/**
 * GET  /api/contacts  — list contacts (paginated, filterable)
 * POST /api/contacts  — create contact
 */
import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { query, insert } from '@/lib/db';
import { apiSuccess, apiError, getPagination, normalizePhone } from '@/lib/utils';
import { RowDataPacket } from 'mysql2';

export async function GET(req: NextRequest) {
  try {
    const payload = await requireAuth(req);
    const sp      = new URL(req.url).searchParams;
    const { limit, offset, page } = getPagination(sp, 500);
    const search     = sp.get('search') || '';
    const status     = sp.get('status') || '';
    const chatStatus = sp.get('chatStatus') || '';

    // Agents see:
    //  - If NO campaigns assigned → all inbox contacts (unassigned or assigned to them)
    //  - If campaigns assigned → only their campaign contacts + directly assigned contacts
    const agentFilterMain  = payload.role === 'agent'
      ? `AND (
           c.assigned_agent_id = ${payload.userId}
           OR (
             c.assigned_agent_id IS NULL
             AND (
               NOT EXISTS (
                 SELECT 1 FROM campaign_assignments WHERE agent_id = ${payload.userId} LIMIT 1
               )
               OR c.id IN (
                 SELECT cc.contact_id FROM campaign_contacts cc
                 JOIN campaign_assignments ca ON ca.campaign_id = cc.campaign_id
                 WHERE ca.agent_id = ${payload.userId}
               )
             )
           )
         )`
      : '';
    const agentFilterCount = payload.role === 'agent'
      ? `AND (
           assigned_agent_id = ${payload.userId}
           OR (
             assigned_agent_id IS NULL
             AND (
               NOT EXISTS (
                 SELECT 1 FROM campaign_assignments WHERE agent_id = ${payload.userId} LIMIT 1
               )
               OR id IN (
                 SELECT cc.contact_id FROM campaign_contacts cc
                 JOIN campaign_assignments ca ON ca.campaign_id = cc.campaign_id
                 WHERE ca.agent_id = ${payload.userId}
               )
             )
           )
         )`
      : '';

    let sql    = `
      SELECT c.*,
        (SELECT u.name FROM users u WHERE u.id = c.assigned_agent_id LIMIT 1) AS assigned_agent_name,
        (SELECT COUNT(*) FROM messages m
         WHERE m.contact_id = c.id AND m.direction = 'inbound'
           AND m.created_at > COALESCE(c.last_read_at, '2000-01-01 00:00:00')
        ) AS unread_count,
        (SELECT COUNT(*) FROM messages mi
         WHERE mi.contact_id = c.id AND mi.direction = 'inbound'
        ) AS inbound_count,
        c.last_message_at AS last_message_at
      FROM contacts c WHERE c.workspace_id = ? ${agentFilterMain}`;
    let countSql = `SELECT COUNT(*) as total FROM contacts WHERE workspace_id = ? ${agentFilterCount}`;
    const params: unknown[] = [payload.workspaceId];

    if (search) {
      sql       += ' AND (c.name LIKE ? OR c.phone LIKE ? OR c.email LIKE ?)';
      countSql  += ' AND (name LIKE ? OR phone LIKE ? OR email LIKE ?)';
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }
    if (status) {
      sql      += ' AND c.status = ?';
      countSql += ' AND status = ?';
      params.push(status);
    }
    if (chatStatus === 'resolved') {
      sql      += " AND c.chat_status = 'resolved'";
      countSql += " AND chat_status = 'resolved'";
    } else if (chatStatus === 'active') {
      sql      += " AND (c.chat_status IS NULL OR c.chat_status != 'resolved')";
      countSql += " AND (chat_status IS NULL OR chat_status != 'resolved')";
    } else if (chatStatus === 'inbox') {
      // Only contacts with an INBOUND message within 24h appear in inbox (uses denormalized
      // last_inbound_at — indexed, no per-row subquery). Outbound-only contacts stay in History.
      sql += ` AND c.last_inbound_at > DATE_SUB(NOW(), INTERVAL 24 HOUR)
        AND (c.assigned_agent_id IS NULL OR c.assigned_agent_id = ${payload.userId})`;
      countSql += ` AND last_inbound_at > DATE_SUB(NOW(), INTERVAL 24 HOUR)
        AND (assigned_agent_id IS NULL OR assigned_agent_id = ${payload.userId})`;
    } else if (chatStatus === 'intervened') {
      sql      += " AND c.chat_status = 'intervened'";
      countSql += " AND chat_status = 'intervened'";
      // Agents must only see chats explicitly transferred TO them (not the general unassigned pool)
      if (payload.role === 'agent') {
        sql      += ` AND c.assigned_agent_id = ${payload.userId}`;
        countSql += ` AND assigned_agent_id = ${payload.userId}`;
      }
    } else if (chatStatus === 'history') {
      // No inbound message in last 24h (exact inverse of inbox) — uses denormalized column
      sql += ` AND (c.last_inbound_at IS NULL OR c.last_inbound_at <= DATE_SUB(NOW(), INTERVAL 24 HOUR))`;
      countSql += ` AND (last_inbound_at IS NULL OR last_inbound_at <= DATE_SUB(NOW(), INTERVAL 24 HOUR))`;
    }

    // Date filter — chat ki LAST message date is range me ho (History date filter)
    const dateFrom = sp.get('dateFrom') || '';
    const dateTo   = sp.get('dateTo')   || '';
    if (dateFrom) {
      sql      += ' AND c.last_message_at >= ?';
      countSql += ' AND last_message_at >= ?';
      params.push(`${dateFrom} 00:00:00`);
    }
    if (dateTo) {
      sql      += ' AND c.last_message_at <= ?';
      countSql += ' AND last_message_at <= ?';
      params.push(`${dateTo} 23:59:59`);
    }

    const campaignId = sp.get('campaignId') || '';
    if (campaignId) {
      const cid = Number(campaignId);
      sql      += ` AND c.id IN (
        SELECT contact_id FROM campaign_contacts WHERE campaign_id = ?
        UNION
        SELECT contact_id FROM messages WHERE campaign_id = ? AND direction = 'outbound'
      )`;
      countSql += ` AND id IN (
        SELECT contact_id FROM campaign_contacts WHERE campaign_id = ?
        UNION
        SELECT contact_id FROM messages WHERE campaign_id = ? AND direction = 'outbound'
      )`;
      params.push(cid, cid);
    }

    sql += ' ORDER BY last_message_at DESC, c.created_at DESC LIMIT ? OFFSET ?';
    const listParams  = [...params, limit, offset];
    const countParams = params;

    const [contacts, countResult] = await Promise.all([
      query<RowDataPacket[]>(sql, listParams),
      query<RowDataPacket[]>(countSql, countParams),
    ]);

    const total = (countResult[0] as RowDataPacket).total as number;

    return apiSuccess({
      data:       contacts,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    });
  } catch (err: unknown) {
    if (err instanceof Error && err.message === 'UNAUTHORIZED') return apiError('Unauthorized', 401);
    console.error('[contacts GET]', err);
    return apiError('Server error', 500);
  }
}

export async function POST(req: NextRequest) {
  try {
    const payload = await requireAuth(req);
    const { name, phone, email, city, source, status, tags, notes } = await req.json();

    if (!phone) return apiError('Phone number is required');
    const normalizedPhone = normalizePhone(phone);

    // Check duplicate
    const existing = await query<RowDataPacket[]>(
      'SELECT id FROM contacts WHERE workspace_id = ? AND phone = ?',
      [payload.workspaceId, normalizedPhone]
    );
    if (existing.length > 0) return apiError('Contact with this phone already exists', 409);

    const id = await insert(
      `INSERT INTO contacts (workspace_id, name, phone, email, city, source, status, tags, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        payload.workspaceId,
        name || null, normalizedPhone,
        email || null, city || null, source || 'manual',
        status || 'new',
        JSON.stringify(tags || []),
        notes || null,
      ]
    );

    return apiSuccess({ id }, 201);
  } catch (err: unknown) {
    if (err instanceof Error && err.message === 'UNAUTHORIZED') return apiError('Unauthorized', 401);
    console.error('[contacts POST]', err);
    return apiError('Server error', 500);
  }
}
