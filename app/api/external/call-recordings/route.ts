/**
 * GET /api/external/call-recordings?phone=919876543210
 * CRM integration — call history + playable recording links for one number.
 *
 * Headers:
 *   X-API-Key: ws_xxxxxxxxxxxxxxxxxxxx        (Settings → Webhooks & API)
 *
 * Query params:
 *   phone        (required) any format — normalized like the rest of the app
 *   only_recorded=0         also include calls without a recording (default: recorded only)
 *   limit=50                max rows, 1–200
 *   expires_in=3600         recording URL lifetime in seconds, 60–86400
 *
 * Response:
 * {
 *   "phone": "919876543210", "contact_id": 12, "contact_name": "John",
 *   "total": 2,
 *   "calls": [{
 *     "call_id": "wacid.…", "direction": "inbound", "status": "completed",
 *     "agent": "Rahul", "started_at": "2026-08-21 14:03:11",   // IST
 *     "ended_at": "…", "duration_sec": 184,
 *     "recording": { "url": "https://s3…", "mime": "audio/webm",
 *                    "seconds": 180, "bytes": 5.1e5, "expires_in": 3600 }
 *   }]
 * }
 * Recording URLs are short-lived presigned S3 links — fetch fresh ones on
 * each CRM page view instead of storing them.
 */
import { NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { normalizePhone } from '@/lib/utils';
import { corsResponse, optionsResponse } from '@/lib/cors';
import { s3Configured, presignRecording } from '@/lib/s3';
import { RowDataPacket } from 'mysql2';

export async function OPTIONS() {
  return optionsResponse();
}

// DB stores UTC — convert to IST "YYYY-MM-DD HH:MM:SS" like /api/external/contact
function toIST(ts: unknown): string | null {
  if (!ts) return null;
  const d = ts instanceof Date ? ts : new Date(String(ts).replace(' ', 'T') + 'Z');
  if (isNaN(d.getTime())) return String(ts);
  const date = d.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  const time = d.toLocaleTimeString('en-GB', { timeZone: 'Asia/Kolkata', hour12: false });
  return `${date} ${time}`;
}

export async function GET(req: NextRequest) {
  // ── Auth via API key ─────────────────────────────────────────
  const apiKey = req.headers.get('x-api-key') || req.headers.get('X-API-Key');
  if (!apiKey) return corsResponse({ error: 'X-API-Key header required' }, 401);

  const wsRows = await query<RowDataPacket[]>(
    'SELECT id FROM workspaces WHERE api_key = ? AND is_active = 1 LIMIT 1',
    [apiKey]
  );
  if (wsRows.length === 0) return corsResponse({ error: 'Invalid API key' }, 401);
  const workspaceId = wsRows[0].id as number;

  // ── Params ───────────────────────────────────────────────────
  const sp = new URL(req.url).searchParams;
  const phone = sp.get('phone');
  if (!phone) return corsResponse({ error: 'phone query param is required' }, 400);
  const normalised = normalizePhone(phone);
  if (!normalised) return corsResponse({ error: 'Invalid phone number' }, 400);

  const onlyRecorded = sp.get('only_recorded') !== '0';
  const limit        = Math.min(200, Math.max(1, Number(sp.get('limit')) || 50));
  const expiresIn    = Math.min(86400, Math.max(60, Number(sp.get('expires_in')) || 3600));

  // ── Contact lookup by phone ──────────────────────────────────
  const contactRows = await query<RowDataPacket[]>(
    'SELECT id, name FROM contacts WHERE workspace_id = ? AND phone = ? LIMIT 1',
    [workspaceId, normalised]
  );
  if (contactRows.length === 0) return corsResponse({ error: 'Contact not found for this phone' }, 404);
  const contact = contactRows[0];

  // ── Call logs (+ agent name) for this contact ────────────────
  let calls: RowDataPacket[] = [];
  try {
    calls = await query<RowDataPacket[]>(
      `SELECT cl.call_id, cl.direction, cl.status, cl.started_at, cl.answered_at,
              cl.ended_at, cl.duration_sec,
              cl.recording_key, cl.recording_mime, cl.recording_sec, cl.recording_bytes,
              u.name AS agent_name
       FROM call_logs cl
       LEFT JOIN users u ON u.id = cl.agent_id
       WHERE cl.workspace_id = ? AND cl.contact_id = ?
         ${onlyRecorded ? 'AND cl.recording_key IS NOT NULL' : ''}
       ORDER BY cl.started_at DESC, cl.id DESC
       LIMIT ${limit}`,
      [workspaceId, contact.id]
    );
  } catch (e) {
    if ((e as { code?: string })?.code === 'ER_NO_SUCH_TABLE') {
      return corsResponse({ error: 'Calling is not set up on this server (run migration-calling.sql)' }, 503);
    }
    throw e;
  }

  const anyRecording = calls.some((c) => c.recording_key);
  if (anyRecording && !s3Configured()) {
    return corsResponse({ error: 'Recording storage (S3) is not configured on the server' }, 503);
  }

  // ── Presign recording URLs (parallel — short-lived, do not cache) ──
  const out = await Promise.all(calls.map(async (c) => ({
    call_id:      c.call_id as string,
    direction:    c.direction as string,
    status:       c.status as string,
    agent:        (c.agent_name as string) || null,
    started_at:   toIST(c.started_at),
    answered_at:  toIST(c.answered_at),
    ended_at:     toIST(c.ended_at),
    duration_sec: Number(c.duration_sec) || 0,
    recording: c.recording_key ? {
      url:        await presignRecording(c.recording_key as string, expiresIn, `call-${normalised}-${String(c.call_id).slice(-8)}.${String(c.recording_mime || '').includes('ogg') ? 'ogg' : String(c.recording_mime || '').includes('m4a') || String(c.recording_mime || '').includes('mp4') ? 'm4a' : 'webm'}`),
      mime:       (c.recording_mime as string) || 'audio/webm',
      seconds:    Number(c.recording_sec) || null,
      bytes:      Number(c.recording_bytes) || null,
      expires_in: expiresIn,
    } : null,
  })));

  return corsResponse({
    phone:        normalised,
    contact_id:   contact.id,
    contact_name: (contact.name as string) || null,
    total:        out.length,
    calls:        out,
  });
}
