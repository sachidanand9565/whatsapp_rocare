/**
 * GET /api/external/contact?phone=919876543210
 * Returns full contact profile + all chat messages.
 *
 * Headers:
 *   X-API-Key: ws_xxxxxxxxxxxxxxxxxxxx
 */
import { NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { normalizePhone } from '@/lib/utils';
import { corsResponse, optionsResponse } from '@/lib/cors';
import { RowDataPacket } from 'mysql2';

export async function OPTIONS() {
  return optionsResponse();
}

export async function GET(req: NextRequest) {
  // ── Auth via API key ─────────────────────────────────────────
  const apiKey = req.headers.get('x-api-key') || req.headers.get('X-API-Key');
  if (!apiKey) {
    return corsResponse({ error: 'X-API-Key header required' }, 401);
  }

  const wsRows = await query<RowDataPacket[]>(
    'SELECT id FROM workspaces WHERE api_key = ? AND is_active = 1 LIMIT 1',
    [apiKey]
  );
  if (wsRows.length === 0) {
    return corsResponse({ error: 'Invalid API key' }, 401);
  }
  const workspaceId = wsRows[0].id as number;

  // ── Validate input ───────────────────────────────────────────
  const phone = new URL(req.url).searchParams.get('phone');
  if (!phone) {
    return corsResponse({ error: 'phone query param is required' }, 400);
  }
  const normalised = normalizePhone(phone);

  // ── Fetch contact ────────────────────────────────────────────
  const contactRows = await query<RowDataPacket[]>(
    'SELECT * FROM contacts WHERE workspace_id = ? AND phone = ? LIMIT 1',
    [workspaceId, normalised]
  );
  if (contactRows.length === 0) {
    return corsResponse({ error: 'Contact not found' }, 404);
  }
  const contact = contactRows[0];

  // ── Fetch all messages ───────────────────────────────────────
  const rows = await query<RowDataPacket[]>(
    `SELECT id, wamid, direction, type, content, status,
            sent_at, delivered_at, read_at, created_at
     FROM messages
     WHERE workspace_id = ? AND contact_id = ?
     ORDER BY COALESCE(created_at, sent_at) ASC, id ASC`,
    [workspaceId, contact.id]
  );

  // Media messages: expose top-level media fields + a ready download link
  // (media_url) — same shape as the message.received webhook payload, so
  // callers don't have to parse the content JSON and build URLs themselves.
  const fwdProto = req.headers.get('x-forwarded-proto') || 'https';
  const fwdHost  = req.headers.get('x-forwarded-host') || req.headers.get('host') || '';
  const baseUrl  = fwdHost ? `${fwdProto}://${fwdHost}` : '';

  const messages = rows.map((m) => {
    try {
      const p = JSON.parse(m.content as string);
      if (p?.__type === 'media' && p.media_id) {
        return {
          ...m,
          media_id:  String(p.media_id),
          mime_type: p.mime_type || null,
          ...(p.caption  ? { caption:  p.caption }  : {}),
          ...(p.filename ? { filename: p.filename } : {}),
          ...(baseUrl
            ? { media_url: `${baseUrl}/api/media/${p.media_id}?workspaceId=${workspaceId}&key=${apiKey}` }
            : {}),
        };
      }
    } catch { /* not JSON content — plain text message */ }
    return m;
  });

  return corsResponse({
    contact: {
      id:          contact.id,
      phone:       contact.phone,
      name:        contact.name        || null,
      email:       contact.email       || null,
      city:        contact.city        || null,
      source:      contact.source      || null,
      status:      contact.status      || null,
      tags:        contact.tags        ? JSON.parse(contact.tags as string) : [],
      notes:       contact.notes       || null,
      opted_in:    !!contact.opted_in,
      chat_status: contact.chat_status || 'open',
      created_at:  contact.created_at,
    },
    messages,
    total_messages: messages.length,
  });
}
