/**
 * GET /api/workspace/status
 * Real-time WhatsApp number health from Meta: quality_rating,
 * messaging_limit_tier, display_phone_number, verified_name AND the actual
 * connection state — a banned/restricted/flagged number must never be shown
 * as LIVE just because credentials sit in the DB.
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

/** What the dashboard badge shows. `live` is the only healthy sending state. */
type WaState =
  | 'not_connected' | 'live' | 'flagged' | 'restricted' | 'banned'
  | 'disconnected' | 'pending' | 'token_error' | 'unknown';

const STATE_LABEL: Record<WaState, string> = {
  not_connected: 'NOT CONNECTED',
  live:          'LIVE',
  flagged:       'FLAGGED',
  restricted:    'RESTRICTED',
  banned:        'BANNED',
  disconnected:  'DISCONNECTED',
  pending:       'PENDING REVIEW',
  token_error:   'TOKEN EXPIRED',
  unknown:       'UNKNOWN',
};

/** Meta phone-number `status` / WABA `status` → our state */
function mapMetaStatus(raw: string): WaState | null {
  switch (raw) {
    case 'CONNECTED':
    case 'ACTIVE':        return 'live';
    case 'FLAGGED':       return 'flagged';
    case 'RESTRICTED':
    case 'RATE_LIMITED':  return 'restricted';
    case 'BANNED':
    case 'DISABLED':      return 'banned';
    case 'DISCONNECTED':
    case 'MIGRATED':
    case 'DELETED':       return 'disconnected';
    case 'PENDING':
    case 'UNVERIFIED':    return 'pending';
    default:              return null;
  }
}

/** Worst state wins — a live number under a restricted WABA cannot send. */
const SEVERITY: WaState[] = [
  'live', 'pending', 'flagged', 'restricted', 'disconnected', 'token_error', 'banned', 'unknown',
];
function worse(a: WaState, b: WaState): WaState {
  return SEVERITY.indexOf(b) > SEVERITY.indexOf(a) ? b : a;
}

export async function GET(req: NextRequest) {
  try {
    const payload = await requireAuth(req);

    const rows = await query<RowDataPacket[]>(
      'SELECT phone_number_id, access_token, waba_id FROM workspaces WHERE id = ? LIMIT 1',
      [payload.workspaceId]
    );

    if (!rows.length) return apiError('Workspace not found', 404);

    const { phone_number_id, access_token, waba_id } = rows[0] as {
      phone_number_id: string | null;
      access_token: string | null;
      waba_id: string | null;
    };

    if (!phone_number_id || !access_token) {
      return NextResponse.json({
        success: true,
        data: { connected: false, state: 'not_connected', state_label: STATE_LABEL.not_connected },
      });
    }

    const metaRes = await fetch(
      `https://graph.facebook.com/v20.0/${phone_number_id}` +
      `?fields=status,quality_rating,messaging_limit_tier,display_phone_number,verified_name,name_status` +
      `&access_token=${access_token}`
    );
    const meta = await metaRes.json();

    if (meta.error) {
      // 190/102 = token expired or revoked; 131031 = account banned by Meta
      const code  = Number(meta.error.code);
      const state: WaState =
        code === 190 || code === 102 ? 'token_error' :
        code === 131031              ? 'banned'      : 'unknown';
      return NextResponse.json({
        success: true,
        data: {
          connected:    false,
          state,
          state_label:  STATE_LABEL[state],
          state_reason: meta.error.message,
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
    const phoneRaw   = (meta.status as string || '').toUpperCase();

    let state: WaState = mapMetaStatus(phoneRaw) || 'live';
    let reason = '';
    if (phoneRaw && !mapMetaStatus(phoneRaw)) reason = `Meta reports number status: ${phoneRaw}`;

    // The WABA can be restricted/banned while the number itself still reads
    // CONNECTED — check it too, but never fail the whole call over it.
    let wabaRaw = '';
    let reviewStatus = '';
    if (waba_id) {
      try {
        const wabaRes = await fetch(
          `https://graph.facebook.com/v20.0/${waba_id}` +
          `?fields=status,account_review_status&access_token=${access_token}`
        );
        const waba = await wabaRes.json();
        if (!waba?.error) {
          wabaRaw      = (waba.status as string || '').toUpperCase();
          reviewStatus = (waba.account_review_status as string || '').toUpperCase();
          const wabaState = mapMetaStatus(wabaRaw);
          if (wabaState && wabaState !== 'live') {
            state  = worse(state, wabaState);
            reason = `WhatsApp Business Account is ${wabaRaw}`;
          }
        }
      } catch { /* WABA check is best-effort */ }
    }

    if (state === 'restricted' && !reason) reason = 'Messaging is limited by Meta right now';
    if (state === 'flagged'    && !reason) reason = 'Quality rating dropped — Meta has flagged this number';

    return NextResponse.json({
      success: true,
      data: {
        connected:     state === 'live' || state === 'flagged',
        state,
        state_label:   STATE_LABEL[state],
        state_reason:  reason || null,
        phone_number:  meta.display_phone_number || phone_number_id,
        verified_name: meta.verified_name || null,
        name_status:   meta.name_status   || null,
        quality:       QUALITY_MAP[qualityRaw] || { label: qualityRaw, color: 'gray' },
        quota:         TIER_MAP[tierRaw] || (tierRaw ? tierRaw.replace(/_/g, ' ') : null),
        name_declined: meta.name_status === 'DECLINED',
        raw: {
          quality_rating:        qualityRaw,
          messaging_limit_tier:  tierRaw,
          phone_status:          phoneRaw || null,
          waba_status:           wabaRaw || null,
          account_review_status: reviewStatus || null,
        },
      },
    });
  } catch (err) {
    if (err instanceof Error && err.message === 'UNAUTHORIZED') return apiError('Unauthorized', 401);
    return apiError('Server error', 500);
  }
}
