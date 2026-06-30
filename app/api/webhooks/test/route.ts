/**
 * POST /api/webhooks/test — Send a test event to a given URL
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { apiError } from '@/lib/utils';

export async function POST(req: NextRequest) {
  try {
    await requireAuth(req);
    const { url, secret } = await req.json();

    if (!url || !url.startsWith('http')) return apiError('Invalid URL', 400);

    const payload = {
      event: 'test',
      description: 'Test event from WhatsApp CRM',
      contact: { id: 0, phone: '919999999999' },
      message: {
        wamid: 'wamid.test_event_' + Date.now(),
        type: 'text',
        content: 'Hello! This is a test message.',
        timestamp: String(Math.floor(Date.now() / 1000)),
        replied_to_wamid: null,
      },
    };

    const body = JSON.stringify(payload);
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };

    if (secret) {
      const crypto = require('crypto') as typeof import('crypto');
      const sig = crypto.createHmac('sha256', secret).update(body).digest('hex');
      headers['X-Webhook-Signature'] = `sha256=${sig}`;
    }

    const res = await fetch(url, { method: 'POST', headers, body, signal: AbortSignal.timeout(8000) });

    return NextResponse.json({ success: true, status: res.status, statusText: res.statusText });
  } catch (err: unknown) {
    if (err instanceof Error && err.message === 'UNAUTHORIZED') return apiError('Unauthorized', 401);
    return apiError(err instanceof Error ? err.message : 'Failed', 500);
  }
}
