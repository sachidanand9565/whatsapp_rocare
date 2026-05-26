/**
 * GET /api/external/contacts
 * Returns paginated contact list with their chat messages.
 * Only returns contacts created after 2026-05-07.
 *
 * Headers:
 *   X-API-Key: ws_xxxxxxxxxxxxxxxxxxxx
 *
 * Query params (all optional):
 *   page        - page number (default: 1)
 *   limit       - results per page, max 100 (default: 50)
 *   search      - search by name or phone
 *   chat_status - filter by open | resolved | intervened
 *   opted_in    - filter by 1 or 0
 *   after       - custom date filter e.g. 2026-05-07 (default: 2026-05-07)
 */
import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { RowDataPacket } from 'mysql2';

const DEFAULT_AFTER = '2026-05-07';

export async function GET(req: NextRequest) {
  // ── Auth ─────────────────────────────────────────────────────
  const apiKey = req.headers.get('x-api-key') || req.headers.get('X-API-Key');
  if (!apiKey) {
    return NextResponse.json({ error: 'X-API-Key header required' }, { status: 401 });
  }

  const wsRows = await query<RowDataPacket[]>(
    'SELECT id FROM workspaces WHERE api_key = ? AND is_active = 1 LIMIT 1',
    [apiKey]
  );
  if (wsRows.length === 0) {
    return NextResponse.json({ error: 'Invalid API key' }, { status: 401 });
  }
  const workspaceId = wsRows[0].id as number;

  // ── Query params ─────────────────────────────────────────────
  const sp         = new URL(req.url).searchParams;
  const page       = Math.max(1, Number(sp.get('page')  || 1));
  const limit      = Math.min(100, Math.max(1, Number(sp.get('limit') || 50)));
  const offset     = (page - 1) * limit;
  const search     = sp.get('search')?.trim()      || '';
  const chatStatus = sp.get('chat_status')?.trim() || '';
  const optedIn    = sp.get('opted_in');
  const after      = sp.get('after')?.trim()       || DEFAULT_AFTER;

  // ── Build WHERE clause ────────────────────────────────────────
  const conditions: string[] = ['workspace_id = ?', 'created_at >= ?'];
  const params: unknown[]    = [workspaceId, `${after} 00:00:00`];

  if (search) {
    conditions.push('(name LIKE ? OR phone LIKE ?)');
    params.push(`%${search}%`, `%${search}%`);
  }
  if (chatStatus) {
    conditions.push('chat_status = ?');
    params.push(chatStatus);
  }
  if (optedIn !== null && optedIn !== '') {
    conditions.push('opted_in = ?');
    params.push(optedIn === '1' ? 1 : 0);
  }

  const where = conditions.join(' AND ');

  // ── Fetch total count + contacts ──────────────────────────────
  const [countRows, contacts] = await Promise.all([
    query<RowDataPacket[]>(
      `SELECT COUNT(*) as total FROM contacts WHERE ${where}`,
      params
    ),
    query<RowDataPacket[]>(
      `SELECT id, phone, name, email, city, source, status, tags, notes,
              opted_in, chat_status, created_at
       FROM contacts
       WHERE ${where}
       ORDER BY created_at DESC
       LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    ),
  ]);

  if (contacts.length === 0) {
    return NextResponse.json({
      contacts: [],
      pagination: {
        page, limit,
        total:       0,
        total_pages: 0,
        has_next:    false,
        has_prev:    page > 1,
      },
    });
  }

  // ── Fetch messages for all contacts in one query ──────────────
  const contactIds = contacts.map((c) => c.id as number);
  const placeholders = contactIds.map(() => '?').join(',');

  const messages = await query<RowDataPacket[]>(
    `SELECT id, contact_id, wamid, direction, type, content,
            status, sent_at, delivered_at, read_at, created_at
     FROM messages
     WHERE workspace_id = ? AND contact_id IN (${placeholders})
     ORDER BY contact_id ASC, COALESCE(created_at, sent_at) ASC, id ASC`,
    [workspaceId, ...contactIds]
  );

  // ── Group messages by contact_id ─────────────────────────────
  const msgMap: Record<number, RowDataPacket[]> = {};
  for (const msg of messages) {
    const cid = msg.contact_id as number;
    if (!msgMap[cid]) msgMap[cid] = [];
    msgMap[cid].push(msg);
  }

  const total      = countRows[0].total as number;
  const totalPages = Math.ceil(total / limit);

  return NextResponse.json({
    contacts: contacts.map((c) => ({
      id:          c.id,
      phone:       c.phone,
      name:        c.name        || null,
      email:       c.email       || null,
      city:        c.city        || null,
      source:      c.source      || null,
      status:      c.status      || null,
      tags:        c.tags ? JSON.parse(c.tags as string) : [],
      notes:       c.notes       || null,
      opted_in:    !!c.opted_in,
      chat_status: c.chat_status || 'open',
      created_at:  c.created_at,
      messages:    msgMap[c.id as number] || [],
      total_messages: (msgMap[c.id as number] || []).length,
    })),
    pagination: {
      page,
      limit,
      total,
      total_pages: totalPages,
      has_next:    page < totalPages,
      has_prev:    page > 1,
    },
  });
}
