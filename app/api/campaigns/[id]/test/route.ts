/**
 * POST /api/campaigns/[id]/test
 * Send a single test message for a broadcast/drip campaign.
 * Body: { phone: "919876543210", vars?: { "1": "John" }, headerMedia?: "<media-id or url>" }
 *
 * Uses the SAME buildComponents as the campaign-process cron, so the test
 * exercises exactly the payload the real broadcast will send — including the
 * campaign's saved _header_media override. On Meta rejection the exact reason
 * is returned so the campaign can be fixed before processing the audience.
 */
import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { query } from '@/lib/db';
import { apiSuccess, apiError, normalizePhone } from '@/lib/utils';
import { sendTemplateMessage } from '@/lib/whatsapp';
import { buildComponents, parseJson } from '@/lib/campaignComponents';
import { RowDataPacket } from 'mysql2';

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const payload    = await requireAuth(req);
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

    // Test-time header media override (upload/URL from the test modal) takes
    // priority over the campaign's saved _header_media.
    if (body.headerMedia?.trim()) {
      const tplVars = parseJson<Record<string, string>>(camp.template_vars as string, {});
      tplVars._header_media = body.headerMedia.trim();
      camp.template_vars = JSON.stringify(tplVars);
    }

    const components = buildComponents(camp, phone, null, body.vars || {});

    try {
      const result = await sendTemplateMessage(
        camp.access_token as string,
        camp.phone_number_id as string,
        phone,
        camp.tname as string,
        (camp.language as string) || 'en',
        components
      );
      const wamid = (result?.messages as Record<string, unknown>[])?.[0]?.id as string | undefined;
      return apiSuccess({ sent: true, phone, wamid });
    } catch (err) {
      // Surface Meta's exact rejection reason — that's the whole point of testing
      const axiosErr = err as { response?: { data?: { error?: { message?: string; error_data?: { details?: string } } } } };
      const metaErr  = axiosErr?.response?.data?.error;
      const reason   = metaErr?.message
        ? `Meta: ${metaErr.message}${metaErr.error_data?.details ? ` — ${metaErr.error_data.details}` : ''}`
        : (err instanceof Error ? err.message : 'Failed to send test');
      return apiError(reason, 502);
    }
  } catch (err: unknown) {
    if (err instanceof Error && err.message === 'UNAUTHORIZED') return apiError('Unauthorized', 401);
    console.error('[campaign/test]', err);
    return apiError('Failed to send test', 500);
  }
}
