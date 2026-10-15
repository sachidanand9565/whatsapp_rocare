/**
 * GET  /api/workspace/wa-profile — the WhatsApp Business profile as Meta has it
 * POST /api/workspace/wa-profile — update it (about, description, address,
 *      email, websites, vertical). The picture has its own /photo route.
 *
 * This is the public profile customers see in the chat header — not the panel
 * user's own account profile (/api/profile).
 */
import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { query } from '@/lib/db';
import { apiSuccess, apiError } from '@/lib/utils';
import { RowDataPacket } from 'mysql2';

const GRAPH  = 'https://graph.facebook.com/v20.0';
const FIELDS = 'about,address,description,email,profile_picture_url,websites,vertical';

// Meta's business categories — anything else is rejected
const VERTICALS = [
  'UNDEFINED', 'OTHER', 'AUTO', 'BEAUTY', 'APPAREL', 'EDU', 'ENTERTAIN', 'EVENT_PLAN',
  'FINANCE', 'GROCERY', 'GOVT', 'HOTEL', 'HEALTH', 'NONPROFIT', 'PROF_SERVICES',
  'RETAIL', 'TRAVEL', 'RESTAURANT', 'NOT_A_BIZ',
];

// Meta's own length caps — sending more fails the whole update
const LIMITS = { about: 139, description: 512, address: 256, email: 128, website: 256 };

async function credentials(workspaceId: number) {
  const rows = await query<RowDataPacket[]>(
    'SELECT phone_number_id, access_token FROM workspaces WHERE id = ? LIMIT 1',
    [workspaceId]
  );
  const phoneId = (rows[0]?.phone_number_id as string) || '';
  const token   = (rows[0]?.access_token    as string) || '';
  return { phoneId, token };
}

export async function GET(req: NextRequest) {
  try {
    const payload = await requireAuth(req);
    const { phoneId, token } = await credentials(payload.workspaceId);
    if (!phoneId || !token) return apiError('WhatsApp number not connected — finish setup in Auth & WhatsApp', 400);

    const res  = await fetch(`${GRAPH}/${phoneId}/whatsapp_business_profile?fields=${FIELDS}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const json = await res.json();
    if (!res.ok || json?.error) {
      return apiError(`Meta: ${json?.error?.message || `HTTP ${res.status}`}`, 400);
    }

    const profile = json?.data?.[0] || {};
    return apiSuccess({
      about:               profile.about               || '',
      address:             profile.address             || '',
      description:         profile.description         || '',
      email:               profile.email               || '',
      vertical:            profile.vertical            || 'UNDEFINED',
      websites:            profile.websites            || [],
      profile_picture_url: profile.profile_picture_url || '',
      verticals:           VERTICALS,
    });
  } catch (err) {
    if (err instanceof Error && err.message === 'UNAUTHORIZED') return apiError('Unauthorized', 401);
    console.error('[wa-profile GET]', err);
    return apiError('Server error', 500);
  }
}

export async function POST(req: NextRequest) {
  try {
    const payload = await requireAuth(req);
    const { phoneId, token } = await credentials(payload.workspaceId);
    if (!phoneId || !token) return apiError('WhatsApp number not connected — finish setup in Auth & WhatsApp', 400);

    const body = await req.json().catch(() => ({}));

    const about       = String(body.about       ?? '').trim();
    const description = String(body.description ?? '').trim();
    const address     = String(body.address     ?? '').trim();
    const email       = String(body.email       ?? '').trim();
    const vertical    = String(body.vertical    ?? '').trim().toUpperCase();
    const websites    = (Array.isArray(body.websites) ? body.websites : [])
      .map((w: unknown) => String(w || '').trim())
      .filter(Boolean)
      .slice(0, 2);                                   // Meta accepts at most 2

    if (about.length       > LIMITS.about)       return apiError(`About must be ${LIMITS.about} characters or less`);
    if (description.length > LIMITS.description) return apiError(`Description must be ${LIMITS.description} characters or less`);
    if (address.length     > LIMITS.address)     return apiError(`Address must be ${LIMITS.address} characters or less`);
    if (email.length       > LIMITS.email)       return apiError(`Email must be ${LIMITS.email} characters or less`);
    if (email && !email.includes('@'))           return apiError('Enter a valid email address');
    if (vertical && !VERTICALS.includes(vertical)) return apiError('Pick a business category from the list');
    for (const w of websites) {
      if (!/^https?:\/\//i.test(w))  return apiError(`Website must start with http:// or https:// — "${w}"`);
      if (w.length > LIMITS.website) return apiError(`Website URL must be ${LIMITS.website} characters or less`);
    }

    // Meta clears a field when it is sent empty, which is what the form intends
    const update: Record<string, unknown> = {
      messaging_product: 'whatsapp',
      about, description, address, email, websites,
    };
    if (vertical) update.vertical = vertical;

    const res  = await fetch(`${GRAPH}/${phoneId}/whatsapp_business_profile`, {
      method:  'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body:    JSON.stringify(update),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || json?.error) {
      return apiError(`Meta: ${json?.error?.error_user_msg || json?.error?.message || `HTTP ${res.status}`}`, 400);
    }

    return apiSuccess({ updated: true });
  } catch (err) {
    if (err instanceof Error && err.message === 'UNAUTHORIZED') return apiError('Unauthorized', 401);
    console.error('[wa-profile POST]', err);
    return apiError('Server error', 500);
  }
}
