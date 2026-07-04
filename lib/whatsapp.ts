/**
 * lib/whatsapp.ts
 * Meta WhatsApp Cloud API wrapper
 * Docs: https://developers.facebook.com/docs/whatsapp/cloud-api
 */
import axios, { AxiosInstance } from 'axios';

const API_VERSION = 'v23.0';
const BASE_URL    = `https://graph.facebook.com/${API_VERSION}`;

// ---- Create axios instance for a specific workspace ----
export function createWAClient(accessToken: string): AxiosInstance {
  return axios.create({
    baseURL: BASE_URL,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
  });
}

// ---- Send plain text message ----
export async function sendTextMessage(
  accessToken:   string,
  phoneNumberId: string,
  to:            string,
  text:          string
) {
  const client = createWAClient(accessToken);
  const { data } = await client.post(`/${phoneNumberId}/messages`, {
    messaging_product: 'whatsapp',
    recipient_type:    'individual',
    to,
    type:              'text',
    text:              { preview_url: false, body: text },
  });
  return data; // { messages: [{ id: 'wamid...' }] }
}

// ---- Send interactive button message (max 3 buttons) ----
export async function sendButtonMessage(
  accessToken:   string,
  phoneNumberId: string,
  to:            string,
  bodyText:      string,
  buttons:       { id: string; title: string }[],
  headerText?:   string,
  footerText?:   string,
) {
  const client = createWAClient(accessToken);
  const interactive: Record<string, unknown> = {
    type: 'button',
    body: { text: bodyText },
    action: {
      buttons: buttons.slice(0, 3).map((b) => ({
        type:  'reply',
        reply: { id: b.id.slice(0, 256), title: b.title.slice(0, 20) },
      })),
    },
  };
  if (headerText) interactive.header = { type: 'text', text: headerText };
  if (footerText) interactive.footer = { text: footerText };

  const { data } = await client.post(`/${phoneNumberId}/messages`, {
    messaging_product: 'whatsapp',
    recipient_type:    'individual',
    to,
    type:              'interactive',
    interactive,
  });
  return data;
}

// ---- Send interactive list message (max 10 rows per section) ----
export async function sendListMessage(
  accessToken:   string,
  phoneNumberId: string,
  to:            string,
  bodyText:      string,
  buttonText:    string,
  sections:      { title: string; rows: { id: string; title: string; description?: string }[] }[],
  headerText?:   string,
  footerText?:   string,
) {
  const client = createWAClient(accessToken);
  const interactive: Record<string, unknown> = {
    type: 'list',
    body: { text: bodyText },
    action: {
      button: (buttonText || 'Select').slice(0, 20),
      sections: sections.map((s) => ({
        title: s.title || '',
        rows: s.rows.slice(0, 10).map((r) => ({
          id:    String(r.id).slice(0, 200),
          title: String(r.title).slice(0, 24),
          ...(r.description ? { description: String(r.description).slice(0, 72) } : {}),
        })),
      })),
    },
  };
  if (headerText) interactive.header = { type: 'text', text: headerText };
  if (footerText) interactive.footer = { text: footerText };
  const { data } = await client.post(`/${phoneNumberId}/messages`, {
    messaging_product: 'whatsapp',
    recipient_type:    'individual',
    to,
    type:              'interactive',
    interactive,
  });
  return data;
}

// ---- Send template message ----
export async function sendTemplateMessage(
  accessToken:   string,
  phoneNumberId: string,
  to:            string,
  templateName:  string,
  language:      string,
  components:    object[] = []
) {
  const client = createWAClient(accessToken);
  const payload = {
    messaging_product: 'whatsapp',
    to,
    type:     'template',
    template: {
      name:       templateName,
      language:   { code: language },
      components,
    },
  };
  console.log('[sendTemplate] payload=', JSON.stringify(payload));
  const { data } = await client.post(`/${phoneNumberId}/messages`, payload);
  console.log('[sendTemplate] response=', JSON.stringify(data));
  return data;
}

// ---- Send image message ----
export async function sendImageMessage(
  accessToken:   string,
  phoneNumberId: string,
  to:            string,
  imageUrl:      string,
  caption?:      string
) {
  const client = createWAClient(accessToken);
  const { data } = await client.post(`/${phoneNumberId}/messages`, {
    messaging_product: 'whatsapp',
    to,
    type:  'image',
    image: { link: imageUrl, caption },
  });
  return data;
}

// ---- Send any media by media_id (image/document/video/audio) ----
export async function sendMediaMessage(
  accessToken:   string,
  phoneNumberId: string,
  to:            string,
  mediaType:     'image' | 'document' | 'video' | 'audio',
  mediaId:       string,
  caption?:      string,
  filename?:     string
) {
  const client = createWAClient(accessToken);
  const payload: Record<string, unknown> = { id: mediaId };
  if (caption)  payload.caption  = caption;
  if (filename) payload.filename = filename;
  const { data } = await client.post(`/${phoneNumberId}/messages`, {
    messaging_product: 'whatsapp',
    to,
    type:        mediaType,
    [mediaType]: payload,
  });
  return data;
}

// ---- Send any media by URL (image/document/video/audio) ----
export async function sendMediaUrlMessage(
  accessToken:   string,
  phoneNumberId: string,
  to:            string,
  mediaType:     'image' | 'document' | 'video' | 'audio',
  mediaUrl:      string,
  caption?:      string,
  filename?:     string
) {
  const client = createWAClient(accessToken);
  const payload: Record<string, unknown> = { link: mediaUrl };
  if (caption)  payload.caption  = caption;
  if (filename) payload.filename = filename;
  const { data } = await client.post(`/${phoneNumberId}/messages`, {
    messaging_product: 'whatsapp',
    to,
    type:        mediaType,
    [mediaType]: payload,
  });
  return data;
}

// ---- Upload media file to WhatsApp and return media_id ----
export async function uploadMedia(
  accessToken:   string,
  phoneNumberId: string,
  fileBuffer:    Buffer,
  mimeType:      string,
  filename:      string
): Promise<string> {
  // Copy buffer into a fresh ArrayBuffer to avoid SharedArrayBuffer / pooled-Buffer issues
  const ab   = new ArrayBuffer(fileBuffer.byteLength);
  new Uint8Array(ab).set(fileBuffer);
  const blob = new Blob([ab], { type: mimeType });

  const form = new FormData();
  form.append('messaging_product', 'whatsapp');
  form.append('type', mimeType);
  form.append('file', blob, filename);

  const res = await fetch(`${BASE_URL}/${phoneNumberId}/media`, {
    method:  'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
    body:    form,
  });

  const text = await res.text();
  let json: { id?: string; error?: { message: string; code?: number } };
  try { json = JSON.parse(text); }
  catch { throw new Error(`WhatsApp upload error: ${text}`); }

  if (!res.ok || json.error) {
    throw new Error(`WhatsApp: ${json.error?.message || `HTTP ${res.status}`}`);
  }
  if (!json.id) throw new Error('No media_id returned from WhatsApp');
  return json.id;
}

// ---- Send multi-product message (WhatsApp Catalog product_list) ----
export async function sendMultiProductMessage(
  accessToken:   string,
  phoneNumberId: string,
  to:            string,
  catalogId:     string,
  sections:      { title: string; product_items: { product_retailer_id: string }[] }[],
  bodyText:      string,
  headerText?:   string,
  footerText?:   string,
) {
  const client = createWAClient(accessToken);
  const interactive: Record<string, unknown> = {
    type: 'product_list',
    body: { text: bodyText || ' ' },
    action: {
      catalog_id: catalogId,
      sections: sections.map(s => ({
        title: s.title || '',
        product_items: s.product_items.map(p => ({ product_retailer_id: p.product_retailer_id })),
      })),
    },
  };
  if (headerText) interactive.header = { type: 'text', text: headerText };
  if (footerText) interactive.footer = { text: footerText };
  const { data } = await client.post(`/${phoneNumberId}/messages`, {
    messaging_product: 'whatsapp',
    recipient_type:    'individual',
    to,
    type:        'interactive',
    interactive,
  });
  return data;
}

// ---- Send media message with optional buttons (interactive header) ----
export async function sendMediaButtonMessage(
  accessToken:   string,
  phoneNumberId: string,
  to:            string,
  mediaType:     'IMAGE' | 'VIDEO' | 'DOCUMENT' | 'AUDIO',
  mediaUrl:      string,
  caption:       string,
  buttons:       { id: string; title: string }[],
  mediaId?:      string,   // WhatsApp media_id from library (takes priority over URL)
) {
  const client = createWAClient(accessToken);
  const mt = mediaType.toLowerCase() as 'image' | 'video' | 'document' | 'audio';

  // Build media object: prefer uploaded media_id, fallback to link URL
  const mediaObj: Record<string, unknown> = mediaId ? { id: mediaId } : { link: mediaUrl };
  if (caption && mt !== 'audio') mediaObj.caption = caption;

  // Audio: always send as plain media (no interactive header support)
  if (mt === 'audio' || buttons.length === 0) {
    const { data } = await client.post(`/${phoneNumberId}/messages`, {
      messaging_product: 'whatsapp',
      recipient_type:    'individual',
      to,
      type: mt,
      [mt]: mediaObj,
    });
    return data;
  }

  // Interactive message with media header + buttons
  const header: Record<string, unknown> = { type: mt };
  const headerMedia: Record<string, unknown> = mediaId ? { id: mediaId } : { link: mediaUrl };
  header[mt] = headerMedia;

  const interactive: Record<string, unknown> = {
    type:   'button',
    header,
    body:   { text: caption || ' ' },
    action: {
      buttons: buttons.slice(0, 3).map((b) => ({
        type:  'reply',
        reply: { id: b.id.slice(0, 256), title: b.title.slice(0, 20) },
      })),
    },
  };
  const { data } = await client.post(`/${phoneNumberId}/messages`, {
    messaging_product: 'whatsapp',
    recipient_type:    'individual',
    to,
    type:        'interactive',
    interactive,
  });
  return data;
}

// ---- Send typing indicator — same status pattern as markAsRead ----
export async function sendTypingIndicator(
  accessToken:   string,
  phoneNumberId: string,
  messageId:     string   // wamid of the incoming message being replied to
) {
  const client = createWAClient(accessToken);
  try {
    const { data } = await client.post(`/${phoneNumberId}/messages`, {
      messaging_product: 'whatsapp',
      status:            'typing',
      message_id:        messageId,
    });
    return data;
  } catch (err: unknown) {
    const msg = (err as { response?: { data?: unknown }; message?: string })?.response?.data || (err as { message?: string })?.message;
    console.error('[WhatsApp] typing indicator failed:', msg);
  }
}

// ---- Mark message as read ----
export async function markAsRead(
  accessToken:   string,
  phoneNumberId: string,
  messageId:     string
) {
  const client = createWAClient(accessToken);
  const { data } = await client.post(`/${phoneNumberId}/messages`, {
    messaging_product: 'whatsapp',
    status:            'read',
    message_id:        messageId,
  });
  return data;
}

// ---- Send multi-product message (first product image + product list) ----
export async function sendProductMessage(
  accessToken:   string,
  phoneNumberId: string,
  to:            string,
  headerText:    string,
  bodyText:      string,
  products:      { id: string; name: string; price?: string; description?: string; image_url?: string; media_id?: string }[],
  footerText?:   string,
) {
  const client = createWAClient(accessToken);
  
  // Send first product's image (if available)
  if (products.length > 0) {
    const firstProduct = products[0];
    if (firstProduct.image_url || firstProduct.media_id) {
      try {
        const caption = `${firstProduct.name}${firstProduct.price ? ` • ₹${firstProduct.price}` : ''}`;
        
        if (firstProduct.image_url?.trim()) {
          // Send from URL
          await client.post(`/${phoneNumberId}/messages`, {
            messaging_product: 'whatsapp',
            recipient_type:    'individual',
            to,
            type:  'image',
            image: { link: firstProduct.image_url, caption },
          });
          console.log('[sendProductMessage] First product image sent');
        }
      } catch (err) {
        console.error('[sendProductMessage] Image send failed:', err);
      }
      
      // Small delay before sending list
      await new Promise(r => setTimeout(r, 300));
    }
  }
  
  // Send the product list
  const sections = [{
    title: headerText || 'Products',
    rows: products.slice(0, 10).map((p) => ({
      id:    String(p.id).slice(0, 200),
      title: String(p.name).slice(0, 24),
      description: [p.price && `₹${p.price}`, p.description?.slice(0, 50)].filter(Boolean).join(' • ').slice(0, 72),
    })),
  }];

  const interactive: Record<string, unknown> = {
    type: 'list',
    body: { text: bodyText },
    action: {
      button: 'Select Product',
      sections,
    },
  };
  if (footerText) interactive.footer = { text: footerText };

  const { data } = await client.post(`/${phoneNumberId}/messages`, {
    messaging_product: 'whatsapp',
    recipient_type:    'individual',
    to,
    type:        'interactive',
    interactive,
  });
  return data;
}

// ---- Submit template to Meta for approval ----
export async function submitTemplate(
  accessToken: string,
  wabaId:      string,
  template: {
    name:       string;
    language:   string;
    category:   string;
    components: object[];
  }
) {
  const client = createWAClient(accessToken);
  const { data } = await client.post(`/${wabaId}/message_templates`, template);
  return data; // { id: '...', status: 'PENDING' }
}

// ---- Get all templates from Meta ----
export async function getMetaTemplates(accessToken: string, wabaId: string) {
  const client = createWAClient(accessToken);
  const { data } = await client.get(`/${wabaId}/message_templates?fields=id,name,status,language,category,components`);
  return data.data;
}

// ---- Parse incoming webhook payload ----
export interface IncomingMessage {
  wamid:           string;
  from:            string;  // phone number
  timestamp:       string;
  type:            string;
  text?:           string;
  image?:          object;
  audio?:          object;
  document?:       object;
  video?:          object;
  sticker?:        object;
  location?:       object;
  contacts?:       object[];
  interactive?:    object;
  button?:         { text: string; payload: string };
  // Parsed from interactive: button_reply or list_reply
  interactiveReply?: { id: string; title: string; replyType: 'button_reply' | 'list_reply' };
  replied_to_wamid?: string;  // context.id from button replies
  errors?:         { code?: number; title?: string; message?: string }[];  // present when type === 'unsupported'
}

export interface StatusUpdate {
  wamid:     string;
  status:    'sent' | 'delivered' | 'read' | 'failed';
  timestamp: string;
  errors?:   object[];
}

export interface TemplateStatusUpdate {
  event:            string;
  templateId:       string;
  templateName:     string;
  templateLanguage: string;
  previousCategory: string;
  newCategory:      string;
  reason:           string;
}

export interface IncomingCall {
  from:      string;
  call_id:   string;
  timestamp: string;
  status:    string; // 'missed_call' | 'answered'
}

export function parseWebhookBody(body: Record<string, unknown>): {
  messages: IncomingMessage[];
  statuses: StatusUpdate[];
  phoneNumberId: string;
  wabaId: string;
  profileNames: Record<string, string>;
  templateStatusUpdates: TemplateStatusUpdate[];
  calls: IncomingCall[];
} {
  const result = {
    messages: [] as IncomingMessage[],
    statuses: [] as StatusUpdate[],
    phoneNumberId: '',
    wabaId: '',
    profileNames: {} as Record<string, string>,
    templateStatusUpdates: [] as TemplateStatusUpdate[],
    calls: [] as IncomingCall[],
  };
  try {
    const entry  = (body.entry as Record<string, unknown>[])?.[0];
    result.wabaId = (entry?.id as string) ?? '';

    const changes = (entry?.changes as Record<string, unknown>[]) ?? [];

    // Parse calls (field = "calls")
    for (const change of changes) {
      if (change.field === 'calls') {
        const v    = change.value as Record<string, unknown>;
        const pnId = (v?.metadata as Record<string, unknown>)?.phone_number_id as string;
        if (pnId && !result.phoneNumberId) result.phoneNumberId = pnId;
        const callsList = (v?.calls as Record<string, unknown>[]) ?? [];
        for (const c of callsList) {
          result.calls.push({
            from:      c.from      as string,
            call_id:   c.call_id   as string,
            timestamp: c.timestamp as string,
            status:    c.status    as string,
          });
        }
      }
    }

    // Template status update events (field = "message_template_status_update")
    for (const change of changes) {
      if (change.field === 'message_template_status_update') {
        const v = change.value as Record<string, unknown>;
        result.templateStatusUpdates.push({
          event:            (v.event            as string) ?? '',
          templateId:       String(v.message_template_id ?? ''),
          templateName:     (v.message_template_name     as string) ?? '',
          templateLanguage: (v.message_template_language as string) ?? '',
          previousCategory: (v.previous_category         as string) ?? '',
          newCategory:      (v.new_category              as string) ?? '',
          reason:           (v.reason                    as string) ?? '',
        });
      }
    }

    const change    = changes[0];
    const value     = change?.value as Record<string, unknown>;

    result.phoneNumberId = (value?.metadata as Record<string, unknown>)?.phone_number_id as string ?? '';

    // Extract profile names from contacts array
    const ctcs = (value?.contacts as Record<string, unknown>[]) ?? [];
    for (const c of ctcs) {
      const waId = c.wa_id as string;
      const name = (c.profile as Record<string, unknown>)?.name as string;
      if (waId && name) result.profileNames[waId] = name;
    }

    // Inbound messages
    const msgs = (value?.messages as Record<string, unknown>[]) ?? [];
    for (const m of msgs) {
      const btn     = m.button  as Record<string, unknown> | undefined;
      const context = m.context as Record<string, unknown> | undefined;

      // Parse interactive button_reply / list_reply
      let interactiveReply: IncomingMessage['interactiveReply'];
      if (m.type === 'interactive' && m.interactive) {
        const ia       = m.interactive as Record<string, unknown>;
        const btnReply  = ia.button_reply as Record<string, unknown> | undefined;
        const listReply = ia.list_reply   as Record<string, unknown> | undefined;
        if (btnReply) {
          interactiveReply = { id: btnReply.id as string, title: btnReply.title as string, replyType: 'button_reply' };
        } else if (listReply) {
          interactiveReply = { id: listReply.id as string, title: listReply.title as string, replyType: 'list_reply' };
        }
      }

      result.messages.push({
        wamid:            m.id as string,
        from:             m.from as string,
        timestamp:        m.timestamp as string,
        type:             m.type as string,
        text:             (m.text as Record<string, unknown>)?.body as string,
        image:            m.image as object,
        audio:            m.audio as object,
        document:         m.document as object,
        video:            m.video as object,
        sticker:          m.sticker as object,
        location:         m.location as object,
        contacts:         m.contacts as object[],
        interactive:      m.interactive as object,
        button:           btn ? { text: btn.text as string, payload: btn.payload as string } : undefined,
        interactiveReply,
        replied_to_wamid: context?.id as string | undefined,
        errors:           m.errors as IncomingMessage['errors'],
      });
    }

    // Status updates
    const statuses = (value?.statuses as Record<string, unknown>[]) ?? [];
    for (const s of statuses) {
      result.statuses.push({
        wamid:     s.id as string,
        status:    s.status as StatusUpdate['status'],
        timestamp: s.timestamp as string,
        errors:    s.errors as object[],
      });
    }
  } catch {
    // If parsing fails return empty arrays — we still log raw payload
  }
  return result;
}
