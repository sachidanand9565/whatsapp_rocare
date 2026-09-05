/**
 * POST /api/campaigns/test-template
 * Send a test template message BEFORE the campaign exists — used by the
 * New Campaign modal so a broadcast can be verified on your own number
 * before creating/launching it.
 *
 * Body: { template_id: 5, phone: "919876543210",
 *         vars?: { "1": "John" }, header_media?: "media_id:… | https://…" }
 *
 * Builds the exact same payload the campaign-process cron will send
 * (buildComponents), so what you receive is what the audience will receive.
 */
import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { query } from '@/lib/db';
import { apiSuccess, apiError, normalizePhone } from '@/lib/utils';
import { sendTemplateMessage } from '@/lib/whatsapp';
import { buildComponents } from '@/lib/campaignComponents';
import { RowDataPacket } from 'mysql2';

export async function POST(req: NextRequest) {
  try {
    const payload = await requireAuth(req);
    if (payload.role === 'agent') return apiError('Agents cannot send campaign tests', 403);

    const body = await req.json() as {
      template_id?: number; phone?: string;
      vars?: Record<string, string>; header_media?: string;
    };
    const templateId = Number(body.template_id) || 0;
    if (!templateId) return apiError('template_id is required', 400);
    if (!body.phone)  return apiError('phone is required', 400);
    const phone = normalizePhone(body.phone);
    if (!phone) return apiError('Invalid phone number', 400);

    const rows = await query<RowDataPacket[]>(
      `SELECT t.name as tname, t.language, t.body_text, t.header_type,
              t.header_content, t.footer_text, t.buttons,
              w.access_token, w.phone_number_id
       FROM templates t
       JOIN workspaces w ON w.id = t.workspace_id
       WHERE t.id = ? AND t.workspace_id = ?`,
      [templateId, payload.workspaceId]
    );
    if (rows.length === 0) return apiError('Template not found', 404);
    const camp = rows[0];
    if (!camp.access_token || !camp.phone_number_id) {
      return apiError('WhatsApp API not configured', 400);
    }

    // Shape it like a campaign row so buildComponents applies the same
    // header-media override rules the real send will use.
    camp.template_vars = JSON.stringify(
      body.header_media?.trim() ? { _header_media: body.header_media.trim() } : {}
    );

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
    console.error('[campaigns/test-template]', err);
    return apiError('Failed to send test', 500);
  }
}
