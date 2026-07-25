/**
 * GET /api/media/[mediaId]?workspaceId=X
 * Proxy Meta media files to avoid CORS issues in the browser.
 */
import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { requireAuth } from '@/lib/auth';
import { RowDataPacket } from 'mysql2';

export const maxDuration = 30; // Vercel: allow up to 30s for two-hop Meta fetch

const MAX_MEDIA_BYTES = 100 * 1024 * 1024; // WhatsApp's own max media size (video/document)

export async function GET(
  req: NextRequest,
  { params }: { params: { mediaId: string } }
) {
  const { mediaId } = params;
  const workspaceId = req.nextUrl.searchParams.get('workspaceId');

  if (!mediaId || !workspaceId) {
    return new NextResponse('Bad Request', { status: 400 });
  }

  // Media belongs to a specific tenant's WhatsApp account — require the caller
  // to be authenticated for that exact workspace, otherwise workspaceId+mediaId
  // could be enumerated to pull another tenant's media via their access token.
  // Two auth modes: logged-in JWT (browser/inbox) or workspace API key via ?key=
  // (media_url links forwarded to customer webhooks — no browser session there).
  const wsKey = req.nextUrl.searchParams.get('key');
  if (wsKey?.startsWith('ws_')) {
    const keyRows = await query<RowDataPacket[]>(
      'SELECT id FROM workspaces WHERE api_key = ? AND is_active = 1 LIMIT 1',
      [wsKey]
    );
    if (keyRows.length === 0 || Number(keyRows[0].id) !== Number(workspaceId)) {
      return new NextResponse('Forbidden', { status: 403 });
    }
  } else {
    let payload;
    try { payload = await requireAuth(req); } catch { return new NextResponse('Unauthorized', { status: 401 }); }
    if (payload.workspaceId !== Number(workspaceId)) {
      return new NextResponse('Forbidden', { status: 403 });
    }
  }

  // Get workspace access token
  const rows = await query<RowDataPacket[]>(
    'SELECT access_token FROM workspaces WHERE id = ? AND is_active = 1 LIMIT 1',
    [workspaceId]
  );
  if (rows.length === 0) {
    return new NextResponse('Workspace not found', { status: 404 });
  }

  const accessToken = rows[0].access_token as string;
  const API_VERSION = 'v23.0';

  // Step 1: Get media download URL from Meta
  let metaData: { url?: string; mime_type?: string };
  try {
    const metaRes = await fetch(
      `https://graph.facebook.com/${API_VERSION}/${mediaId}`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    const body = await metaRes.json() as { url?: string; mime_type?: string; error?: { message: string } };
    if (!metaRes.ok) {
      console.error('[media] Meta info failed:', metaRes.status, body?.error?.message);
      return new NextResponse('Failed to get media info', { status: 502 });
    }
    metaData = body;
  } catch (err) {
    console.error('[media] Meta info fetch error:', err);
    return new NextResponse('Failed to get media info', { status: 502 });
  }

  if (!metaData.url) {
    console.error('[media] No URL in Meta response for mediaId:', mediaId);
    return new NextResponse('No media URL', { status: 502 });
  }

  // Step 2: Download the actual file from Meta CDN
  let buffer: ArrayBuffer;
  let contentType: string;
  try {
    const fileRes = await fetch(metaData.url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!fileRes.ok) {
      console.error('[media] CDN download failed:', fileRes.status);
      return new NextResponse('Failed to download media', { status: 502 });
    }
    const declaredLength = Number(fileRes.headers.get('content-length') || 0);
    if (declaredLength > MAX_MEDIA_BYTES) {
      return new NextResponse('Media too large', { status: 413 });
    }
    contentType = metaData.mime_type || fileRes.headers.get('content-type') || 'application/octet-stream';
    buffer = await fileRes.arrayBuffer();
  } catch (err) {
    console.error('[media] CDN fetch error:', err);
    return new NextResponse('Failed to download media', { status: 502 });
  }

  return new NextResponse(buffer, {
    status: 200,
    headers: {
      'Content-Type': contentType,
      'Cache-Control': 'public, max-age=86400',
    },
  });
}
