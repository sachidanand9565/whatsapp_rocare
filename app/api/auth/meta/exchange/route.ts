/**
 * POST /api/auth/meta/exchange
 * Exchange FB authorization code (from Embedded Signup) for a long-lived access token
 */
import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { apiSuccess, apiError } from '@/lib/utils';

export async function POST(req: NextRequest) {
  try {
    await requireAuth(req);
    const { code } = await req.json();
    if (!code) return apiError('code is required', 400);

    const appId     = process.env.NEXT_PUBLIC_FACEBOOK_APP_ID || '';
    const appSecret = process.env.FACEBOOK_APP_SECRET || '';
    if (!appId || !appSecret) return apiError('Facebook app credentials not configured', 500);

    // Embedded Signup via JS SDK — redirect_uri must NOT be included in exchange
    const tokenRes = await fetch(
      `https://graph.facebook.com/v20.0/oauth/access_token` +
      `?client_id=${appId}&client_secret=${appSecret}&code=${code}`
    );
    const tokenData = await tokenRes.json();
    if (tokenData.error) return apiError(`Meta: ${tokenData.error.message}`, 400);

    const shortToken = tokenData.access_token as string;

    // Extend to long-lived token (60 days)
    const extendRes = await fetch(
      `https://graph.facebook.com/v20.0/oauth/access_token` +
      `?grant_type=fb_exchange_token&client_id=${appId}&client_secret=${appSecret}&fb_exchange_token=${shortToken}`
    );
    const extendData = await extendRes.json();
    const finalToken = extendData.access_token || shortToken;

    return apiSuccess({ access_token: finalToken });
  } catch (err) {
    if (err instanceof Error && err.message === 'UNAUTHORIZED') return apiError('Unauthorized', 401);
    return apiError('Token exchange failed', 500);
  }
}
