/**
 * lib/whatsapp.ts
 * Meta WhatsApp Cloud API wrapper
 * Docs: https://developers.facebook.com/docs/whatsapp/cloud-api
 */
import axios, { AxiosInstance } from 'axios';
import https from 'https';

const API_VERSION = 'v23.0';
const BASE_URL    = `https://graph.facebook.com/${API_VERSION}`;

// Shared keep-alive agent: reuses TCP/TLS connections to graph.facebook.com
// across calls instead of a fresh handshake per message (was costing
// ~100-300ms/message during bulk sends). Module-scope so it survives across
// requests on a warm serverless instance.
const keepAliveAgent = new https.Agent({ keepAlive: true, maxSockets: 50 });
const REQUEST_TIMEOUT_MS = 15_000; // avoid a hung request pinning a DB/pool slot indefinitely

// ---- Create axios instance for a specific workspace ----
export function createWAClient(accessToken: string): AxiosInstance {
  return axios.create({
    baseURL: BASE_URL,
    httpsAgent: keepAliveAgent,
    timeout: REQUEST_TIMEOUT_MS,
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

// ---- Send interactive CTA URL button message (single "visit website" button) ----
export async function sendCtaUrlMessage(
  accessToken:   string,
  phoneNumberId: string,
  to:            string,
  bodyText:      string,
  buttonText:    string,
  url:           string,
  headerText?:   string,
  footerText?:   string,
) {
  const client = createWAClient(accessToken);
  const interactive: Record<string, unknown> = {
    type: 'cta_url',
    body: { text: bodyText },
    action: {
      name: 'cta_url',
      parameters: {
        display_text: buttonText.slice(0, 20),
        url,
      },
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
  const { data } = await client.post(`/${phoneNumberId}/messages`, payload);
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
  // WhatsApp only accepts `filename` on document objects and `caption` on
  // image/video/document — sending either on the wrong type gets the whole
  // request rejected by Graph API (#100 invalid parameter).
  const payload: Record<string, unknown> = { id: mediaId };
  if (caption && mediaType !== 'audio')  payload.caption  = caption;
  if (filename && mediaType === 'document') payload.filename = filename;
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
  if (caption && mediaType !== 'audio')  payload.caption  = caption;
  if (filename && mediaType === 'document') payload.filename = filename;
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

// ---- Send typing indicator (WhatsApp Cloud API) ----
// Correct payload: mark the incoming message as read + include a typing_indicator.
// Typing shows for ~25s or until the next message is sent. `status: 'typing'` is NOT valid.
export async function sendTypingIndicator(
  accessToken:   string,
  phoneNumberId: string,
  messageId:     string   // wamid of the incoming message being replied to
) {
  const client = createWAClient(accessToken);
  try {
    const { data } = await client.post(`/${phoneNumberId}/messages`, {
      messaging_product: 'whatsapp',
      status:            'read',
      message_id:        messageId,
      typing_indicator:  { type: 'text' },
    });
    return data;
  } catch (err: unknown) {
    const msg = (err as { response?: { data?: unknown }; message?: string })?.response?.data || (err as { message?: string })?.message;
    console.error('[WhatsApp] typing indicator failed:', msg);
  }
}

// ═══════════════════════════════════════════════════════════════
// WhatsApp Business Calling API (Cloud API)
// Docs: developers.facebook.com/docs/whatsapp/cloud-api/calling
// ═══════════════════════════════════════════════════════════════

export interface CallingSettings {
  status?:                     'ENABLED' | 'DISABLED';
  call_icon_visibility?:       'DEFAULT' | 'DISABLE_ALL';
  callback_permission_status?: 'ENABLED' | 'DISABLED';
  call_hours?: {
    status:                  'ENABLED' | 'DISABLED';
    timezone_id:             string;
    weekly_operating_hours?: { day_of_week: string; open_time: string; close_time: string }[];
    holiday_schedule?:       { date: string; start_time: string; end_time: string }[];
  };
}

// ---- Read calling settings + messaging tier for a phone number ----
export async function getCallingSettings(accessToken: string, phoneNumberId: string) {
  const client = createWAClient(accessToken);
  const [settingsRes, infoRes] = await Promise.all([
    client.get(`/${phoneNumberId}/settings`, { params: { include_sip_credentials: false } }),
    client.get(`/${phoneNumberId}`, { params: { fields: 'display_phone_number,verified_name,messaging_limit_tier,quality_rating,status,code_verification_status' } }),
  ]);
  return {
    calling: (settingsRes.data?.calling ?? null) as CallingSettings | null,
    phone:   infoRes.data as {
      display_phone_number?: string; verified_name?: string; messaging_limit_tier?: string;
      quality_rating?: string; status?: string; code_verification_status?: string;
    },
  };
}

// ---- WhatsApp Business Profile (what customers see when they tap the business name) ----
export interface BusinessProfile {
  about?: string;        // ≤139 chars, shown under the name
  description?: string;  // ≤512 chars, shown in the profile body
  address?: string; email?: string; websites?: string[]; vertical?: string;
  profile_picture_url?: string;
}
export async function getBusinessProfile(accessToken: string, phoneNumberId: string): Promise<BusinessProfile> {
  const client = createWAClient(accessToken);
  const { data } = await client.get(`/${phoneNumberId}/whatsapp_business_profile`, {
    params: { fields: 'about,description,address,email,websites,vertical,profile_picture_url' },
  });
  return (data?.data?.[0] ?? {}) as BusinessProfile;
}
export async function updateBusinessProfile(
  accessToken: string, phoneNumberId: string, fields: Partial<Pick<BusinessProfile, 'about' | 'description'>>
) {
  const client = createWAClient(accessToken);
  const { data } = await client.post(`/${phoneNumberId}/whatsapp_business_profile`, { messaging_product: 'whatsapp', ...fields });
  return data as { success?: boolean };
}

// ---- Enable / configure calling on a phone number ----
// Requires whatsapp_business_management (advanced) + messaging tier ≥ 2000/day.
export async function updateCallingSettings(accessToken: string, phoneNumberId: string, calling: CallingSettings) {
  const client = createWAClient(accessToken);
  const { data } = await client.post(`/${phoneNumberId}/settings`, { calling });
  return data as { success?: boolean };
}

// ---- Call control ----
// reject / terminate need no media. pre_accept / accept carry the browser's
// WebRTC SDP answer (RFC 8866). Order matters: pre_accept BEFORE accept —
// Meta rejects an accept that wasn't preceded by pre_accept.
export async function callAction(
  accessToken:   string,
  phoneNumberId: string,
  callId:        string,
  action:        'reject' | 'terminate' | 'pre_accept' | 'accept',
  sdpAnswer?:    string
) {
  const client = createWAClient(accessToken);
  const body: Record<string, unknown> = {
    messaging_product: 'whatsapp',
    call_id:           callId,
    action,
  };
  if ((action === 'pre_accept' || action === 'accept') && sdpAnswer) {
    body.session = { sdp_type: 'answer', sdp: sdpAnswer };
  }
  const { data } = await client.post(`/${phoneNumberId}/calls`, body);
  return data as { success?: boolean };
}

// ---- Call permission: where do we stand with this user? ----
// status: no_permission | temporary (7 days) | permanent
export interface CallPermissionInfo {
  status:          'no_permission' | 'temporary' | 'permanent' | string;
  expiration_time: number | null;      // unix seconds (temporary only)
  can_request:     boolean;            // send_call_permission_request allowed now?
  can_call:        boolean;            // start_call allowed now?
  request_limits:  { time_period: string; max_allowed: number; current_usage: number }[];
}
export async function getCallPermission(accessToken: string, phoneNumberId: string, userWaId: string): Promise<CallPermissionInfo> {
  const client = createWAClient(accessToken);
  const { data } = await client.get(`/${phoneNumberId}/call_permissions`, { params: { user_wa_id: userWaId } });
  const actions = (data?.actions as { action_name: string; can_perform_action: boolean; limits?: CallPermissionInfo['request_limits'] }[]) || [];
  const req  = actions.find((a) => a.action_name === 'send_call_permission_request');
  const call = actions.find((a) => a.action_name === 'start_call');
  return {
    status:          data?.permission?.status || 'no_permission',
    expiration_time: data?.permission?.expiration_time ?? null,
    can_request:     !!req?.can_perform_action,
    can_call:        !!call?.can_perform_action,
    request_limits:  req?.limits || [],
  };
}

// ---- Call permission request (free-form; needs an open 24h window) ----
// Limits: 1 per 24h, 2 per 7 days per user. Reply arrives as an interactive
// message of type call_permission_reply.
export async function sendCallPermissionRequest(accessToken: string, phoneNumberId: string, to: string, bodyText: string) {
  const client = createWAClient(accessToken);
  const { data } = await client.post(`/${phoneNumberId}/messages`, {
    messaging_product: 'whatsapp',
    recipient_type:    'individual',
    to,
    type:              'interactive',
    interactive: {
      type:   'call_permission_request',
      action: { name: 'call_permission_request' },
      body:   { text: bodyText },
    },
  });
  return data;
}

// ---- "Call us" button (voice_call CTA) — customer taps to call our number ----
export async function sendVoiceCallButton(
  accessToken: string, phoneNumberId: string, to: string,
  bodyText: string, buttonText = 'Call us', ttlMinutes = 4320, headerText?: string, footerText?: string
) {
  const client = createWAClient(accessToken);
  const interactive: Record<string, unknown> = {
    type:   'voice_call',
    body:   { text: bodyText },
    action: {
      name:       'voice_call',
      parameters: { display_text: buttonText.slice(0, 20), ttl_minutes: ttlMinutes },
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

// ---- Business-initiated call: ring the customer with our SDP offer ----
// Requires the customer to have granted call permission (callback permission
// prompt or a call_permission_request message) within the last 7 days.
export async function startBusinessCall(
  accessToken:   string,
  phoneNumberId: string,
  toPhone:       string,
  sdpOffer:      string
) {
  const client = createWAClient(accessToken);
  const { data } = await client.post(`/${phoneNumberId}/calls`, {
    messaging_product: 'whatsapp',
    to:                toPhone,
    action:            'connect',
    session:           { sdp_type: 'offer', sdp: sdpOffer },
  });
  // { messaging_product, calls: [{ id: 'wacid.…' }] }
  return data as { calls?: { id: string }[] };
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

// Calling API webhook (field = "calls"). Two events per call:
//  - connect:   call is ringing (USER_INITIATED carries the caller's SDP offer)
//  - terminate: call ended — status COMPLETED (answered) | FAILED (missed/rejected/unanswered)
export interface IncomingCall {
  from:       string;
  to:         string;
  call_id:    string;
  timestamp:  string;
  event:      'connect' | 'terminate' | string;
  direction:  'USER_INITIATED' | 'BUSINESS_INITIATED' | string;
  status:     string;   // terminate only: 'COMPLETED' | 'FAILED'
  start_time?: string;
  end_time?:   string;
  duration?:   number;  // seconds, terminate + COMPLETED only
  sdp?:        string;  // connect + USER_INITIATED: caller's SDP offer (for WebRTC accept)
  profileName?: string;
}

// Coexistence: WhatsApp Business App contacts pushed via smb_app_state_sync
// (after we request the sync at onboarding, and on later edits in the app)
export interface SyncedContact {
  action:    'add' | 'remove' | string;
  phone:     string;
  full_name: string;
  first_name: string;
}

// Coexistence: past chats delivered via the `history` webhook in chunks after
// we request a history sync. Same shape as live messages plus a final status.
export interface HistoryMessage {
  wamid:        string;
  from:         string;
  to:           string;
  timestamp:    string;
  type:         string;
  text?:        string;
  image?:       object; audio?: object; document?: object; video?: object; sticker?: object;
  status:       string;   // DELIVERED | ERROR | PENDING | PLAYED | READ | SENT
}

// Coexistence: a message the business sends from the WhatsApp Business App on
// their phone arrives as an "echo" (field = smb_message_echoes) so the panel
// can mirror the full conversation.
export interface EchoMessage {
  wamid:     string;
  to:        string;      // customer phone number
  timestamp: string;
  type:      string;
  text?:     string;
  image?:    object;
  audio?:    object;
  document?: object;
  video?:    object;
  sticker?:  object;
}

export function parseWebhookBody(body: Record<string, unknown>): {
  messages: IncomingMessage[];
  statuses: StatusUpdate[];
  phoneNumberId: string;
  wabaId: string;
  profileNames: Record<string, string>;
  templateStatusUpdates: TemplateStatusUpdate[];
  calls: IncomingCall[];
  echoes: EchoMessage[];
  syncedContacts: SyncedContact[];
  historyMessages: HistoryMessage[];
  historyProgress: { phase: number; chunk_order: number; progress: number } | null;
} {
  const result = {
    messages: [] as IncomingMessage[],
    statuses: [] as StatusUpdate[],
    phoneNumberId: '',
    wabaId: '',
    profileNames: {} as Record<string, string>,
    templateStatusUpdates: [] as TemplateStatusUpdate[],
    calls: [] as IncomingCall[],
    echoes: [] as EchoMessage[],
    syncedContacts: [] as SyncedContact[],
    historyMessages: [] as HistoryMessage[],
    historyProgress: null as { phase: number; chunk_order: number; progress: number } | null,
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
        const contactsList = (v?.contacts as Record<string, unknown>[]) ?? [];
        const profileName = (contactsList[0]?.profile as Record<string, unknown>)?.name as string | undefined;
        for (const c of callsList) {
          const session = c.session as Record<string, unknown> | undefined;
          result.calls.push({
            from:        c.from      as string,
            to:          (c.to as string) || '',
            // Real Calling API uses `id` (wacid.…); older/legacy payloads used `call_id`
            call_id:     ((c.id as string) || (c.call_id as string) || ''),
            timestamp:   c.timestamp as string,
            event:       ((c.event as string) || (c.status ? 'terminate' : 'connect')),
            direction:   ((c.direction as string) || 'USER_INITIATED'),
            status:      ((c.status as string) || ''),
            start_time:  c.start_time as string | undefined,
            end_time:    c.end_time   as string | undefined,
            duration:    typeof c.duration === 'number' ? c.duration : (c.duration ? Number(c.duration) : undefined),
            sdp:         session?.sdp as string | undefined,
            profileName,
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

    // Coexistence echoes (field = "smb_message_echoes") — sent from the phone app
    for (const change of changes) {
      if (change.field === 'smb_message_echoes') {
        const v    = change.value as Record<string, unknown>;
        const pnId = (v?.metadata as Record<string, unknown>)?.phone_number_id as string;
        if (pnId && !result.phoneNumberId) result.phoneNumberId = pnId;
        const echoList = (v?.message_echoes as Record<string, unknown>[]) ?? [];
        for (const m of echoList) {
          result.echoes.push({
            wamid:     m.id as string,
            to:        m.to as string,
            timestamp: m.timestamp as string,
            type:      m.type as string,
            text:      (m.text as Record<string, unknown>)?.body as string,
            image:     m.image as object,
            audio:     m.audio as object,
            document:  m.document as object,
            video:     m.video as object,
            sticker:   m.sticker as object,
          });
        }
      }
    }

    // Coexistence contacts sync (field = "smb_app_state_sync")
    for (const change of changes) {
      if (change.field === 'smb_app_state_sync') {
        const v    = change.value as Record<string, unknown>;
        const pnId = (v?.metadata as Record<string, unknown>)?.phone_number_id as string;
        if (pnId && !result.phoneNumberId) result.phoneNumberId = pnId;
        const list = (v?.state_sync as Record<string, unknown>[]) ?? [];
        for (const s of list) {
          if (s.type !== 'contact') continue;
          const c = (s.contact as Record<string, unknown>) || {};
          result.syncedContacts.push({
            action:     (s.action as string) || 'add',
            phone:      (c.phone_number as string) || '',
            full_name:  (c.full_name  as string) || '',
            first_name: (c.first_name as string) || '',
          });
        }
      }
    }

    // Coexistence chat history (field = "history") — arrives in chunks
    for (const change of changes) {
      if (change.field === 'history') {
        const v    = change.value as Record<string, unknown>;
        const pnId = (v?.metadata as Record<string, unknown>)?.phone_number_id as string;
        if (pnId && !result.phoneNumberId) result.phoneNumberId = pnId;
        const hist = (v?.history as Record<string, unknown>[]) ?? [];
        for (const h of hist) {
          const meta = (h.metadata as Record<string, unknown>) || {};
          result.historyProgress = {
            phase:       Number(meta.phase ?? 0),
            chunk_order: Number(meta.chunk_order ?? 0),
            progress:    Number(meta.progress ?? 0),
          };
          const threads = (h.threads as Record<string, unknown>[]) ?? [];
          for (const t of threads) {
            const msgs = (t.messages as Record<string, unknown>[]) ?? [];
            for (const m of msgs) {
              result.historyMessages.push({
                wamid:     m.id as string,
                from:      m.from as string,
                to:        m.to as string,
                timestamp: m.timestamp as string,
                type:      m.type as string,
                text:      (m.text as Record<string, unknown>)?.body as string,
                image:     m.image as object,
                audio:     m.audio as object,
                document:  m.document as object,
                video:     m.video as object,
                sticker:   m.sticker as object,
                status:    ((m.history_context as Record<string, unknown>)?.status as string) || '',
              });
            }
          }
        }
      }
    }

    const change    = changes[0];
    const value     = change?.value as Record<string, unknown>;

    result.phoneNumberId = ((value?.metadata as Record<string, unknown>)?.phone_number_id as string) || result.phoneNumberId;

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
        } else if (ia.type === 'call_permission_reply' && ia.call_permission_reply) {
          // Customer answered our call-permission request (accept / reject).
          // Surface as an interactive reply so the chat shows a readable line.
          const cpr = ia.call_permission_reply as Record<string, unknown>;
          const accepted = cpr.response === 'accept';
          interactiveReply = {
            id:        `call_permission:${cpr.response}`,
            title:     accepted ? '✅ Allowed WhatsApp calls from you' : '❌ Declined WhatsApp calls',
            replyType: 'button_reply',
          };
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
