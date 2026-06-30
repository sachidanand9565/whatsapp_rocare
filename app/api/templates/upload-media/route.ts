/**
 * POST /api/templates/upload-media
 * Uploads a PDF to Meta's Resumable Upload API and returns a handle
 * for use in DOCUMENT header templates.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { query } from '@/lib/db';
import { apiError } from '@/lib/utils';
import { RowDataPacket } from 'mysql2';
import axios from 'axios';

export async function POST(req: NextRequest) {
  try {
    const payload = await requireAuth(req);

    const ws = await query<RowDataPacket[]>(
      'SELECT access_token FROM workspaces WHERE id = ?',
      [payload.workspaceId]
    );
    const accessToken = ((ws[0] as RowDataPacket)?.access_token as string)
      || process.env.WHATSAPP_ACCESS_TOKEN || '';

    if (!accessToken) return apiError('WhatsApp credentials not configured', 400);

    const formData = await req.formData();
    const file = formData.get('file') as File | null;
    if (!file) return apiError('No file provided', 400);

    const ALLOWED: Record<string, number> = {
      'application/pdf': 10,
      'image/jpeg':       5,
      'image/png':        5,
      'video/mp4':       16,
    };
    const maxMB = ALLOWED[file.type];
    if (!maxMB) return apiError(`Unsupported file type: ${file.type}. Allowed: PDF, JPG, PNG, MP4`, 400);
    if (file.size > maxMB * 1024 * 1024) return apiError(`File must be under ${maxMB} MB`, 400);

    const fileBytes = Buffer.from(await file.arrayBuffer());

    // ── Step 1: Get app_id from access token ──────────────────
    let appId: string;
    try {
      const appRes = await axios.get('https://graph.facebook.com/v20.0/app', {
        params: { access_token: accessToken },
      });
      appId = (appRes.data as { id: string }).id;
    } catch (err) {
      const detail = axios.isAxiosError(err)
        ? JSON.stringify(err.response?.data)
        : String(err);
      console.error('[upload-media] get app_id failed:', detail);
      return apiError(`Could not retrieve Meta App ID — check your access token. (${detail})`, 400);
    }

    // ── Step 2: Create upload session ─────────────────────────
    let sessionId: string;
    try {
      const sessionRes = await axios.post(
        `https://graph.facebook.com/v20.0/${appId}/uploads`,
        null,
        {
          params: {
            file_length: fileBytes.length,
            file_type: file.type,
            access_token: accessToken,
          },
          timeout: 30000,
        }
      );
      sessionId = (sessionRes.data as { id: string }).id;
    } catch (err) {
      const detail = axios.isAxiosError(err)
        ? (err.code === 'ECONNABORTED' ? 'Request timed out' : JSON.stringify(err.response?.data))
        : String(err);
      console.error('[upload-media] create session failed:', detail);
      return apiError(`Meta upload session failed: ${detail}`, 400);
    }

    // ── Step 3: Upload file bytes ──────────────────────────────
    let handle: string;
    try {
      const uploadRes = await axios.post(
        `https://graph.facebook.com/v20.0/${sessionId}`,
        fileBytes,
        {
          headers: {
            Authorization: `OAuth ${accessToken}`,
            'Content-Type': file.type,
            file_offset: '0',
          },
          maxBodyLength: Infinity,
          maxContentLength: Infinity,
          timeout: 60000,
        }
      );
      handle = (uploadRes.data as { h: string }).h;
    } catch (err) {
      const detail = axios.isAxiosError(err)
        ? (err.code === 'ECONNABORTED' ? 'Request timed out — file may be too large or connection too slow' : JSON.stringify(err.response?.data))
        : String(err);
      console.error('[upload-media] file upload failed:', detail);
      return apiError(`Meta file upload failed: ${detail}`, 400);
    }

    return NextResponse.json({ success: true, data: { handle } });

  } catch (err: unknown) {
    if (err instanceof Error && err.message === 'UNAUTHORIZED') return apiError('Unauthorized', 401);
    console.error('[upload-media POST]', err);
    return apiError('Server error', 500);
  }
}
