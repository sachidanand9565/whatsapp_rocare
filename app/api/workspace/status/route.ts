/**
 * GET /api/workspace/status
 * Fetches real-time WhatsApp phone number status from Meta API:
 * quality_rating, messaging_limit_tier, display_phone_number, verified_name
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { query } from '@/lib/db';
import { apiError } from '@/lib/utils';
import { RowDataPacket } from 'mysql2';

const QUALITY_MAP: Record<string, { label: string; color: string }> = {
  GREEN:  { label: 'High',   color: 'green'  },
  YELLOW: { label: 'Medium', color: 'yellow' },
  RED:    { label: 'Low',    color: 'red'    },
  NA:     { label: 'N/A',    color: 'gray'   },
};

const TIER_MAP: Record<string, string> = {
  TIER_50:        '50 / day',
  TIER_250:       '250 / day',
  TIER_1K:        '1,000 / day',
  TIER_10K:       '10,000 / day',
  TIER_100K:      '100,000 / day',
  TIER_UNLIMITED: 'Unlimited',
  UNLIMITED:      'Unlimited',       // some accounts return this
  '50':           '50 / day',
  '250':          '250 / day',
  '1000':         '1,000 / day',
  '10000':        '10,000 / day',
  '100000':       '100,000 / day',
};

export async function GET(req: NextRequest) {
  try {
    const payload = await requireAuth(req);

    const rows = await query<RowDataPacket[]>(
      'SELECT phone_number_id, access_token FROM workspaces WHERE id = ? LIMIT 1',
      [payload.workspaceId]
    );

    if (!rows.length) return apiError('Workspace not found', 404);

    const { phone_number_id, access_token } = rows[0] as {
      phone_number_id: string | null;
      access_token: string | null;
    };

    if (!phone_number_id || !access_token) {
      return NextResponse.json({
        success: true,
        data: { connected: false },
      });
    }

    const metaRes = await fetch(
      `https://graph.facebook.com/v20.0/${phone_number_id}` +
      `?fields=quality_rating,messaging_limit_tier,display_phone_number,verified_name,name_status` +
      `&access_token=${access_token}`
    );
    const meta = await metaRes.json();

    if (meta.error) {
      return NextResponse.json({
        success: true,
        data: {
          connected:    true,
          api_error:    meta.error.message,
          quality:      { label: 'N/A', color: 'gray' },
          quota:        'Unknown',
          phone_number: phone_number_id,
          verified_name: null,
        },
      });
    }

    const qualityRaw = (meta.quality_rating as string || 'NA').toUpperCase();
    const tierRaw    = (meta.messaging_limit_tier as string || '').toUpperCase();

    return NextResponse.json({
      success: true,
      data: {
        connected:     true,
        phone_number:  meta.display_phone_number || phone_number_id,
        verified_name: meta.verified_name || null,
        name_status:   meta.name_status   || null,
        quality:       QUALITY_MAP[qualityRaw] || { label: qualityRaw, color: 'gray' },
        quota:         TIER_MAP[tierRaw] || (tierRaw ? tierRaw.replace(/_/g, ' ') : null),
        name_declined: meta.name_status === 'DECLINED',
        raw: {
          quality_rating:        qualityRaw,
          messaging_limit_tier:  tierRaw,
        },
      },
    });
  } catch (err) {
    if (err instanceof Error && err.message === 'UNAUTHORIZED') return apiError('Unauthorized', 401);
    return apiError('Server error', 500);
  }
}
