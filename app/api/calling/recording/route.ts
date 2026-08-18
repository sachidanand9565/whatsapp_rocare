/**
 * POST /api/calling/recording   — upload a finished call recording (multipart)
 *   fields: call_id, seconds, file (audio/webm)
 *   → stores in S3 (private), links to call_logs.recording_key
 *
 * GET  /api/calling/recording?call_id=… [&download=1]
 *   → { url } short-lived presigned URL for playback / download
 *
 * DELETE /api/calling/recording?call_id=…   (admin) — remove from S3 + DB
 */
import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { query, execute } from '@/lib/db';
import { apiSuccess, apiError } from '@/lib/utils';
import { s3Configured, recordingKey, putRecording, presignRecording, deleteRecording } from '@/lib/s3';
import { RowDataPacket } from 'mysql2';

export const maxDuration = 60;             // large uploads on slow links
const MAX_BYTES = 200 * 1024 * 1024;       // 200 MB (~18 hours at 24 kbps) — generous cap

export async function POST(req: NextRequest) {
  try {
    const payload = await requireAuth(req);
    if (!s3Configured()) return apiError('Recording storage (S3) is not configured on the server', 503);

    const form = await req.formData();
    const callId  = String(form.get('call_id') || '');
    const seconds = Number(form.get('seconds') || 0);
    const file    = form.get('file');
    if (!callId) return apiError('call_id is required', 400);
    if (!(file instanceof Blob) || file.size === 0) return apiError('file is required', 400);
    if (file.size > MAX_BYTES) return apiError('Recording too large', 413);

    // Recording must belong to a call in this workspace
    const rows = await query<RowDataPacket[]>(
      'SELECT id, recording_key FROM call_logs WHERE call_id = ? AND workspace_id = ? LIMIT 1',
      [callId, payload.workspaceId]
    );
    if (rows.length === 0) return apiError('Call not found', 404);

    const mime = file.type || 'audio/webm';
    const ext  = mime.includes('ogg') ? 'ogg' : mime.includes('mp4') || mime.includes('m4a') ? 'm4a' : 'webm';
    const key  = (rows[0].recording_key as string) || recordingKey(payload.workspaceId, callId, ext);
    const buf  = Buffer.from(await file.arrayBuffer());

    await putRecording(key, buf, mime);
    await execute(
      'UPDATE call_logs SET recording_key = ?, recording_bytes = ?, recording_mime = ?, recording_sec = ? WHERE id = ?',
      [key, buf.length, mime, Math.max(0, Math.round(seconds)), rows[0].id]
    );
    return apiSuccess({ stored: true, bytes: buf.length });
  } catch (err: unknown) {
    if (err instanceof Error && err.message === 'UNAUTHORIZED') return apiError('Unauthorized', 401);
    console.error('[calling/recording POST]', err);
    return apiError('Failed to store recording', 500);
  }
}

export async function GET(req: NextRequest) {
  try {
    const payload = await requireAuth(req);
    const callId = req.nextUrl.searchParams.get('call_id') || '';
    const download = req.nextUrl.searchParams.get('download') === '1';
    if (!callId) return apiError('call_id is required', 400);
    if (!s3Configured()) return apiError('Recording storage (S3) is not configured', 503);

    const rows = await query<RowDataPacket[]>(
      `SELECT cl.recording_key, cl.recording_mime, cl.started_at, c.phone
       FROM call_logs cl LEFT JOIN contacts c ON c.id = cl.contact_id
       WHERE cl.call_id = ? AND cl.workspace_id = ? LIMIT 1`,
      [callId, payload.workspaceId]
    );
    const key = rows[0]?.recording_key as string | undefined;
    if (!key) return apiError('No recording for this call', 404);

    const ext  = key.split('.').pop() || 'webm';
    const when = String(rows[0].started_at || '').replace(/[: ]/g, '-').slice(0, 16);
    const name = `call_${rows[0].phone || 'unknown'}_${when}.${ext}`;
    const url  = await presignRecording(key, 900, download ? name : undefined);
    return apiSuccess({ url, expires_in: 900, mime: rows[0].recording_mime || 'audio/webm' });
  } catch (err: unknown) {
    if (err instanceof Error && err.message === 'UNAUTHORIZED') return apiError('Unauthorized', 401);
    console.error('[calling/recording GET]', err);
    return apiError('Failed to fetch recording', 500);
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const payload = await requireAuth(req);
    if (payload.role !== 'admin') return apiError('Admin only', 403);
    const callId = req.nextUrl.searchParams.get('call_id') || '';
    if (!callId) return apiError('call_id is required', 400);
    const rows = await query<RowDataPacket[]>(
      'SELECT id, recording_key FROM call_logs WHERE call_id = ? AND workspace_id = ? LIMIT 1',
      [callId, payload.workspaceId]
    );
    const key = rows[0]?.recording_key as string | undefined;
    if (!key) return apiError('No recording for this call', 404);
    await deleteRecording(key).catch((e) => console.warn('[recording delete] S3:', (e as Error).message));
    await execute(
      'UPDATE call_logs SET recording_key = NULL, recording_bytes = NULL, recording_mime = NULL, recording_sec = NULL WHERE id = ?',
      [rows[0].id]
    );
    return apiSuccess({ deleted: true });
  } catch (err: unknown) {
    if (err instanceof Error && err.message === 'UNAUTHORIZED') return apiError('Unauthorized', 401);
    console.error('[calling/recording DELETE]', err);
    return apiError('Failed to delete recording', 500);
  }
}
