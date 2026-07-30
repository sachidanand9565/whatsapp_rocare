/**
 * lib/campaignComponents.ts
 * Builds WhatsApp template components for campaign sends.
 * Shared by the campaign-process cron and the campaign test endpoint so a test
 * send exercises EXACTLY the same payload logic as the real broadcast.
 */
import { RowDataPacket } from 'mysql2';

export function buildComponents(camp: RowDataPacket, contactPhone: string, contactName: string | null, rowVars: Record<string, string> = {}): object[] {
  const components: object[] = [];
  const headerType    = (camp.header_type as string || '').toUpperCase();
  // Header media priority: per-row override (bulk API "media" field) →
  // campaign-level override → template default
  const campaignVarsRaw = parseJson<Record<string, string>>(camp.template_vars as string, {});
  const headerMediaOverride = rowVars._header_media || campaignVarsRaw._header_media || '';
  const headerContent = headerMediaOverride || (camp.header_content as string) || '';

  if (['IMAGE', 'DOCUMENT', 'VIDEO'].includes(headerType) && headerContent) {
    const mediaType = headerType.toLowerCase() as 'image' | 'document' | 'video';
    const isMediaId = headerContent.startsWith('media_id:');
    const mediaId   = isMediaId ? headerContent.replace('media_id:', '') : '';
    const isUrl     = !isMediaId && headerContent.startsWith('http');
    components.push({
      type: 'header',
      parameters: [{
        type: mediaType,
        [mediaType]: isMediaId ? { id: mediaId } : isUrl ? { link: headerContent } : { id: headerContent },
      }],
    });
  }
  // Per-contact CSV vars take priority over campaign-level template_vars
  const campaignVars = parseJson<Record<string, string>>(camp.template_vars as string, {});
  const merged = { ...campaignVars, ...rowVars }; // CSV row overrides campaign defaults
  // Resolve {{contact_name}} / {{contact_phone}} placeholders
  const resolvedVars = Object.fromEntries(
    Object.entries(merged).map(([k, v]) => [
      k,
      String(v)
        .replace(/\{\{contact_name\}\}/gi,  contactName || contactPhone)
        .replace(/\{\{contact_phone\}\}/gi, contactPhone),
    ])
  );
  // Only positional {{1}}, {{2}}… keys become body parameters — internal keys
  // like _header_media must NOT leak in (Meta 400s the whole send on a
  // parameter-count mismatch, failing every contact in the batch).
  const sortedKeys = Object.keys(resolvedVars)
    .filter((k) => /^\d+$/.test(k))
    .sort((a, b) => Number(a) - Number(b));
  const params = sortedKeys.map((k) => ({ type: 'text', text: resolvedVars[k] }));
  if (params.length > 0) {
    components.push({ type: 'body', parameters: params });
  }
  return components;
}

export function parseJson<T>(val: unknown, fallback: T): T {
  if (!val) return fallback;
  if (typeof val === 'object') return val as T;
  try { return JSON.parse(val as string) as T; } catch { return fallback; }
}
