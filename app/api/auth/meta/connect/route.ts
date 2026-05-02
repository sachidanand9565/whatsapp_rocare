/**
 * POST /api/auth/meta/connect
 * Full workspace connect:
 *  1. Save WABA credentials to workspace
 *  2. Subscribe Meta webhook for this WABA
 *  3. Import all templates from Meta into DB
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { query, execute, insert } from '@/lib/db';
import { apiError } from '@/lib/utils';
import { RowDataPacket } from 'mysql2';

const GV = 'v20.0';

interface MetaComponent {
  type: string; format?: string; text?: string;
  buttons?: { type: string; text: string; url?: string; phone_number?: string }[];
}

function parseComponents(components: MetaComponent[]) {
  const header  = components.find((c) => c.type === 'HEADER');
  const body    = components.find((c) => c.type === 'BODY');
  const footer  = components.find((c) => c.type === 'FOOTER');
  const btnComp = components.find((c) => c.type === 'BUTTONS');

  return {
    header_type:    header ? (header.format || 'TEXT') : 'NONE',
    header_content: header?.text || '',
    body_text:      body?.text   || '',
    footer_text:    footer?.text || '',
    buttons: (btnComp?.buttons || []).map((b) => ({
      type: b.type, text: b.text,
      url:   b.url          || undefined,
      phone: b.phone_number || undefined,
    })),
  };
}

export async function POST(req: NextRequest) {
  try {
    const payload = requireAuth(req);

    const { access_token, waba_id, phone_number_id, business_name, display_phone_number } = await req.json();
    if (!access_token || !waba_id || !phone_number_id) {
      return apiError('access_token, waba_id and phone_number_id are required', 400);
    }

    // ── 0. Check phone_number_id not already used by another workspace ──
    const existing = await query<RowDataPacket[]>(
      'SELECT id FROM workspaces WHERE phone_number_id = ? AND id != ? AND is_active = 1 LIMIT 1',
      [phone_number_id, payload.workspaceId]
    );
    if (existing.length > 0) {
      return apiError('This phone number is already connected to another workspace. Please use a different phone number.', 409);
    }

    // ── 1. Save credentials to workspace ─────────────────────
    // Try with phone_display column first, fallback without it
    try {
      await execute(
        `UPDATE workspaces
         SET access_token=?, waba_id=?, phone_number_id=?, phone_display=?,
             name = COALESCE(NULLIF(?, ''), name)
         WHERE id = ?`,
        [access_token, waba_id, phone_number_id, display_phone_number || null, business_name || '', payload.workspaceId]
      );
    } catch {
      await execute(
        `UPDATE workspaces
         SET access_token=?, waba_id=?, phone_number_id=?,
             name = COALESCE(NULLIF(?, ''), name)
         WHERE id = ?`,
        [access_token, waba_id, phone_number_id, business_name || '', payload.workspaceId]
      );
    }

    const results: { step: string; status: string; detail?: string }[] = [
      { step: 'Credentials saved', status: 'ok' },
    ];

    // ── 2. Subscribe Meta App webhook on the WABA ─────────────
    try {
      const appId     = process.env.FACEBOOK_APP_ID || process.env.NEXT_PUBLIC_FACEBOOK_APP_ID || '';
      const appSecret = process.env.FACEBOOK_APP_SECRET || '';

      // Get app access token for subscription
      let subToken = access_token;
      if (appId && appSecret) {
        const appTokenRes = await fetch(
          `https://graph.facebook.com/oauth/access_token?client_id=${appId}&client_secret=${appSecret}&grant_type=client_credentials`
        );
        const appTokenData = await appTokenRes.json();
        if (appTokenData.access_token) subToken = appTokenData.access_token;
      }

      const subRes = await fetch(
        `https://graph.facebook.com/${GV}/${waba_id}/subscribed_apps`,
        {
          method:  'POST',
          headers: {
            Authorization:  `Bearer ${subToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            subscribed_fields: ['messages', 'message_deliveries', 'message_reads'],
          }),
        }
      );
      const subData = await subRes.json();
      if (subData.success || subRes.ok) {
        results.push({ step: 'Webhook subscribed', status: 'ok' });
      } else {
        results.push({ step: 'Webhook subscription', status: 'warn', detail: subData.error?.message || 'Check Meta App permissions' });
      }
    } catch (e) {
      results.push({ step: 'Webhook subscription', status: 'warn', detail: String(e) });
    }

    // ── 3. Import templates from Meta ─────────────────────────
    try {
      let importedCount = 0;
      let updatedCount  = 0;

      // Fetch all templates (paginated)
      let nextUrl: string | null =
        `https://graph.facebook.com/${GV}/${waba_id}/message_templates` +
        `?fields=id,name,status,category,language,components&limit=100&access_token=${access_token}`;

      const allTemplates: {
        id: string; name: string; status: string;
        category: string; language: string;
        components: MetaComponent[];
      }[] = [];

      while (nextUrl) {
        const fetchRes = await fetch(nextUrl);
        const fetchData: { data: typeof allTemplates; paging?: { next?: string } } = await fetchRes.json();
        allTemplates.push(...(fetchData.data || []));
        nextUrl = fetchData.paging?.next || null;
      }

      // Existing templates in DB
      const existing = await query<RowDataPacket[]>(
        'SELECT id, name, language, meta_template_id FROM templates WHERE workspace_id = ?',
        [payload.workspaceId]
      );
      const existingMap = new Map(
        existing.map((t) => [`${t.name}:${t.language}`, t])
      );

      for (const tpl of allTemplates) {
        const key = `${tpl.name}:${tpl.language}`;
        const parsed = parseComponents(tpl.components);

        if (existingMap.has(key)) {
          // Update status + meta_template_id
          const local = existingMap.get(key)!;
          await execute(
            `UPDATE templates SET status=?, category=?, meta_template_id=?,
             buttons=?, body_text=?, header_type=?, header_content=?, footer_text=?
             WHERE id=?`,
            [
              tpl.status, tpl.category, tpl.id,
              JSON.stringify(parsed.buttons),
              parsed.body_text, parsed.header_type,
              parsed.header_content, parsed.footer_text,
              local.id,
            ]
          );
          updatedCount++;
        } else {
          // Insert new
          await insert(
            `INSERT INTO templates
             (workspace_id, name, language, category, status, meta_template_id,
              header_type, header_content, body_text, footer_text, buttons, variables)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              payload.workspaceId,
              tpl.name, tpl.language,
              tpl.category, tpl.status, tpl.id,
              parsed.header_type, parsed.header_content,
              parsed.body_text, parsed.footer_text,
              JSON.stringify(parsed.buttons),
              JSON.stringify([]),
            ]
          );
          importedCount++;
        }
      }

      results.push({
        step: 'Templates imported',
        status: 'ok',
        detail: `${importedCount} new, ${updatedCount} updated (${allTemplates.length} total on Meta)`,
      });
    } catch (e) {
      results.push({ step: 'Template import', status: 'warn', detail: String(e) });
    }

    return NextResponse.json({ success: true, results });
  } catch (err: unknown) {
    if (err instanceof Error && err.message === 'UNAUTHORIZED') return apiError('Unauthorized', 401);
    console.error('[meta/connect]', err);
    return apiError('Connect failed', 500);
  }
}
