/**
 * POST /api/auth/meta
 * Given a Facebook user access token, return all WABAs + phone numbers
 * so the frontend can let the user pick which one to connect.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { apiError } from '@/lib/utils';

const GV = 'v20.0';

export async function POST(req: NextRequest) {
  try {
    await requireAuth(req);
    const { access_token } = await req.json();
    if (!access_token) return apiError('access_token required', 400);

    // 1. Get WABAs directly from the user token (no business_management permission needed)
    const wabaRes = await fetch(
      `https://graph.facebook.com/${GV}/me/whatsapp_business_accounts?fields=id,name,currency,timezone_id&access_token=${access_token}`
    );
    const wabaData = await wabaRes.json();
    if (wabaData.error) return apiError(`Meta: ${wabaData.error.message}`, 400);

    const wabas: { id: string; name: string; business_name: string }[] = (wabaData.data || []).map(
      (w: { id: string; name?: string }) => ({ id: w.id, name: w.name || w.id, business_name: w.name || w.id })
    );

    // 2. For each WABA, fetch phone numbers
    const wabasWithPhones = await Promise.all(
      wabas.map(async (waba) => {
        const phoneRes = await fetch(
          `https://graph.facebook.com/${GV}/${waba.id}/phone_numbers?fields=id,display_phone_number,verified_name,code_verification_status&access_token=${access_token}`
        );
        const phoneData = await phoneRes.json();
        return {
          ...waba,
          phone_numbers: (phoneData.data || []) as {
            id: string;
            display_phone_number: string;
            verified_name: string;
            code_verification_status: string;
          }[],
        };
      })
    );

    return NextResponse.json({ success: true, data: wabasWithPhones });
  } catch (err: unknown) {
    if (err instanceof Error && err.message === 'UNAUTHORIZED') return apiError('Unauthorized', 401);
    return apiError('Failed to fetch Meta data', 500);
  }
}
