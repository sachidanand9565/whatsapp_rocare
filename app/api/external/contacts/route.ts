/**
 * GET /api/external/contacts
 * Returns paginated contact list for the workspace.
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
 */
import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { RowDataPacket } from 'mysql2';

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
  const sp          = new URL(req.url).searchParams;
  const page        = Math.max(1, Number(sp.get('page')  || 1));
  const limit       = Math.min(100, Math.max(1, Number(sp.get('limit') || 50)));
  const offset      = (page - 1) * limit;
  const search      = sp.get('search')?.trim()      || '';
  const chatStatus  = sp.get('chat_status')?.trim() || '';
  const optedIn     = sp.get('opted_in');

  // ── Build WHERE clause ────────────────────────────────────────
  const conditions: string[] = ['workspace_id = ?'];
  const params: unknown[]    = [workspaceId];

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

  // ── Fetch total count + data in parallel ──────────────────────
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

  const total      = countRows[0].total as number;
  const totalPages = Math.ceil(total / limit);

  return NextResponse.json({
    contacts: contacts.map((c) => ({
      ...c,
      tags:     c.tags ? JSON.parse(c.tags as string) : [],
      opted_in: !!c.opted_in,
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
