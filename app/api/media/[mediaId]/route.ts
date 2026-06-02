/**
 * GET /api/media/[mediaId]?workspaceId=X
 * Proxy Meta media files to avoid CORS issues in the browser.
 */
import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { RowDataPacket } from 'mysql2';

export const maxDuration = 30; // Vercel: allow up to 30s for two-hop Meta fetch

export async function GET(
  req: NextRequest,
  { params }: { params: { mediaId: string } }
) {
  const { mediaId } = params;
  const workspaceId = req.nextUrl.searchParams.get('workspaceId');

  if (!mediaId || !workspaceId) {
    return new NextResponse('Bad Request', { status: 400 });
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
