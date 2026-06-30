/**
 * GET    /api/media           — list workspace media library
 * POST   /api/media           — upload file to WhatsApp + store in media_library
 * DELETE /api/media           — delete items from library by id[]
 */
import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { query, insert, execute } from '@/lib/db';
import { apiSuccess, apiError } from '@/lib/utils';
import { uploadMedia } from '@/lib/whatsapp';
import { RowDataPacket } from 'mysql2';

const ENSURE = `CREATE TABLE IF NOT EXISTS media_library (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  workspace_id INT          NOT NULL,
  media_id     VARCHAR(255) NOT NULL,
  filename     VARCHAR(255) NOT NULL,
  mime_type    VARCHAR(100) NOT NULL DEFAULT 'application/octet-stream',
  file_size    INT          NOT NULL DEFAULT 0,
  created_at   TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_ws (workspace_id, created_at)
)`;

export async function GET(req: NextRequest) {
  try {
    const payload = await requireAuth(req);
    // await query(ENSURE);

    const sp     = new URL(req.url).searchParams;
    const tab    = sp.get('tab')    || 'image';
    const search = sp.get('search') || '';

    const typeMap: Record<string, string> = {
      image: "mime_type LIKE 'image/%'",
      audio: "mime_type LIKE 'audio/%'",
      video: "mime_type LIKE 'video/%'",
      file:  "mime_type NOT LIKE 'image/%' AND mime_type NOT LIKE 'audio/%' AND mime_type NOT LIKE 'video/%'",
    };
    const typeClause   = typeMap[tab] || typeMap.image;
    const searchClause = search ? 'AND filename LIKE ?' : '';
    const searchParam  = search ? [`%${search}%`] : [];

    const items = await query<RowDataPacket[]>(
      `SELECT id, media_id, filename, mime_type, file_size, created_at
       FROM media_library
       WHERE workspace_id = ? AND ${typeClause} ${searchClause}
       ORDER BY created_at DESC LIMIT 200`,
      [payload.workspaceId, ...searchParam]
    );

    const countRow = await query<RowDataPacket[]>(
      `SELECT
        COALESCE(SUM(mime_type LIKE 'image/%'), 0)                                                                       AS images,
        COALESCE(SUM(mime_type LIKE 'audio/%'), 0)                                                                       AS audio,
        COALESCE(SUM(mime_type LIKE 'video/%'), 0)                                                                       AS video,
        COALESCE(SUM(mime_type NOT LIKE 'image/%' AND mime_type NOT LIKE 'audio/%' AND mime_type NOT LIKE 'video/%'), 0) AS files,
        COALESCE(SUM(file_size), 0)                                                                                      AS total_size
       FROM media_library WHERE workspace_id = ?`,
      [payload.workspaceId]
    );

    return apiSuccess({ items, counts: countRow[0] });
  } catch (err: unknown) {
    if (err instanceof Error && err.message === 'UNAUTHORIZED') return apiError('Unauthorized', 401);
    console.error('[media GET]', err);
    return apiError('Server error', 500);
  }
}

export async function POST(req: NextRequest) {
  try {
    const payload = await requireAuth(req);
    await query(ENSURE);

    const ws = await query<RowDataPacket[]>(
      'SELECT access_token, phone_number_id FROM workspaces WHERE id = ? AND is_active = 1',
      [payload.workspaceId]
    );
    if (ws.length === 0) return apiError('Workspace not configured', 400);
    const { access_token, phone_number_id } = ws[0];
    if (!access_token || !phone_number_id) return apiError('WhatsApp API not configured', 400);

    const form = await req.formData();
    const file = form.get('file') as File | null;
    if (!file) return apiError('No file uploaded', 400);

    const buffer   = Buffer.from(await file.arrayBuffer());
    const mimeType = file.type || 'application/octet-stream';
    const filename = file.name || 'upload';

    const mediaId = await uploadMedia(
      access_token as string,
      phone_number_id as string,
      buffer,
      mimeType,
      filename
    );

    await insert(
      `INSERT INTO media_library (workspace_id, media_id, filename, mime_type, file_size)
       VALUES (?, ?, ?, ?, ?)`,
      [payload.workspaceId, mediaId, filename, mimeType, file.size]
    );

    return apiSuccess({ mediaId, mimeType, filename, fileSize: file.size });
  } catch (err: unknown) {
    if (err instanceof Error && err.message === 'UNAUTHORIZED') return apiError('Unauthorized', 401);
    console.error('[media POST]', err);
    return apiError(err instanceof Error ? err.message : 'Upload failed', 500);
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const payload = await requireAuth(req);
    const { ids } = await req.json() as { ids: number[] };
    if (!Array.isArray(ids) || !ids.length) return apiError('No ids provided');

    const placeholders = ids.map(() => '?').join(',');
    await execute(
      `DELETE FROM media_library WHERE workspace_id = ? AND id IN (${placeholders})`,
      [payload.workspaceId, ...ids]
    );

    return apiSuccess({ deleted: ids.length });
  } catch (err: unknown) {
    if (err instanceof Error && err.message === 'UNAUTHORIZED') return apiError('Unauthorized', 401);
    return apiError('Server error', 500);
  }
}
