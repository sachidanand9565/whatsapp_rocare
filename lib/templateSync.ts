/**
 * lib/templateSync.ts
 * Pulls a workspace's templates from Meta: refreshes status/category/content of
 * the ones we already have, and imports the ones that only exist on Meta
 * (created in Business Manager, or by another panel).
 * Only the super-admin panel calls this — see app/api/admin/workspaces/[id]/sync-templates.
 */
import { query, execute } from '@/lib/db';
import { RowDataPacket } from 'mysql2';
import axios from 'axios';

/** Setup problem worth showing the admin verbatim (bad credentials etc.) */
export class TemplateSyncError extends Error {}

export interface TemplateSyncResult {
  total_on_meta:  number;
  local_matched:  number;
  updated:        number;
  imported:       number;
  imported_names: string[];
  changes: {
    name: string;
    old_status: string; new_status: string;
    old_category: string; new_category: string;
    buttons_updated: boolean;
  }[];
  message: string;
}

interface MetaComponent {
  type:     string;   // HEADER | BODY | FOOTER | BUTTONS
  format?:  string;   // TEXT | IMAGE | DOCUMENT | VIDEO
  text?:    string;
  buttons?: MetaButton[];
}
interface MetaButton {
  type:          string;   // QUICK_REPLY | URL | PHONE_NUMBER | OTP
  text?:         string;   // Meta omits `text` for OTP buttons (label is auto-generated)
  otp_type?:     string;   // COPY_CODE | ONE_TAP | ZERO_TAP (AUTHENTICATION templates only)
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
    type:  b.type,                        // QUICK_REPLY | URL | PHONE_NUMBER | OTP
    text:  b.text || (b.type === 'OTP' ? 'Copy Code' : ''),
    url:   b.url || undefined,
    phone: b.phone_number || undefined,
  }));
}

// ── Extract body/header text from components ─────────────────
function extractBodyText(components: MetaComponent[], category?: string): string {
  const bodyText = components.find((c) => c.type === 'BODY')?.text || '';
  if (bodyText) return bodyText;
  // AUTHENTICATION templates have no static BODY text — Meta auto-generates the
  // OTP wording at send time. Store a placeholder so the chat bubble isn't empty.
  if (category === 'AUTHENTICATION') return '***** is your verification code.';
  return '';
}
function extractHeaderInfo(components: MetaComponent[]): { type: string; content: string } {
  const h = components.find((c) => c.type === 'HEADER');
  if (!h) return { type: 'NONE', content: '' };

  // For media headers, try to get the example URL/handle Meta returns
  if (h.format && ['IMAGE','DOCUMENT','VIDEO'].includes(h.format)) {
    const ex = (h as unknown as Record<string, unknown>).example as Record<string, unknown> | undefined;
    const url    = (ex?.header_url    as string[] | undefined)?.[0] || '';
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

// ── Meta values → our ENUM columns (an unmapped value fails the whole query) ──
const STATUS_MAP: Record<string, string> = {
  APPROVED: 'APPROVED', PENDING: 'PENDING', REJECTED: 'REJECTED', PAUSED: 'PAUSED',
  DISABLED: 'PAUSED', PENDING_DELETION: 'PAUSED', DELETED: 'REJECTED',
  IN_APPEAL: 'PENDING', LIMIT_EXCEEDED: 'PAUSED',
};
function safeStatus(status?: string): string {
  return STATUS_MAP[(status || '').toUpperCase()] || 'PENDING';
}
function safeCategory(category?: string): string {
  const c = (category || '').toUpperCase();
  return ['UTILITY', 'MARKETING', 'AUTHENTICATION'].includes(c) ? c : 'UTILITY';
}
/** header_type column has no NONE/LOCATION — store TEXT for those. */
function safeHeaderType(type?: string): string {
  const t = (type || '').toUpperCase();
  return ['TEXT', 'IMAGE', 'DOCUMENT', 'VIDEO'].includes(t) ? t : 'TEXT';
}
/** ["{{1}}","{{2}}"] — the placeholder list the templates table stores */
function extractVariables(bodyText: string): string[] {
  const found = bodyText.match(/\{\{(\d+)\}\}/g) || [];
  return [...new Set(found)];
}

export async function syncWorkspaceTemplates(workspaceId: number): Promise<TemplateSyncResult> {
  // ── Resolve credentials ───────────────────────────────
  const ws = await query<RowDataPacket[]>(
    'SELECT access_token, waba_id FROM workspaces WHERE id = ?',
    [workspaceId]
  );
  const wsRow       = ws[0] || {};
  const accessToken = (wsRow.access_token as string) || process.env.WHATSAPP_ACCESS_TOKEN || '';
  const wabaId      = (wsRow.waba_id      as string) || process.env.WABA_ID              || '';

  if (!accessToken || !wabaId) {
    throw new TemplateSyncError('WhatsApp credentials not configured. Add them in Settings first.');
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
    return { total_on_meta: 0, local_matched: 0, updated: 0, imported: 0, imported_names: [], changes: [],
             message: 'No templates found on Meta' };
  }

  // ── Get local templates ───────────────────────────────
  const localTemplates = await query<RowDataPacket[]>(
    'SELECT id, name, language, status, category, meta_template_id FROM templates WHERE workspace_id = ?',
    [workspaceId]
  );

  let synced  = 0;
  let updated = 0;
  const matchedMetaIds = new Set<string>();
  const changes: {
    name: string;
    old_status: string; new_status: string;
    old_category: string; new_category: string;
    buttons_updated: boolean;
  }[] = [];

  for (const local of localTemplates) {
    // Match: meta_template_id → name+language → name alone when it's unique
    // on Meta (local rows often store "en" where Meta says "en_US"; without
    // this the template would be re-imported as a duplicate).
    const sameName = allMetaTemplates.filter((m) => m.name === local.name);
    const meta =
      allMetaTemplates.find((m) => local.meta_template_id && m.id === local.meta_template_id) ||
      sameName.find((m) => m.language === local.language) ||
      (sameName.length === 1 ? sameName[0] : undefined);
    if (!meta) continue;

    matchedMetaIds.add(meta.id);
    synced++;

    const oldStatus   = (local.status   as string).toUpperCase();
    const oldCategory = (local.category as string).toUpperCase();
    const newStatus   = safeStatus(meta.status);
    const newCategory = safeCategory(meta.category);

    // Extract buttons + content from Meta components
    const metaButtons    = extractButtons(meta.components);
    const metaBodyText   = extractBodyText(meta.components, newCategory);
    const metaHeader     = extractHeaderInfo(meta.components);
    const metaHeaderType = metaHeader.type === 'NONE' ? 'NONE' : safeHeaderType(metaHeader.type);
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
        metaHeaderType, metaHeaderType,
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

  // ── Import templates that live on Meta but not in our DB ──
  // (made in Business Manager, or before this workspace was connected)
  const seenLocally = new Set(
    localTemplates.map((t) => `${(t.name as string).toLowerCase()}|${((t.language as string) || 'en').toLowerCase()}`)
  );
  const imported: string[] = [];

  for (const meta of allMetaTemplates) {
    if (matchedMetaIds.has(meta.id)) continue;
    const key = `${meta.name.toLowerCase()}|${(meta.language || 'en').toLowerCase()}`;
    if (seenLocally.has(key)) continue;   // same name+language already imported in this run
    seenLocally.add(key);

    const category = safeCategory(meta.category);
    const bodyText = extractBodyText(meta.components, category);
    if (!bodyText) continue;              // body_text is NOT NULL — skip templates we can't render
    const header   = extractHeaderInfo(meta.components);

    await execute(
      `INSERT INTO templates
         (workspace_id, name, language, category, status, header_type, header_content,
          body_text, footer_text, buttons, variables, meta_template_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        workspaceId,
        meta.name,
        meta.language || 'en',
        category,
        safeStatus(meta.status),
        safeHeaderType(header.type),
        header.type === 'NONE' ? '' : header.content,
        bodyText,
        extractFooterText(meta.components),
        JSON.stringify(extractButtons(meta.components)),
        JSON.stringify(extractVariables(bodyText)),
        meta.id,
      ]
    );
    imported.push(meta.name);
  }

  const parts: string[] = [];
  if (updated > 0)          parts.push(`${updated} template(s) synced from Meta`);
  if (imported.length > 0)  parts.push(`${imported.length} new template(s) imported`);

  return {
    total_on_meta: allMetaTemplates.length,
    local_matched: synced,
    updated,
    imported: imported.length,
    imported_names: imported,
    changes,
    message: parts.length > 0 ? parts.join(' · ') : 'All templates already up to date',
  };

}
