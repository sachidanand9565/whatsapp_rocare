/**
 * POST /api/external/typing
 * External chatbot endpoint — show a "typing…" indicator to a customer while the
 * bot prepares its reply. No JWT; uses X-API-Key header.
 *
 * Headers:
 *   X-API-Key: ws_xxxxxxxxxxxxxxxxxxxx
 *
 * Body (JSON) — one of:
 *   { "message_id": "wamid.HBg..." }   // wamid of the customer's incoming message (preferred)
 *   { "phone": "919876543210" }        // resolve the contact's latest inbound message
 *   { "contact_id": 42 }
 *
 * Typing shows for ~25s or until the next message is sent. Best-effort — if the
 * message is too old / already read, WhatsApp may ignore it.
 */
import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { sendTypingIndicator } from '@/lib/whatsapp';
import { normalizePhone } from '@/lib/utils';
import { optionsResponse } from '@/lib/cors';
import { RowDataPacket } from 'mysql2';

export async function OPTIONS() {
  return optionsResponse();
}

export async function POST(req: NextRequest) {
  // ── Auth via API key ─────────────────────────────────────────
  const apiKey = req.headers.get('x-api-key') || req.headers.get('X-API-Key');
  if (!apiKey) return NextResponse.json({ error: 'X-API-Key header required' }, { status: 401 });

  const wsRows = await query<RowDataPacket[]>(
    'SELECT id, access_token, phone_number_id FROM workspaces WHERE api_key = ? AND is_active = 1 LIMIT 1',
    [apiKey]
  );
  if (wsRows.length === 0) return NextResponse.json({ error: 'Invalid API key' }, { status: 401 });

  const { id: workspaceId, access_token, phone_number_id } = wsRows[0];
  if (!access_token || !phone_number_id) {
    return NextResponse.json({ error: 'WhatsApp not configured in workspace settings' }, { status: 400 });
  }

  // ── Parse body ───────────────────────────────────────────────
  let body: { message_id?: string; phone?: string; contact_id?: number };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }); }

  let wamid = (body.message_id || '').trim();

  // If no message_id given, resolve the contact's latest inbound message wamid
  if (!wamid) {
    if (!body.phone && !body.contact_id) {
      return NextResponse.json({ error: 'message_id, phone or contact_id is required' }, { status: 400 });
    }
    let contactId = body.contact_id;
    if (!contactId && body.phone) {
      const c = await query<RowDataPacket[]>(
        'SELECT id FROM contacts WHERE workspace_id = ? AND phone = ? LIMIT 1',
        [workspaceId, normalizePhone(body.phone)]
      );
      contactId = c[0]?.id as number | undefined;
    }
    if (!contactId) return NextResponse.json({ error: 'Contact not found' }, { status: 404 });

    const m = await query<RowDataPacket[]>(
      `SELECT wamid FROM messages
       WHERE workspace_id = ? AND contact_id = ? AND direction = 'inbound' AND wamid IS NOT NULL
       ORDER BY id DESC LIMIT 1`,
      [workspaceId, contactId]
    );
    wamid = (m[0]?.wamid as string) || '';
    if (!wamid) return NextResponse.json({ error: 'No incoming message found for this contact' }, { status: 404 });
  }

  // ── Send typing indicator ────────────────────────────────────
  try {
    await sendTypingIndicator(access_token as string, phone_number_id as string, wamid);
  } catch (err: unknown) {
    const detail = err instanceof Error ? err.message : 'WhatsApp API error';
    return NextResponse.json({ error: 'Failed to send typing indicator', detail }, { status: 502 });
  }

  return NextResponse.json({ success: true });
}
