/**
 * POST /api/templates/sync
 * Fetch latest status, category AND buttons/components from Meta
 * and update DB accordingly.
 */
import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { query, execute } from '@/lib/db';
import { apiSuccess, apiError } from '@/lib/utils';
import { RowDataPacket } from 'mysql2';
import axios from 'axios';

interface MetaComponent {
  type:     string;   // HEADER | BODY | FOOTER | BUTTONS
  format?:  string;   // TEXT | IMAGE | DOCUMENT | VIDEO
  text?:    string;
  buttons?: MetaButton[];
}
interface MetaButton {
  type:          string;   // QUICK_REPLY | URL | PHONE_NUMBER
  text:          string;
  url?:          string;
  phone_number?: string;
}
interface MetaTemplate {
  id:         string;
  name:       string;
  status:     string;
  category:   string;
  language:   string;
  components: MetaComponent[];
}

// ── Convert Meta components → our local button format ────────
function extractButtons(components: MetaComponent[]) {
  const btnComponent = components.find((c) => c.type === 'BUTTONS');
  if (!btnComponent?.buttons?.length) return [];

  return btnComponent.buttons.map((b) => ({
    type:  b.type,                        // QUICK_REPLY | URL | PHONE_NUMBER
    text:  b.text,
    url:   b.url || undefined,
    phone: b.phone_number || undefined,
  }));
}

// ── Extract body/header text from components ─────────────────
function extractBodyText(components: MetaComponent[]): string {
  return components.find((c) => c.type === 'BODY')?.text || '';
}
function extractHeaderInfo(components: MetaComponent[]): { type: string; content: string } {
  const h = components.find((c) => c.type === 'HEADER');
  if (!h) return { type: 'NONE', content: '' };

  // For media headers, try to get the example URL/handle Meta returns
  if (h.format && ['IMAGE','DOCUMENT','VIDEO'].includes(h.format)) {
    const ex = (h as Record<string, unknown>).example as Record<string, unknown> | undefined;
    const url  = (ex?.header_url  as string[] | undefined)?.[0] || '';
    const handle = (ex?.header_handle as string[] | undefined)?.[0] || '';
    return { type: h.format, content: url || handle };
  }

  return {
    type:    h.format || 'TEXT',
    content: h.text   || '',
  };
}
function extractFooterText(components: MetaComponent[]): string {
  return components.find((c) => c.type === 'FOOTER')?.text || '';
}

export async function POST(req: NextRequest) {
  try {
    const payload = requireAuth(req);

    // ── Resolve credentials ───────────────────────────────
    const ws = await query<RowDataPacket[]>(
      'SELECT access_token, waba_id FROM workspaces WHERE id = ?',
      [payload.workspaceId]
    );
    const wsRow       = ws[0] || {};
    const accessToken = (wsRow.access_token as string) || process.env.WHATSAPP_ACCESS_TOKEN || '';
    const wabaId      = (wsRow.waba_id      as string) || process.env.WABA_ID              || '';

    if (!accessToken || !wabaId) {
      return apiError('WhatsApp credentials not configured. Go to Settings first.', 400);
    }

    // ── Fetch ALL templates from Meta (with pagination) ───
    let allMetaTemplates: MetaTemplate[] = [];
    let nextUrl: string | null =
      `https://graph.facebook.com/v19.0/${wabaId}/message_templates` +
      `?fields=id,name,status,category,language,components&limit=100`;

    while (nextUrl) {
      const res: { data: { data: MetaTemplate[]; paging?: { next?: string } } } =
        await axios.get(nextUrl, { headers: { Authorization: `Bearer ${accessToken}` } });
      allMetaTemplates = allMetaTemplates.concat(res.data.data || []);
      nextUrl = res.data.paging?.next || null;
    }

    if (allMetaTemplates.length === 0) {
      return apiSuccess({ synced: 0, message: 'No templates found on Meta' });
    }

    // ── Get local templates ───────────────────────────────
    const localTemplates = await query<RowDataPacket[]>(
      'SELECT id, name, language, status, category, meta_template_id FROM templates WHERE workspace_id = ?',
      [payload.workspaceId]
    );

    let synced  = 0;
    let updated = 0;
    const changes: {
      name: string;
      old_status: string; new_status: string;
      old_category: string; new_category: string;
      buttons_updated: boolean;
    }[] = [];

    for (const local of localTemplates) {
      // Match: meta_template_id first, then name+language
      const meta = allMetaTemplates.find(
        (m) =>
          (local.meta_template_id && m.id === local.meta_template_id) ||
          (m.name === local.name && m.language === local.language)
      );
      if (!meta) continue;

      synced++;

      const oldStatus   = (local.status   as string).toUpperCase();
      const oldCategory = (local.category as string).toUpperCase();
      const newStatus   = meta.status.toUpperCase();
      const newCategory = meta.category.toUpperCase();

      // Extract buttons + content from Meta components
      const metaButtons    = extractButtons(meta.components);
      const metaBodyText   = extractBodyText(meta.components);
      const metaHeader     = extractHeaderInfo(meta.components);
      const metaFooter     = extractFooterText(meta.components);

      const statusChanged   = oldStatus   !== newStatus;
      const categoryChanged = oldCategory !== newCategory;
      const idMissing       = !local.meta_template_id;

      // Always update buttons + content when syncing (they may differ)
      await execute(
        `UPDATE templates
         SET status          = ?,
             category        = ?,
             meta_template_id= ?,
             buttons         = ?,
             body_text       = CASE WHEN ? != '' THEN ? ELSE body_text END,
             header_type     = CASE WHEN ? != 'NONE' THEN ? ELSE header_type END,
             header_content  = CASE WHEN ? != '' THEN ? ELSE header_content END,
             footer_text     = CASE WHEN ? != '' THEN ? ELSE footer_text END
         WHERE id = ?`,
        [
          newStatus,
          newCategory,
          meta.id,
          JSON.stringify(metaButtons),
          // body_text
          metaBodyText, metaBodyText,
          // header_type
          metaHeader.type, metaHeader.type,
          // header_content
          metaHeader.content, metaHeader.content,
          // footer_text
          metaFooter, metaFooter,
          local.id,
        ]
      );
      updated++;

      if (statusChanged || categoryChanged) {
        changes.push({
          name:            local.name as string,
          old_status:      oldStatus,
          new_status:      newStatus,
          old_category:    oldCategory,
          new_category:    newCategory,
          buttons_updated: metaButtons.length > 0,
        });
      }
    }

    return apiSuccess({
      total_on_meta: allMetaTemplates.length,
      local_matched: synced,
      updated,
      changes,
      message: updated > 0
        ? `${updated} template(s) synced from Meta`
        : 'All templates already up to date',
    });

  } catch (err: unknown) {
    if (err instanceof Error && err.message === 'UNAUTHORIZED') return apiError('Unauthorized', 401);
    if (axios.isAxiosError(err)) {
      const errData = (err.response?.data as Record<string, unknown>)?.error as Record<string, unknown>;
      return apiError(`Meta API Error: ${(errData?.message as string) || err.message}`, 500);
    }
    console.error('[sync]', err);
    return apiError('Sync failed', 500);
  }
}
