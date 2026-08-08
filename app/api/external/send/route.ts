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
import {
  sendTextMessage, sendButtonMessage, sendListMessage,
  sendMediaMessage, sendMediaUrlMessage, sendTemplateMessage, sendCtaUrlMessage,
} from '@/lib/whatsapp';
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
  let body: {
    phone?: string; contact_id?: number; type?: string;
    message?: string; header?: string; footer?: string;
    buttons?: { id?: string; title?: string }[];
    button_text?: string;
    button?: { text?: string; url?: string };
    sections?: { title?: string; rows?: { id?: string; title?: string; description?: string }[] }[];
    media?: { type?: string; url?: string; id?: string; caption?: string; filename?: string };
    template?: { name?: string; language?: string; params?: string[]; header_type?: string; header_media?: string };
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { phone, contact_id, message, header, footer } = body;

  // Buttons (max 3, title required) — WhatsApp interactive button limit
  const buttons = (Array.isArray(body.buttons) ? body.buttons : [])
    .filter((b) => b && (b.title || '').trim())
    .slice(0, 3)
    .map((b, i) => ({ id: (b.id || `btn_${i + 1}`).toString(), title: (b.title || '').toString().slice(0, 20) }));

  // Single CTA URL button — WhatsApp allows only one, distinct from reply buttons
  const ctaButton = (body.button && body.button.url && body.button.url.trim())
    ? { text: (body.button.text || 'Open').toString().slice(0, 20), url: body.button.url.toString().trim() }
    : null;

  // List sections (max 10 rows total) — WhatsApp list limit
  let rowCount = 0;
  const sections = (Array.isArray(body.sections) ? body.sections : [])
    .map((s) => ({
      title: (s.title || '').toString().slice(0, 24),
      rows: (Array.isArray(s.rows) ? s.rows : [])
        .filter((r) => r && (r.title || '').trim() && rowCount < 10 && ++rowCount)
        .map((r, i) => ({
          id:    (r.id || `row_${i + 1}`).toString(),
          title: (r.title || '').toString().slice(0, 24),
          ...(r.description ? { description: r.description.toString().slice(0, 72) } : {}),
        })),
    }))
    .filter((s) => s.rows.length > 0);

  const media    = body.media || {};
  const template = body.template || {};

  // Message type — explicit `type` warna auto-detect
  const type = (body.type || '').toLowerCase()
    || (template.name ? 'template'
      : (media.url || media.id) ? 'media'
      : sections.length ? 'list'
      : ctaButton ? 'cta_url'
      : buttons.length ? 'buttons'
      : 'text');

  if (!phone && !contact_id) {
    return NextResponse.json({ error: 'phone or contact_id is required' }, { status: 400 });
  }
  // Per-type required fields
  if (['text', 'buttons', 'list', 'cta_url'].includes(type) && (!message || !message.trim())) {
    return NextResponse.json({ error: 'message is required' }, { status: 400 });
  }
  if (type === 'list' && sections.length === 0) {
    return NextResponse.json({ error: 'sections with rows are required for a list message' }, { status: 400 });
  }
  if (type === 'cta_url' && !ctaButton) {
    return NextResponse.json({ error: 'button.url is required for a cta_url message' }, { status: 400 });
  }
  if (type === 'media' && !media.url && !media.id) {
    return NextResponse.json({ error: 'media.url or media.id is required for a media message' }, { status: 400 });
  }
  if (type === 'template' && !template.name) {
    return NextResponse.json({ error: 'template.name is required for a template message' }, { status: 400 });
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

  const at  = access_token as string;
  const pn  = phone_number_id as string;
  const bodyText = (message || '').trim();
  const hdr = header?.trim() || undefined;
  const ftr = footer?.trim() || undefined;

  // ── Send via Meta WhatsApp API (by type) ─────────────────────
  let wamid: string | null = null;
  let dbType = 'text';
  let storedContent: string = bodyText;
  try {
    let result: { messages?: { id: string }[] } | undefined;

    if (type === 'buttons') {
      result = await sendButtonMessage(at, pn, contactPhone, bodyText, buttons, hdr, ftr);
      dbType = 'interactive';
      storedContent = JSON.stringify({ __type: 'buttons', body: bodyText, buttons, header: hdr || '', footer: ftr || '' });

    } else if (type === 'cta_url') {
      result = await sendCtaUrlMessage(at, pn, contactPhone, bodyText, ctaButton!.text, ctaButton!.url, hdr, ftr);
      dbType = 'interactive';
      storedContent = JSON.stringify({ __type: 'cta_url', body: bodyText, button: ctaButton, header: hdr || '', footer: ftr || '' });

    } else if (type === 'list') {
      const btnText = (body.button_text || 'Select').toString().slice(0, 20);
      result = await sendListMessage(at, pn, contactPhone, bodyText, btnText, sections, hdr, ftr);
      dbType = 'interactive';
      storedContent = JSON.stringify({ __type: 'list', body: bodyText, button: btnText, sections, header: hdr || '', footer: ftr || '' });

    } else if (type === 'media') {
      const mt = (['image', 'video', 'document', 'audio'].includes((media.type || '').toLowerCase())
        ? media.type!.toLowerCase() : 'image') as 'image' | 'video' | 'document' | 'audio';
      result = media.id
        ? await sendMediaMessage(at, pn, contactPhone, mt, media.id, media.caption, media.filename)
        : await sendMediaUrlMessage(at, pn, contactPhone, mt, media.url!, media.caption, media.filename);
      dbType = mt;
      storedContent = JSON.stringify({ __type: 'media', media_id: media.id || undefined, media_url: media.url || undefined, mime_type: mt, caption: media.caption || '', filename: media.filename || '', workspace_id: workspaceId });

    } else if (type === 'template') {
      const components: object[] = [];
      const ht = (template.header_type || '').toUpperCase();
      if (template.header_media && ['IMAGE', 'VIDEO', 'DOCUMENT'].includes(ht)) {
        const m = ht.toLowerCase();
        const isUrl = template.header_media.startsWith('http');
        components.push({ type: 'header', parameters: [{ type: m, [m]: isUrl ? { link: template.header_media } : { id: template.header_media } }] });
      }
      if (Array.isArray(template.params) && template.params.length > 0) {
        components.push({ type: 'body', parameters: template.params.map((p) => ({ type: 'text', text: String(p) })) });
      }
      result = await sendTemplateMessage(at, pn, contactPhone, template.name!, template.language || 'en', components);
      dbType = 'template';
      storedContent = JSON.stringify({ __type: 'template', template_name: template.name, body: bodyText || `[Template: ${template.name}]` });

    } else {
      result = await sendTextMessage(at, pn, contactPhone, bodyText);
      dbType = 'text';
      storedContent = bodyText;
    }

    wamid = result?.messages?.[0]?.id || null;
  } catch (err: unknown) {
    // Surface Meta's real error (code + message), not axios's generic
    // "Request failed with status code 400" — callers need to distinguish
    // "24h window closed" (131047) from bad params, invalid number, etc.
    const axiosErr = err as { response?: { data?: { error?: { code?: number; message?: string; error_data?: { details?: string } } } } };
    const metaErr  = axiosErr?.response?.data?.error;
    const detail   = metaErr?.message
      ? `Meta: ${metaErr.message}${metaErr.error_data?.details ? ` — ${metaErr.error_data.details}` : ''}`
      : (err instanceof Error ? err.message : 'WhatsApp API error');
    return NextResponse.json({
      error: 'Failed to send message',
      detail,
      ...(metaErr?.code ? { meta_code: metaErr.code } : {}),
      ...(metaErr?.code === 131047
        ? { window_closed: true, hint: '24h customer service window is closed — send an approved template first (type: "template"), then free-form messages work once the customer replies.' }
        : {}),
    }, { status: 502 });
  }

  // ── Save to DB ───────────────────────────────────────────────
  const now = utcNow();
  const msgId = await insert(
    `INSERT INTO messages (workspace_id, contact_id, wamid, direction, type, content, status, sent_at, created_at)
     VALUES (?, ?, ?, 'outbound', ?, ?, 'sent', ?, ?)`,
    [workspaceId, contactId, wamid, dbType, storedContent, now, now]
  );

  // Denormalized last-activity for fast inbox ordering
  await execute('UPDATE contacts SET last_message_at = ? WHERE id = ?', [now, contactId]).catch(() => {});

  // ── Notify inbox via SSE ─────────────────────────────────────
  emitSSE({ type: 'new_message', workspaceId, contactId });

  return NextResponse.json({ success: true, message_id: msgId, wamid });
}
