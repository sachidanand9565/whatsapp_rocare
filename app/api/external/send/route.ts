/**
 * POST /api/external/send
 * External chatbot endpoint — no JWT needed, uses X-API-Key header.
 *
 * Headers:
 *   X-API-Key: ws_xxxxxxxxxxxxxxxxxxxx
 *
 * Body (JSON):
 *   { "phone": "919876543210", "message": "Hello from bot" }
 *   OR
 *   { "contact_id": 42, "message": "Hello from bot" }
 */
import { NextRequest, NextResponse } from 'next/server';
import { query, insert, execute } from '@/lib/db';
import { sendTextMessage } from '@/lib/whatsapp';
import { normalizePhone, utcNow } from '@/lib/utils';
import { optionsResponse } from '@/lib/cors';
import { RowDataPacket } from 'mysql2';
import { emitSSE } from '@/lib/sse';

export async function OPTIONS() {
  return optionsResponse();
}

export async function POST(req: NextRequest) {
  // ── Auth via API key ─────────────────────────────────────────
  const apiKey = req.headers.get('x-api-key') || req.headers.get('X-API-Key');
  if (!apiKey) {
    return NextResponse.json({ error: 'X-API-Key header required' }, { status: 401 });
  }

  const wsRows = await query<RowDataPacket[]>(
    'SELECT id, access_token, phone_number_id FROM workspaces WHERE api_key = ? AND is_active = 1 LIMIT 1',
    [apiKey]
  );
  if (wsRows.length === 0) {
    return NextResponse.json({ error: 'Invalid API key' }, { status: 401 });
  }

  const { id: workspaceId, access_token, phone_number_id } = wsRows[0];

  if (!access_token || !phone_number_id) {
    return NextResponse.json({ error: 'WhatsApp not configured in workspace settings' }, { status: 400 });
  }

  // ── Parse body ───────────────────────────────────────────────
  let body: { phone?: string; contact_id?: number; message?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { phone, contact_id, message } = body;

  if (!message || !message.trim()) {
    return NextResponse.json({ error: 'message is required' }, { status: 400 });
  }
  if (!phone && !contact_id) {
    return NextResponse.json({ error: 'phone or contact_id is required' }, { status: 400 });
  }

  // ── Resolve contact ──────────────────────────────────────────
  let contactId: number;
  let contactPhone: string;

  if (contact_id) {
    const rows = await query<RowDataPacket[]>(
      'SELECT id, phone FROM contacts WHERE id = ? AND workspace_id = ? LIMIT 1',
      [contact_id, workspaceId]
    );
    if (rows.length === 0) {
      return NextResponse.json({ error: 'Contact not found' }, { status: 404 });
    }
    contactId    = rows[0].id as number;
    contactPhone = normalizePhone(rows[0].phone as string);
  } else {
    const normalised = normalizePhone(phone!);
    // Auto-create contact if not exists
    await execute(
      'INSERT IGNORE INTO contacts (workspace_id, phone, source, opted_in) VALUES (?, ?, ?, 1)',
      [workspaceId, normalised, 'bot']
    );
    const rows = await query<RowDataPacket[]>(
      'SELECT id FROM contacts WHERE workspace_id = ? AND phone = ? LIMIT 1',
      [workspaceId, normalised]
    );
    contactId    = rows[0].id as number;
    contactPhone = normalised;
  }

  // ── Send via Meta WhatsApp API ────────────────────────────────
  let wamid: string | null = null;
  try {
    const result = await sendTextMessage(
      access_token as string,
      phone_number_id as string,
      contactPhone,
      message.trim()
    );
    wamid = result?.messages?.[0]?.id || null;
  } catch (err: unknown) {
    const detail = err instanceof Error ? err.message : 'WhatsApp API error';
    return NextResponse.json({ error: 'Failed to send message', detail }, { status: 502 });
  }

  // ── Save to DB ───────────────────────────────────────────────
  const now = utcNow();
  const msgId = await insert(
    `INSERT INTO messages (workspace_id, contact_id, wamid, direction, type, content, status, sent_at, created_at)
     VALUES (?, ?, ?, 'outbound', 'text', ?, 'sent', ?, ?)`,
    [workspaceId, contactId, wamid, message.trim(), now, now]
  );

  // ── Notify inbox via SSE ─────────────────────────────────────
  emitSSE({ type: 'new_message', workspaceId, contactId });

  return NextResponse.json({ success: true, message_id: msgId, wamid });
}
