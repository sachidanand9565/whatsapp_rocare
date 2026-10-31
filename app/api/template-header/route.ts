/**
 * GET /api/template-header?url=<encoded media url>&workspaceId=X
 * Proxies a WhatsApp/Meta-hosted template header image/video through our
 * server (with the workspace's access token) so the browser can render it —
 * Meta CDN URLs require an Authorization header and can't be hot-linked directly.
 */
import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { requireAuth, getMemberRole } from '@/lib/auth';
import { RowDataPacket } from 'mysql2';

export const maxDuration = 30;
const MAX_MEDIA_BYTES = 100 * 1024 * 1024; // WhatsApp's own max media size (video/document)

export async function GET(req: NextRequest) {
  const url         = req.nextUrl.searchParams.get('url');
  const workspaceId = req.nextUrl.searchParams.get('workspaceId');

  if (!url || !workspaceId || !/^https?:\/\//i.test(url)) {
    return new NextResponse('Bad Request', { status: 400 });
  }

  // Require the caller to be authenticated for the exact workspace whose access
  // token we're about to use — otherwise workspaceId is a free IDOR lever.
  let payload;
  try { payload = await requireAuth(req); } catch { return new NextResponse('Unauthorized', { status: 401 }); }
  // Combined inbox: <img> header nahi bhej sakta, to dusre member project ka media bhi allow
  if (payload.workspaceId !== Number(workspaceId) && !(await getMemberRole(payload.userId, Number(workspaceId)))) {
    return new NextResponse('Forbidden', { status: 403 });
  }

  const rows = await query<RowDataPacket[]>(
    'SELECT access_token FROM workspaces WHERE id = ? AND is_active = 1 LIMIT 1',
    [workspaceId]
  );
  if (rows.length === 0) {
    return new NextResponse('Workspace not found', { status: 404 });
  }
  const accessToken = rows[0].access_token as string;

  try {
    const fileRes = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!fileRes.ok) {
      console.error('[template-header] fetch failed:', fileRes.status, url);
      return new NextResponse('Failed to fetch media', { status: 502 });
    }
    const declaredLength = Number(fileRes.headers.get('content-length') || 0);
    if (declaredLength > MAX_MEDIA_BYTES) {
      return new NextResponse('Media too large', { status: 413 });
    }
    const contentType = fileRes.headers.get('content-type') || 'application/octet-stream';
    const buffer = await fileRes.arrayBuffer();
    return new NextResponse(buffer, {
      status: 200,
      headers: { 'Content-Type': contentType, 'Cache-Control': 'public, max-age=86400' },
    });
  } catch (err) {
    console.error('[template-header] fetch error:', err);
    return new NextResponse('Failed to fetch media', { status: 502 });
  }
}
