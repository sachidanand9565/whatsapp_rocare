/**
 * GET  /api/templates  — list workspace templates
 * POST /api/templates  — create + submit to Meta for approval
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { query, insert, execute } from '@/lib/db';
import { apiSuccess, apiError } from '@/lib/utils';
import { RowDataPacket } from 'mysql2';
import axios from 'axios';

// ─── GET ─────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  try {
    const payload = await requireAuth(req);
    const templates = await query<RowDataPacket[]>(
      'SELECT * FROM templates WHERE workspace_id = ? ORDER BY created_at DESC',
      [payload.workspaceId]
    );
    return apiSuccess(templates);
  } catch (err: unknown) {
    if (err instanceof Error && err.message === 'UNAUTHORIZED') return apiError('Unauthorized', 401);
    return apiError('Server error', 500);
  }
}

// ─── POST ────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  try {
    const payload = await requireAuth(req);
    const body = await req.json();

    const {
      name, language, category,
      header_type, header_content,
      media_handle = '',  // Meta media handle for IMAGE / VIDEO / DOCUMENT headers
      body_text, footer_text,
      buttons = [],
      variables = [],
      var_samples = {},   // { '{{1}}': 'John', '{{2}}': 'ORD-123' }
    } = body;

    if (!name || !body_text) return apiError('Name and body text are required');

    // ── 0. Block duplicate template names (case-insensitive) ──
    const existing = await query<RowDataPacket[]>(
      `SELECT id, status FROM templates WHERE workspace_id = ? AND LOWER(name) = LOWER(?) AND language = ? AND status != 'REJECTED' LIMIT 1`,
      [payload.workspaceId, name, language || 'en']
    );
    if (existing.length > 0) {
      return apiError(
        `A template named "${name}" already exists (status: ${existing[0].status}). Please choose a different name or edit the existing template.`,
        409
      );
    }

    // ── 1. Resolve credentials: DB → ENV fallback ────────────
    const ws = await query<RowDataPacket[]>(
      'SELECT access_token, waba_id FROM workspaces WHERE id = ?',
      [payload.workspaceId]
    );
    const wsRow      = ws[0] || {};
    const accessToken = (wsRow.access_token as string) || process.env.WHATSAPP_ACCESS_TOKEN || '';
    const wabaId      = (wsRow.waba_id      as string) || process.env.WABA_ID              || '';

    // ── 2. Save to DB first ──────────────────────────────────
    const id = await insert(
      `INSERT INTO templates
       (workspace_id, name, language, category, header_type, header_content,
        body_text, footer_text, buttons, variables, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING')`,
      [
        payload.workspaceId,
        name,
        language   || 'en',
        category   || 'UTILITY',
        (header_type === 'NONE' ? 'TEXT' : header_type) || 'TEXT',
        // For media headers store the handle so campaigns can include it when sending
        header_type === 'NONE' ? '' :
        ['IMAGE','DOCUMENT','VIDEO'].includes(header_type) ? (media_handle || header_content || '') :
        (header_content || ''),
        body_text,
        footer_text || '',
        JSON.stringify(buttons),
        JSON.stringify(variables),
      ]
    );

    // ── 3. Submit to Meta if credentials available ───────────
    if (!accessToken || !wabaId) {
      return apiSuccess(
        { id, meta_submitted: false, warning: 'WhatsApp credentials not configured. Template saved locally. Go to Settings to add your API credentials.' },
        201
      );
    }

    // ── Build components (validate first) ───────────────────
    if (['IMAGE', 'VIDEO', 'DOCUMENT'].includes(header_type) && !media_handle) {
      await execute('UPDATE templates SET status = ? WHERE id = ?', ['REJECTED', id]);
      return NextResponse.json({
        success: false, meta_submitted: false, local_id: id,
        error: `${header_type} header requires a file upload. Please upload a file first.`,
      }, { status: 422 });
    }

    let components: object[];
    try {
      components = buildMetaComponents({
        header_type, header_content, media_handle, body_text, footer_text, buttons, var_samples,
      });
    } catch (validationErr) {
      await execute('UPDATE templates SET status = ? WHERE id = ?', ['REJECTED', id]);
      return NextResponse.json({
        success: false, meta_submitted: false, local_id: id,
        error: validationErr instanceof Error ? validationErr.message : 'Validation failed',
      }, { status: 422 });
    }

    const metaPayload = {
      name,
      language: language || 'en',
      category: category || 'UTILITY',
      components,
    };

    console.log('[Meta Template Submit]', JSON.stringify(metaPayload, null, 2));

    // ── Submit to Meta ────────────────────────────────────
    try {
      const metaRes = await axios.post(
        `https://graph.facebook.com/v20.0/${wabaId}/message_templates`,
        metaPayload,
        { headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' } }
      );

      const metaData = metaRes.data as { id: string; status: string };
      console.log('[Meta Template Response]', metaData);

      await execute(
        'UPDATE templates SET meta_template_id = ?, status = ? WHERE id = ?',
        [metaData.id, metaData.status || 'PENDING', id]
      );

      return apiSuccess({ id, meta_submitted: true, meta_id: metaData.id, status: metaData.status }, 201);

    } catch (metaErr: unknown) {
      let metaError = 'Meta API error';
      let metaDetails = '';
      if (axios.isAxiosError(metaErr)) {
        const errData   = metaErr.response?.data as Record<string, unknown> | undefined;
        const fbError   = (errData?.error as Record<string, unknown>) || {};
        const userMsg   = fbError.error_user_msg    as string | undefined;
        const userTitle = fbError.error_user_title  as string | undefined;
        const code      = fbError.code              as number | undefined;
        const subcode   = fbError.error_subcode     as number | undefined;
        const errDataField = fbError.error_data     as string | undefined;
        metaError = userTitle || (fbError.message as string) || metaErr.message;

        // Friendly hints for known error codes (subcode checked first — more specific)
        let hint = '';
        if (subcode === 2388023) {
          hint = 'This template name + language was recently deleted on Meta and is still in a ~4 week cooldown period during which it cannot be reused. Use a different template name (or a different language) instead of waiting.';
        } else if (code === 1) {
          hint = 'Try a different template name (even previously rejected templates occupy the name on Meta). Also check: WABA permissions, access token scopes (needs whatsapp_business_management), and that you are not mixing Quick Reply + CTA buttons.';
        } else if (code === 100) {
          hint = 'Invalid parameter — check template name (only lowercase letters, numbers, underscores allowed) and body variables.';
        } else if (code === 190) {
          hint = 'Access token expired or invalid. Please reconnect via Facebook in Settings.';
        }

        metaDetails = [
          hint                && `Hint: ${hint}`,
          userMsg             && `Details: ${userMsg}`,
          errDataField        && `Error data: ${errDataField}`,
          code                && `Code: ${code}`,
          subcode             && `Subcode: ${subcode}`,
        ].filter(Boolean).join(' | ');
        console.error('[Meta Template Error]', JSON.stringify(errData, null, 2));
        console.error('[Meta Payload Sent]',   JSON.stringify(metaPayload, null, 2));
      } else if (metaErr instanceof Error) {
        metaError = metaErr.message;
      }

      await execute('UPDATE templates SET status = ? WHERE id = ?', ['REJECTED', id]);
      return NextResponse.json({
        success: false, meta_submitted: false, local_id: id,
        error: `Meta: ${metaError}${metaDetails ? ` — ${metaDetails}` : ''}`,
      }, { status: 422 });
    }

  } catch (err: unknown) {
    if (err instanceof Error && err.message === 'UNAUTHORIZED') return apiError('Unauthorized', 401);
    console.error('[templates POST]', err);
    return apiError('Server error', 500);
  }
}

// ─── Build Meta API components array ─────────────────────────
function buildMetaComponents(opts: {
  header_type:    string;
  header_content: string;
  media_handle:   string;
  body_text:      string;
  footer_text:    string;
  buttons:        { type: string; text: string; url?: string; url_type?: string; phone?: string }[];
  var_samples:    Record<string, string>;
}) {
  const { header_type, header_content, media_handle, body_text, footer_text, buttons, var_samples } = opts;
  const components: object[] = [];

  // ── HEADER component ──────────────────────────────────────
  if (header_type && header_type !== 'NONE') {
    if (header_type === 'TEXT') {
      if (header_content) {
        components.push({ type: 'HEADER', format: 'TEXT', text: header_content });
      }
    } else {
      // IMAGE / VIDEO / DOCUMENT — all use header_handle from Meta's Resumable Upload API.
      // header_url only supports JPG/PNG/MP4 and is unreliable; header_handle works for all types.
      components.push({
        type:    'HEADER',
        format:  header_type,
        example: { header_handle: [media_handle] },
      });
    }
  }

  // ── BODY component ────────────────────────────────────────
  // Extract variables like {{1}}, {{2}} from body text
  const varMatches = [...new Set(body_text.match(/\{\{\d+\}\}/g) || [])];
  const bodyComponent: Record<string, unknown> = { type: 'BODY', text: body_text };

  if (varMatches.length > 0) {
    // Build example body_text array using sample values
    const exampleValues = varMatches.map((v) => var_samples[v] || `Sample_${v.replace(/\{\{|\}\}/g, '')}`);
    bodyComponent.example = { body_text: [exampleValues] };
  }

  components.push(bodyComponent);

  // ── FOOTER component ──────────────────────────────────────
  if (footer_text) {
    components.push({ type: 'FOOTER', text: footer_text });
  }

  // ── BUTTONS component ─────────────────────────────────────
  if (buttons && buttons.length > 0) {
    const hasPhone = buttons.some((b) => b.type === 'PHONE_NUMBER');
    const hasQR    = buttons.some((b) => b.type === 'QUICK_REPLY');
    // Meta rule: PHONE_NUMBER cannot mix with Quick Reply; URL can.
    if (hasPhone && hasQR) {
      throw new Error('Call button cannot be mixed with Quick Reply buttons — use URL button instead.');
    }

    // CTA buttons must come before Quick Reply buttons when mixed.
    const sorted = [
      ...buttons.filter((b) => b.type !== 'QUICK_REPLY'),
      ...buttons.filter((b) => b.type === 'QUICK_REPLY'),
    ];

    const metaButtons: object[] = sorted.map((btn) => {
      if (btn.type === 'QUICK_REPLY') {
        return { type: 'QUICK_REPLY', text: btn.text };
      }
      if (btn.type === 'URL') {
        const isDynamic = btn.url_type === 'dynamic';
        // Dynamic URL: base URL without {{1}}, example shows the full URL
        const baseUrl = isDynamic
          ? (btn.url || '').replace(/\{\{1\}\}.*$/, '')
          : (btn.url || '');
        return {
          type:       'URL',
          text:       btn.text,
          url:        isDynamic ? `${baseUrl}{{1}}` : baseUrl,
          ...(isDynamic ? { example: [(btn.url || '').replace('{{1}}', 'sample-value')] } : {}),
        };
      }
      if (btn.type === 'PHONE_NUMBER') {
        return { type: 'PHONE_NUMBER', text: btn.text, phone_number: btn.phone || '' };
      }
      return {};
    });

    components.push({ type: 'BUTTONS', buttons: metaButtons });
  }

  return components;
}
