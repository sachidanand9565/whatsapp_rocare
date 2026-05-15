/**
 * POST /api/campaigns/[id]/launch
 * Start sending campaign messages (bulk send with rate limiting)
 */
import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { query, execute, insert } from '@/lib/db';
import { sendTemplateMessage } from '@/lib/whatsapp';
import { apiSuccess, apiError, sleep, WA_RATE_LIMIT_MS, utcNow } from '@/lib/utils';
import { RowDataPacket } from 'mysql2';

type Params = { params: { id: string } };

export async function POST(req: NextRequest, { params }: Params) {
  try {
    const payload = requireAuth(req);
    const campaignId = Number(params.id);

    // Load campaign
    const camps = await query<RowDataPacket[]>(
      `SELECT c.*, t.name as tname, t.language, t.body_text,
              t.header_type, t.header_content, t.footer_text, t.buttons,
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
    if (camp.status === 'running' || camp.status === 'completed') {
      return apiError(`Campaign is already ${camp.status as string}`, 400);
    }
    if (camp.campaign_type === 'api') {
      return apiError('API campaigns cannot be launched manually. Use the /send endpoint instead.', 400);
    }

    // Mark as running
    await execute('UPDATE campaigns SET status = ?, started_at = ? WHERE id = ?', ['running', utcNow(), campaignId]);

    // Get pending contacts — skip opted-out ones
    const contacts = await query<RowDataPacket[]>(
      `SELECT cc.contact_id, c.phone, cc.id as cc_id
       FROM campaign_contacts cc
       JOIN contacts c ON c.id = cc.contact_id
       WHERE cc.campaign_id = ? AND cc.status = 'pending'
         AND (c.opted_in IS NULL OR c.opted_in = 1)`,
      [campaignId]
    );

    // Mark opted-out contacts as skipped so they don't stay as pending
    await execute(
      `UPDATE campaign_contacts cc
       JOIN contacts c ON c.id = cc.contact_id
       SET cc.status = 'failed', cc.error = 'opted_out'
       WHERE cc.campaign_id = ? AND cc.status = 'pending'
         AND c.opted_in = 0`,
      [campaignId]
    );

    // Send in background — don't await, return immediately
    sendBulk(
      campaignId,
      payload.workspaceId,
      camp,
      contacts as { contact_id: number; phone: string; cc_id: number }[]
    ).catch((e) => console.error('[bulk send error]', e));

    return apiSuccess({ message: `Sending to ${contacts.length} contacts`, total: contacts.length });
  } catch (err: unknown) {
    if (err instanceof Error && err.message === 'UNAUTHORIZED') return apiError('Unauthorized', 401);
    console.error('[launch]', err);
    return apiError('Server error', 500);
  }
}

async function sendBulk(
  campaignId: number,
  workspaceId: number,
  camp: RowDataPacket,
  contacts: { contact_id: number; phone: string; cc_id: number }[]
) {
  let sentCount = 0;
  let failedCount = 0;

  for (const contact of contacts) {
    try {
      const result = await sendTemplateMessage(
        camp.access_token as string,
        camp.phone_number_id as string,
        contact.phone,
        camp.tname as string,
        camp.language as string,
        buildComponents(camp)
      );

      const wamid = (result?.messages as Record<string, unknown>[])?.[0]?.id as string;

      // Build rendered body with variables replaced
      let bodyText = (camp.body_text as string) || '';
      const vars = (camp.template_vars as Record<string, string>) || {};
      for (const [k, v] of Object.entries(vars)) {
        bodyText = bodyText.replace(new RegExp(`\\{\\{${k}\\}\\}`, 'g'), v);
      }
      let buttons: unknown[] = [];
      try { buttons = JSON.parse((camp.buttons as string) || '[]'); } catch { buttons = []; }

      const templateContent = JSON.stringify({
        __type:         'template',
        template_name:  camp.tname,
        header_type:    camp.header_type    || 'NONE',
        header_content: camp.header_content || '',
        body:           bodyText,
        footer:         camp.footer_text    || '',
        buttons,
      });

      // Store message
      const t = utcNow();
      const msgId = await insert(
        `INSERT INTO messages (workspace_id, contact_id, wamid, direction, type, content, campaign_id, status, sent_at, created_at)
         VALUES (?, ?, ?, 'outbound', 'template', ?, ?, 'sent', ?, ?)`,
        [workspaceId, contact.contact_id, wamid, templateContent, campaignId, t, t]
      );

      await execute(
        'UPDATE campaign_contacts SET status = ?, message_id = ?, sent_at = ? WHERE id = ?',
        ['sent', msgId, t, contact.cc_id]
      );
      sentCount++;
    } catch (err) {
      console.error(`[bulk] failed for ${contact.phone}`, err);
      await execute(
        'UPDATE campaign_contacts SET status = ?, error = ? WHERE id = ?',
        ['failed', String(err), contact.cc_id]
      );
      failedCount++;
    }

    await sleep(WA_RATE_LIMIT_MS); // respect rate limit
  }

  const finalStatus = contacts.length > 0 && failedCount === contacts.length ? 'failed' : 'completed';
  await execute(
    `UPDATE campaigns SET status = ?, completed_at = ?,
     sent_count = ?, failed_count = ? WHERE id = ?`,
    [finalStatus, utcNow(), sentCount, failedCount, campaignId]
  );
}

function buildComponents(camp: RowDataPacket): object[] {
  const components: object[] = [];

  // ── Header component for media templates ──────────────────────
  const headerType    = (camp.header_type as string || '').toUpperCase();
  const headerContent = (camp.header_content as string) || '';

  if (['IMAGE','DOCUMENT','VIDEO'].includes(headerType) && headerContent) {
    const mediaType = headerType.toLowerCase() as 'image' | 'document' | 'video';
    // header_content can be a URL (https://...) or a media handle
    const isUrl = headerContent.startsWith('http');
    const mediaObj = isUrl
      ? { link: headerContent }
      : { id: headerContent };

    components.push({
      type: 'header',
      parameters: [{ type: mediaType, [mediaType]: mediaObj }],
    });
  }

  // ── Body component for variable templates ─────────────────────
  const vars   = (camp.template_vars as Record<string, string>) || {};
  const params = Object.values(vars).map((v) => ({ type: 'text', text: String(v) }));
  if (params.length > 0) {
    components.push({ type: 'body', parameters: params });
  }

  return components;
}
