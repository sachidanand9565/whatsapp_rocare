/**
 * POST /api/campaigns/[id]/test
 * Send a single test message for a broadcast/drip campaign.
 * Body: { phone: "919876543210", vars: { "1": "John", "2": "Delhi" } }
 */
import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { query } from '@/lib/db';
import { apiSuccess, apiError, normalizePhone } from '@/lib/utils';
import { sendTemplateMessage } from '@/lib/whatsapp';
import { RowDataPacket } from 'mysql2';

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const payload    = requireAuth(req);
    const campaignId = Number(params.id);
    const body       = await req.json() as { phone?: string; vars?: Record<string, string>; headerMedia?: string };

    if (!body.phone) return apiError('phone is required', 400);
    const phone = normalizePhone(body.phone);
    if (!phone) return apiError('Invalid phone number', 400);

    const camps = await query<RowDataPacket[]>(
      `SELECT c.template_vars, t.name as tname, t.language,
              t.body_text, t.header_type, t.header_content, t.footer_text, t.buttons,
              w.access_token, w.phone_number_id
       FROM campaigns c
       JOIN templates t ON t.id = c.template_id
       JOIN workspaces w ON w.id = c.workspace_id
       WHERE c.id = ? AND c.workspace_id = ?`,
      [campaignId, payload.workspaceId]
    );
    if (camps.length === 0) return apiError('Campaign not found', 404);
    const camp = camps[0];

    if (!camp.access_token || !camp.phone_number_id) {
      return apiError('WhatsApp API not configured', 400);
    }

    // Merge campaign default vars with user-supplied overrides
    const defaultVars = parseJson<Record<string, string>>(camp.template_vars as string, {});
    const testVars    = { ...defaultVars, ...(body.vars || {}) };

    const components: object[] = [];

    // Header media — test-time override (upload/URL) ko prefer karo, warna campaign ka saved media
    const headerType    = (camp.header_type as string || '').toUpperCase();
    const overrideMedia = (body.headerMedia || '').trim();
    const headerContent = overrideMedia || ((camp.header_content as string) || '');
    if (['IMAGE', 'DOCUMENT', 'VIDEO'].includes(headerType) && headerContent) {
      const mediaType = headerType.toLowerCase() as 'image' | 'document' | 'video';
      const isUrl = headerContent.startsWith('http');
      components.push({
        type: 'header',
        parameters: [{ type: mediaType, [mediaType]: isUrl ? { link: headerContent } : { id: headerContent } }],
      });
    }

    // Body variables
    const sortedKeys = Object.keys(testVars).sort((a, b) => Number(a) - Number(b));
    if (sortedKeys.length > 0) {
      components.push({
        type: 'body',
        parameters: sortedKeys.map((k) => ({ type: 'text', text: testVars[k] })),
      });
    }

    await sendTemplateMessage(
      camp.access_token as string,
      camp.phone_number_id as string,
      phone,
      camp.tname as string,
      (camp.language as string) || 'en',
      components
    );

    return apiSuccess({ sent: true, phone });
  } catch (err: unknown) {
    if (err instanceof Error && err.message === 'UNAUTHORIZED') return apiError('Unauthorized', 401);
    console.error('[campaign/test]', err);
    return apiError(err instanceof Error ? err.message : 'Failed to send test', 500);
  }
}

function parseJson<T>(val: unknown, fallback: T): T {
  if (!val) return fallback;
  if (typeof val === 'object') return val as T;
  try { return JSON.parse(val as string) as T; } catch { return fallback; }
}
