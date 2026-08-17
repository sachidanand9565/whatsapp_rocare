/**
 * POST /api/auth/meta/connect
 * Full workspace connect:
 *  1. Save WABA credentials to workspace
 *  2. Register the phone number on Cloud API (Embedded Signup verifies the
 *     number but does NOT register it — Meta shows "Pending" until this call)
 *  3. Subscribe Meta webhook for this WABA
 *  4. Import all templates from Meta into DB
 */
import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { query, execute, insert } from '@/lib/db';
import { apiSuccess, apiError } from '@/lib/utils';
import { RowDataPacket } from 'mysql2';

const GV = 'v20.0';

// Two-step verification PIN used when registering numbers on Cloud API.
// Meta requires a 6-digit PIN for /register; the same PIN is needed to
// re-register the number later, so it lives in env (WA_REGISTER_PIN),
// with a fixed default so registration never silently skips.
const REGISTER_PIN = (process.env.WA_REGISTER_PIN || '123456').replace(/\D/g, '').slice(0, 6).padStart(6, '0');

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
    const payload = await requireAuth(req);

    const { access_token, waba_id, phone_number_id, business_name, display_phone_number, coexistence } = await req.json();
    if (!access_token || !waba_id || !phone_number_id) {
      return apiError('access_token, waba_id and phone_number_id are required', 400);
    }
    // Coexistence = number is already registered on the WhatsApp Business App.
    // Detect from the client flag OR from Meta (platform_type) so a coexistence
    // number is never re-registered even if the client forgot the flag.
    let isCoexistence = !!coexistence;
    if (!isCoexistence) {
      try {
        const pRes = await fetch(`https://graph.facebook.com/${GV}/${phone_number_id}?fields=platform_type&access_token=${access_token}`);
        const pData = await pRes.json() as { platform_type?: string };
        if (pData.platform_type === 'SMB_APP' || pData.platform_type === 'ON_PREMISE_AND_SMB_APP' || pData.platform_type === 'CLOUD_API_AND_SMB_APP') {
          isCoexistence = true;
        }
      } catch { /* non-fatal */ }
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

    // ── 2. Register phone number on Cloud API ─────────────────
    // Without this the number stays "Pending" in Meta Business Manager and
    // cannot send messages. Idempotent — re-registering an already registered
    // number simply succeeds.
    // SKIPPED for coexistence: the number is already registered via the
    // WhatsApp Business App; calling /register there is wrong per Meta docs.
    if (isCoexistence) {
      results.push({ step: 'Phone number registration', status: 'ok', detail: 'Skipped — coexistence number is registered via the WhatsApp Business App' });
    } else try {
      const regRes = await fetch(
        `https://graph.facebook.com/${GV}/${phone_number_id}/register`,
        {
          method:  'POST',
          headers: { Authorization: `Bearer ${access_token}`, 'Content-Type': 'application/json' },
          body:    JSON.stringify({ messaging_product: 'whatsapp', pin: REGISTER_PIN }),
        }
      );
      const regData = await regRes.json() as { success?: boolean; error?: { message?: string; code?: number } };
      if (regData.success || regRes.ok) {
        results.push({ step: 'Phone number registered', status: 'ok' });
      } else {
        const code = regData.error?.code;
        const hint = code === 133005
          ? 'Two-step PIN mismatch — this number already has a different PIN. Reset it in Meta Business Manager → Phone numbers → Two-step verification, then reconnect.'
          : regData.error?.message || 'Registration failed';
        console.warn(`[meta/connect] register failed for ${phone_number_id}:`, JSON.stringify(regData.error));
        results.push({ step: 'Phone number registration', status: 'warn', detail: hint });
      }
    } catch (e) {
      results.push({ step: 'Phone number registration', status: 'warn', detail: String(e) });
    }

    // ── 3. Subscribe Meta App webhook on the WABA ─────────────
    try {
      // Use user access token directly — it has admin access to the WABA from Embedded Signup
      const subRes = await fetch(
        `https://graph.facebook.com/${GV}/${waba_id}/subscribed_apps`,
        {
          method:  'POST',
          headers: {
            Authorization:  `Bearer ${access_token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            // smb_message_echoes: coexistence — messages sent from the phone's
            // WhatsApp Business App arrive as echoes so the panel shows them too
            // history / smb_app_state_sync: coexistence contacts + chat history
            // sync deliveries (Meta REQUIRES these subscribed for coexistence)
            // calls: WhatsApp Business Calling API events (connect / terminate)
            subscribed_fields: [
              'messages', 'message_template_status_update', 'calls',
              'smb_message_echoes', 'smb_app_state_sync', 'history',
            ],
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

    // ── 3b. Coexistence: trigger contacts + history sync ──────
    // Meta REQUIRES this within 24h of onboarding a WhatsApp Business App
    // number, otherwise the number is offboarded from Cloud API. Contacts
    // (smb_app_state_sync) first, then message history — both arrive later via
    // webhooks (fields smb_app_state_sync / history) which we subscribed above.
    if (isCoexistence) {
      for (const syncType of ['smb_app_state_sync', 'history'] as const) {
        try {
          const syncRes = await fetch(
            `https://graph.facebook.com/${GV}/${phone_number_id}/smb_app_data`,
            {
              method:  'POST',
              headers: { Authorization: `Bearer ${access_token}`, 'Content-Type': 'application/json' },
              body:    JSON.stringify({ messaging_product: 'whatsapp', sync_type: syncType }),
            }
          );
          const syncData = await syncRes.json() as { request_id?: string; error?: { message?: string } };
          const label = syncType === 'history' ? 'Chat history sync' : 'Contacts sync';
          if (syncRes.ok && syncData.request_id) {
            results.push({ step: label, status: 'ok', detail: 'Requested — data arrives over the next minutes via webhook' });
          } else {
            console.warn(`[meta/connect] ${syncType} sync failed:`, JSON.stringify(syncData.error));
            results.push({ step: label, status: 'warn', detail: syncData.error?.message || 'Sync request rejected' });
          }
        } catch (e) {
          results.push({ step: syncType === 'history' ? 'Chat history sync' : 'Contacts sync', status: 'warn', detail: String(e) });
        }
      }
    }

    // ── 4. Import templates from Meta ─────────────────────────
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

    return apiSuccess({ results });
  } catch (err: unknown) {
    if (err instanceof Error && err.message === 'UNAUTHORIZED') return apiError('Unauthorized', 401);
    console.error('[meta/connect]', err);
    return apiError('Connect failed', 500);
  }
}
