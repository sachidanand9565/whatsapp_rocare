/**
 * POST /api/templates/upload-media
 * Uploads a header file (PDF / JPG / PNG / MP4) to Meta's Resumable Upload API
 * and returns the handle a template header needs.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { query } from '@/lib/db';
import { apiError } from '@/lib/utils';
import { uploadResumable, MetaUploadError } from '@/lib/metaUpload';
import { RowDataPacket } from 'mysql2';

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

    const handle = await uploadResumable(accessToken, Buffer.from(await file.arrayBuffer()), file.type);

    return NextResponse.json({ success: true, data: { handle } });

  } catch (err: unknown) {
    if (err instanceof Error && err.message === 'UNAUTHORIZED') return apiError('Unauthorized', 401);
    if (err instanceof MetaUploadError) return apiError(err.message, 400);
    console.error('[upload-media POST]', err);
    return apiError('Server error', 500);
  }
}
