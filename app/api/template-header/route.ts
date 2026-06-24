/**
 * GET /api/template-header?url=<encoded media url>&workspaceId=X
 * Proxies a WhatsApp/Meta-hosted template header image/video through our
 * server (with the workspace's access token) so the browser can render it —
 * Meta CDN URLs require an Authorization header and can't be hot-linked directly.
 */
import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { RowDataPacket } from 'mysql2';

export const maxDuration = 30;

export async function GET(req: NextRequest) {
  const url         = req.nextUrl.searchParams.get('url');
  const workspaceId = req.nextUrl.searchParams.get('workspaceId');

  if (!url || !workspaceId || !/^https?:\/\//i.test(url)) {
    return new NextResponse('Bad Request', { status: 400 });
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
