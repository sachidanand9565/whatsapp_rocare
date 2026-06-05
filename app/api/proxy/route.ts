/**
 * POST /api/proxy
 * Server-side proxy — forwards requests to external APIs (avoids browser CORS).
 * Body: { url, method, headers, body }
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';

export async function POST(req: NextRequest) {
  try {
    requireAuth(req);

    const { url, method = 'GET', headers: extraHeaders = {}, body } = await req.json();

    if (!url) {
      return NextResponse.json({ error: 'url is required' }, { status: 400 });
    }

    const fetchHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
      ...extraHeaders,
    };

    const fetchOptions: RequestInit = {
      method,
      headers: fetchHeaders,
    };

    if (method !== 'GET' && body) {
      fetchOptions.body = typeof body === 'string' ? body : JSON.stringify(body);
    }

    const res      = await fetch(url, fetchOptions);
    const rawText  = await res.text();

    let data: unknown;
    try { data = JSON.parse(rawText); } catch { data = rawText; }

    return NextResponse.json({
      ok:     res.ok,
      status: res.status,
      data,
    });

  } catch (err) {
    if (err instanceof Error && err.message === 'UNAUTHORIZED') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const msg = err instanceof Error ? err.message : 'Proxy error';
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
