/**
 * lib/flow-engine.ts
 * Flow execution engine — handles starting, resuming, and executing chatbot flows.
 *
 * Node types:
 *   message        — send text to user
 *   button_message — send WhatsApp interactive button message (max 3 buttons)
 *   wait           — pause, wait for user reply / button click
 *   condition      — branch based on user reply or button click
 *   set_variable   — save user reply into a named variable
 *   api_call       — HTTP request to external URL with {{variable}} support
 *   update_contact — update contact field in DB
 *   delay          — wait N seconds before continuing
 *   template       — send WhatsApp approved template
 *   transfer       — transfer chat to human agent
 *   end            — end the flow
 */
import { query, insert, execute } from '@/lib/db';
import { sendTextMessage, sendTemplateMessage, sendButtonMessage, sendListMessage, sendMediaButtonMessage, sendProductMessage } from '@/lib/whatsapp';
import { utcNow } from '@/lib/utils';
import { emitSSE } from '@/lib/sse';
import { RowDataPacket } from 'mysql2';

// ── Types ────────────────────────────────────────────────────────

export type FlowNodeType =
  | 'message' | 'button_message' | 'list_message' | 'dynamic_list' | 'media_message' | 'multi_product' | 'wait' | 'condition'
  | 'set_variable' | 'api_call' | 'update_contact'
  | 'delay' | 'template' | 'transfer' | 'end';

export interface FlowNode {
  id:   string;
  type: FlowNodeType;
  data: {
    // message
    text?:           string;
    // button_message
    body_text?:      string;
    header_text?:    string;
    footer_text?:    string;
    buttons?:        { id: string; title: string }[];
    // list_message
    list_button_text?: string;
    list_sections?:    { title: string; rows: { id: string; title: string; description?: string }[] }[];
    // multi_product
    products?:         { id: string; name: string; price?: string; description?: string; image_url?: string; media_id?: string }[];
    // variable save options (for button_message, list_message, dynamic_list, multi_product)
    save_id_as?:       string;   // custom variable name for selected ID
    save_title_as?:    string;   // custom variable name for selected title
    // dynamic_list (API se data fetch karke list banao)
    items_path?:        string;   // JSON path to array e.g. "data.products"
    id_field?:          string;   // field name for row id   e.g. "id"
    title_field?:       string;   // field name for row title e.g. "name"
    description_field?: string;   // field name for description (optional)
    // media_message
    media_type?:     'IMAGE' | 'VIDEO' | 'DOCUMENT' | 'AUDIO';
    media_url?:      string;
    media_id?:       string;
    caption?:        string;
    // condition
    conditions?:     { value: string; label: string; variable?: string; operator?: string; compare_value?: string }[];
    // set_variable
    variable_name?:  string;
    // api_call
    url?:            string;
    method?:         'GET' | 'POST' | 'PUT' | 'PATCH';
    headers?:        string;   // JSON string
    body?:           string;   // JSON template string with {{vars}}
    save_response_as?: string; // variable name to store response body
    // update_contact
    contact_field?:  'name' | 'email' | 'phone' | 'notes' | 'tags';
    field_value?:    string;   // supports {{vars}}
    // delay
    seconds?:        number;
    // template
    template_name?:  string;
    language?:       string;
    // transfer
    transferNote?:   string;
    // condition (true/false)
    condition_variable?: string;
    condition_operator?: string;
    condition_value?:    string;
  };
  position: { x: number; y: number };
}

export interface FlowEdge {
  id:            string;
  source:        string;
  target:        string;
  sourceHandle?: string | null;
}

interface FlowDefinition {
  id:            number;
  workspace_id:  number;
  name:          string;
  trigger_type:  'keyword' | 'starts_with' | 'any';
  trigger_value: string | null;
  nodes:         FlowNode[];
  edges:         FlowEdge[];
  is_active:     number;
}

interface FlowSession {
  id:              number;
  contact_id:      number;
  flow_id:         number;
  current_node_id: string;
  variables:       Record<string, string>;
}

// ── Variable substitution ────────────────────────────────────────

function substituteVars(
  text: string,
  vars: Record<string, string>,
  extras: { contact_phone?: string; contact_name?: string; user_message?: string }
): string {
  return text
    .replace(/\{\{user_message\}\}/gi,   extras.user_message   || '')
    .replace(/\{\{contact_phone\}\}/gi,  extras.contact_phone  || '')
    .replace(/\{\{contact_name\}\}/gi,   extras.contact_name   || '')
    .replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] !== undefined ? vars[key] : `{{${key}}}`);
}

// ── DB Helpers ───────────────────────────────────────────────────

async function saveOutboundMessage(workspaceId: number, contactId: number, text: string, wamid: string | null, type = 'text') {
  const now = utcNow();
  await insert(
    `INSERT INTO messages (workspace_id, contact_id, wamid, direction, type, content, status, sent_at, created_at)
     VALUES (?, ?, ?, 'outbound', ?, ?, 'sent', ?, ?)`,
    [workspaceId, contactId, wamid, type, text, now, now]
  );
  emitSSE({ type: 'new_message', workspaceId, contactId, direction: 'outbound' });
}

async function updateSessionNode(sessionId: number, nodeId: string, variables?: Record<string, string>) {
  if (variables !== undefined) {
    await execute(
      'UPDATE flow_sessions SET current_node_id = ?, variables = ?, updated_at = NOW() WHERE id = ?',
      [nodeId, JSON.stringify(variables), sessionId]
    );
  } else {
    await execute(
      'UPDATE flow_sessions SET current_node_id = ?, updated_at = NOW() WHERE id = ?',
      [nodeId, sessionId]
    );
  }
}

async function endSession(sessionId: number) {
  await execute(
    "UPDATE flow_sessions SET status = 'completed', updated_at = NOW() WHERE id = ?",
    [sessionId]
  );
}

async function abandonOldSessions(workspaceId: number, contactId: number) {
  await execute(
    "UPDATE flow_sessions SET status = 'abandoned', updated_at = NOW() WHERE workspace_id = ? AND contact_id = ? AND status = 'active'",
    [workspaceId, contactId]
  );
}

function getNode(nodes: FlowNode[], id: string): FlowNode | null {
  return nodes.find((n) => n.id === id) || null;
}

function getNextNode(edges: FlowEdge[], nodes: FlowNode[], sourceId: string, handle?: string): FlowNode | null {
  const edge = handle
    ? (edges.find((e) => e.source === sourceId && e.sourceHandle === handle)
      || edges.find((e) => e.source === sourceId && e.sourceHandle === 'default')
      || edges.find((e) => e.source === sourceId && !e.sourceHandle)
      || edges.find((e) => e.source === sourceId)) // fallback: any edge from this node
    : edges.find((e) => e.source === sourceId);
  if (!edge) return null;
  return getNode(nodes, edge.target);
}

// ── Core Executor ────────────────────────────────────────────────

async function executeFromNode(
  flow:          FlowDefinition,
  session:       FlowSession,
  startNode:     FlowNode,
  accessToken:   string,
  phoneNumberId: string,
  contactPhone:  string,
  workspaceId:   number,
  userMessage:   string = '',
  contactName:   string = '',
): Promise<void> {
  let node: FlowNode | null = startNode;
  let vars = { ...session.variables };

  const extras = { contact_phone: contactPhone, contact_name: contactName, user_message: userMessage };

  while (node) {
    const nodeId = node.id;

    switch (node.type) {

        // ── Button Message: WhatsApp interactive buttons ──────────
      case 'button_message': {
        const bodyText   = substituteVars(node.data.body_text || '', vars, extras);
        const headerText = node.data.header_text ? substituteVars(node.data.header_text, vars, extras) : undefined;
        const footerText = node.data.footer_text ? substituteVars(node.data.footer_text, vars, extras) : undefined;
        const buttons    = (node.data.buttons || []) as { id: string; title: string }[];
        let wamid: string | null = null;
        try {
          const res = await sendButtonMessage(accessToken, phoneNumberId, contactPhone, bodyText, buttons, headerText, footerText);
          wamid = res?.messages?.[0]?.id || null;
        } catch { /* continue */ }
        // Save as interactive type, then wait for user to click a button
        const btnContent = JSON.stringify({ __type: 'buttons', body: bodyText, buttons, header: headerText, footer: footerText });
        await saveOutboundMessage(workspaceId, session.contact_id, btnContent, wamid, 'interactive');
        // Stay on this node — user ke button click ka wait karo
        await updateSessionNode(session.id, nodeId, vars);
        return;
      }

      // ── Media Message: image/video/document with optional buttons ─
      case 'media_message': {
        const mediaType  = (node.data.media_type || 'IMAGE') as 'IMAGE' | 'VIDEO' | 'DOCUMENT' | 'AUDIO';
        const mediaUrl   = substituteVars(node.data.media_url || '', vars, extras);
        const mediaId    = node.data.media_id || '';
        const caption    = substituteVars(node.data.caption   || '', vars, extras);
        const buttons    = (node.data.buttons || []) as { id: string; title: string }[];
        let wamid: string | null = null;
        try {
          const res = await sendMediaButtonMessage(accessToken, phoneNumberId, contactPhone, mediaType, mediaUrl, caption, buttons, mediaId || undefined);
          wamid = res?.messages?.[0]?.id || null;
        } catch { /* continue */ }
        const msgContent = JSON.stringify({ __type: 'media_button', media_type: mediaType, media_url: mediaUrl, media_id: mediaId, caption, buttons });
        await saveOutboundMessage(workspaceId, session.contact_id, msgContent, wamid, 'interactive');
        if (buttons.length > 0) {
          // Wait for user to click a button
          await updateSessionNode(session.id, nodeId, vars);
          return;
        }
        // No buttons — advance to next node automatically
        const nextN = getNextNode(flow.edges, flow.nodes, nodeId);
        if (!nextN) { await endSession(session.id); return; }
        await updateSessionNode(session.id, nextN.id, vars);
        node = nextN;
        continue;
      }

      // ── List Message: WhatsApp interactive list ───────────────
      case 'list_message': {
        const bodyText   = substituteVars(node.data.body_text || '', vars, extras);
        const headerText = node.data.header_text    ? substituteVars(node.data.header_text, vars, extras) : undefined;
        const footerText = node.data.footer_text    ? substituteVars(node.data.footer_text, vars, extras) : undefined;
        const buttonText = node.data.list_button_text || 'Select';
        const sections   = node.data.list_sections  || [];
        let wamid: string | null = null;
        try {
          const res = await sendListMessage(accessToken, phoneNumberId, contactPhone, bodyText, buttonText, sections, headerText, footerText);
          wamid = res?.messages?.[0]?.id || null;
        } catch { /* continue */ }
        const listContent = JSON.stringify({ __type: 'list', body: bodyText, button: buttonText, sections, header: headerText, footer: footerText });
        await saveOutboundMessage(workspaceId, session.contact_id, listContent, wamid, 'interactive');
        // Stay on this node — user ke item select ka wait karo
        await updateSessionNode(session.id, nodeId, vars);
        return;
      }

      // ── Dynamic List: API se data fetch karke list bhejo ─────────
      case 'dynamic_list': {
        const url        = substituteVars(node.data.url     || '', vars, extras);
        const method     = node.data.method                 || 'GET';
        const bodyText   = substituteVars(node.data.body_text  || '', vars, extras);
        const headerText = node.data.header_text ? substituteVars(node.data.header_text, vars, extras) : undefined;
        const footerText = node.data.footer_text ? substituteVars(node.data.footer_text, vars, extras) : undefined;
        const btnText    = node.data.list_button_text       || 'Select';
        const idField    = node.data.id_field               || 'id';
        const titleField = node.data.title_field            || 'title';
        const descField  = node.data.description_field      || '';
        const itemsPath  = node.data.items_path             || '';

        let rows: { id: string; title: string; description?: string }[] = [];
        try {
          let headersObj: Record<string, string> = { 'Content-Type': 'application/json' };
          if (node.data.headers) {
            try { headersObj = { ...headersObj, ...JSON.parse(substituteVars(node.data.headers, vars, extras)) }; } catch { /**/ }
          }
          const reqBody = method !== 'GET' && node.data.body
            ? substituteVars(node.data.body, vars, extras)
            : undefined;

          const res  = await fetch(url, { method, headers: headersObj, body: reqBody });
          let data: unknown = await res.json();

          // Navigate to nested path e.g. "data.products" → obj.data.products
          if (itemsPath) {
            for (const key of itemsPath.split('.')) {
              if (data && typeof data === 'object') data = (data as Record<string, unknown>)[key];
            }
          }

          if (Array.isArray(data)) {
            rows = data.slice(0, 10).map((item: unknown, idx: number) => {
              const obj = (item || {}) as Record<string, unknown>;
              return {
                id:    String(obj[idField]    ?? idx + 1),
                title: String(obj[titleField] ?? `Item ${idx + 1}`).slice(0, 24),
                ...(descField && obj[descField] ? { description: String(obj[descField]).slice(0, 72) } : {}),
              };
            });
          }

          // Optionally save raw JSON response as a variable
          if (node.data.save_response_as) {
            vars[node.data.save_response_as] = JSON.stringify(data);
          }
        } catch { /* API fail — send fallback text */ }

        let wamid: string | null = null;
        if (rows.length > 0) {
          try {
            const res = await sendListMessage(accessToken, phoneNumberId, contactPhone, bodyText, btnText, [{ title: '', rows }], headerText, footerText);
            wamid = res?.messages?.[0]?.id || null;
          } catch { /**/ }
        } else {
          // Fallback: agar koi items nahi mile to plain text bhejo
          try {
            const res = await sendTextMessage(accessToken, phoneNumberId, contactPhone, bodyText + '\n\n(No options available right now, please try again later)');
            wamid = res?.messages?.[0]?.id || null;
          } catch { /**/ }
        }

        const listContent = JSON.stringify({ __type: 'list', body: bodyText, button: btnText, sections: [{ title: '', rows }], header: headerText, footer: footerText });
        await saveOutboundMessage(workspaceId, session.contact_id, listContent, wamid, 'interactive');
        // Stay on this node — user ke item select ka wait karo
        await updateSessionNode(session.id, nodeId, vars);
        return;
      }

      // ── Multi Product: send product catalog ────────────────────
      case 'multi_product': {
        const headerText = node.data.header_text ? substituteVars(node.data.header_text, vars, extras) : 'Our Products';
        const bodyText   = substituteVars(node.data.body_text || '', vars, extras);
        const footerText = node.data.footer_text ? substituteVars(node.data.footer_text, vars, extras) : undefined;
        const products   = (node.data.products || []) as { id: string; name: string; price?: string; description?: string; image_url?: string; media_id?: string }[];
        
        let wamid: string | null = null;
        if (products.length > 0) {
          try {
            const res = await sendProductMessage(accessToken, phoneNumberId, contactPhone, headerText, bodyText, products, footerText);
            wamid = res?.messages?.[0]?.id || null;
          } catch { /**/ }
        } else {
          // Fallback: agar koi products nahi to plain text bhejo
          try {
            const res = await sendTextMessage(accessToken, phoneNumberId, contactPhone, bodyText + '\n\n(No products available right now)');
            wamid = res?.messages?.[0]?.id || null;
          } catch { /**/ }
        }

        const prodContent = JSON.stringify({ __type: 'products', header: headerText, body: bodyText, products, footer: footerText });
        await saveOutboundMessage(workspaceId, session.contact_id, prodContent, wamid, 'interactive');
        // Stay on this node — user ke product select ka wait karo
        await updateSessionNode(session.id, nodeId, vars);
        return;
      }

      // ── Message: send text ─────────────────────────────────────
      case 'message': {
        const text = substituteVars(node.data.text || '', vars, extras);
        let wamid: string | null = null;
        try {
          const res = await sendTextMessage(accessToken, phoneNumberId, contactPhone, text);
          wamid = res?.messages?.[0]?.id || null;
        } catch { /* continue even if send fails */ }
        await saveOutboundMessage(workspaceId, session.contact_id, text, wamid);
        node = getNextNode(flow.edges, flow.nodes, nodeId);
        if (node) await updateSessionNode(session.id, node.id, vars);
        break;
      }

      // ── Wait: pause for user reply ────────────────────────────
      case 'wait': {
        await updateSessionNode(session.id, nodeId, vars);
        return;
      }

      // ── Condition: evaluate immediately and branch to true/false ──
      case 'condition': {
        const cVar = (node.data.condition_variable as string) || 'user_message';
        const cOp  = (node.data.condition_operator as string) || 'equal';
        const cVal = ((node.data.condition_value   as string) || '').toLowerCase();

        const varVal = (
          cVar === 'user_message'   ? userMessage :
          cVar === 'contact_phone'  ? contactPhone :
          cVar === 'contact_name'   ? contactName :
          cVar === 'current_date'   ? new Date().toISOString().slice(0, 10) :
          cVar === 'current_time'   ? new Date().toTimeString().slice(0, 5) :
          cVar === 'current_day'    ? ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'][new Date().getDay()] :
          cVar === 'current_hour'   ? String(new Date().getHours()) :
          (vars[cVar] || '')
        ).toLowerCase();

        let condMet = false;
        switch (cOp) {
          case 'equal':       condMet = varVal === cVal; break;
          case 'not_equal':   condMet = varVal !== cVal; break;
          case 'contains':    condMet = varVal.includes(cVal); break;
          case 'starts_with': condMet = varVal.startsWith(cVal); break;
          case 'any':         condMet = true; break;
          default:            condMet = varVal === cVal;
        }
        const handle = condMet ? 'true' : 'false';
        node = getNextNode(flow.edges, flow.nodes, nodeId, handle);
        if (node) await updateSessionNode(session.id, node.id, vars);
        break;
      }

      // ── Set Variable: store user reply ────────────────────────
      case 'set_variable': {
        const varName = node.data.variable_name?.trim();
        if (varName) {
          vars[varName] = userMessage;
          extras.user_message = userMessage; // keep consistent
        }
        node = getNextNode(flow.edges, flow.nodes, nodeId);
        if (node) await updateSessionNode(session.id, node.id, vars);
        break;
      }

      // ── API Call: external HTTP request ───────────────────────
      case 'api_call': {
        const url    = substituteVars(node.data.url || '', vars, extras);
        const method = node.data.method || 'POST';
        let headersObj: Record<string, string> = { 'Content-Type': 'application/json' };
        try {
          if (node.data.headers) {
            const parsed = JSON.parse(substituteVars(node.data.headers, vars, extras));
            headersObj = { ...headersObj, ...parsed };
          }
        } catch { /* invalid headers JSON, use defaults */ }

        let bodyStr: string | undefined;
        if (method !== 'GET' && node.data.body) {
          bodyStr = substituteVars(node.data.body, vars, extras);
        }

        try {
          const res = await fetch(url, {
            method,
            headers: headersObj,
            body: bodyStr,
          });
          if (node.data.save_response_as) {
            try {
              const responseText = await res.text();
              vars[node.data.save_response_as] = responseText;
            } catch { /* ignore */ }
          }
        } catch { /* API call failed, continue flow */ }

        node = getNextNode(flow.edges, flow.nodes, nodeId);
        if (node) await updateSessionNode(session.id, node.id, vars);
        break;
      }

      // ── Update Contact: update DB field ───────────────────────
      case 'update_contact': {
        const field = node.data.contact_field;
        const value = substituteVars(node.data.field_value || '', vars, extras);
        if (field && value) {
          try {
            await execute(
              `UPDATE contacts SET ${field} = ? WHERE id = ?`,
              [value, session.contact_id]
            );
            emitSSE({ type: 'chat_status_update', workspaceId, contactId: session.contact_id });
          } catch { /* ignore */ }
        }
        node = getNextNode(flow.edges, flow.nodes, nodeId);
        if (node) await updateSessionNode(session.id, node.id, vars);
        break;
      }

      // ── Delay: wait N seconds ─────────────────────────────────
      case 'delay': {
        const secs = Math.min(Number(node.data.seconds) || 1, 30);
        await new Promise((resolve) => setTimeout(resolve, secs * 1000));
        node = getNextNode(flow.edges, flow.nodes, nodeId);
        if (node) await updateSessionNode(session.id, node.id, vars);
        break;
      }

      // ── Template: send WhatsApp template ─────────────────────
      case 'template': {
        const tName = node.data.template_name;
        const tLang = node.data.language || 'en';
        if (tName) {
          try {
            const res = await sendTemplateMessage(accessToken, phoneNumberId, contactPhone, tName, tLang, []);
            const wamid = res?.messages?.[0]?.id || null;
            await saveOutboundMessage(workspaceId, session.contact_id, `[Template: ${tName}]`, wamid, 'template');
          } catch { /* continue */ }
        }
        node = getNextNode(flow.edges, flow.nodes, nodeId);
        if (node) await updateSessionNode(session.id, node.id, vars);
        break;
      }

      // ── Transfer: send to agent ───────────────────────────────
      case 'transfer': {
        const note = substituteVars(node.data.transferNote || 'Chat transferred to agent', vars, extras);
        await execute("UPDATE contacts SET chat_status = 'open' WHERE id = ?", [session.contact_id]);
        const now = utcNow();
        await insert(
          `INSERT INTO messages (workspace_id, contact_id, wamid, direction, type, content, status, sent_at, created_at)
           VALUES (?, ?, NULL, 'outbound', 'system', ?, 'delivered', ?, ?)`,
          [workspaceId, session.contact_id, note, now, now]
        );
        emitSSE({ type: 'new_message', workspaceId, contactId: session.contact_id, direction: 'outbound' });
        emitSSE({ type: 'chat_status_update', workspaceId, contactId: session.contact_id, chatStatus: 'open' });
        await endSession(session.id);
        return;
      }

      // ── End ───────────────────────────────────────────────────
      case 'end':
      default: {
        await endSession(session.id);
        return;
      }
    }
  }

  await endSession(session.id);
}

// ── Public API ───────────────────────────────────────────────────

export async function tryStartFlow(
  workspaceId:   number,
  contactId:     number,
  contactPhone:  string,
  userMessage:   string,
  accessToken:   string,
  phoneNumberId: string,
): Promise<boolean> {
  const msg = userMessage.trim().toLowerCase();

  const flows = await query<RowDataPacket[]>(
    'SELECT * FROM flows WHERE workspace_id = ? AND is_active = 1 ORDER BY id ASC',
    [workspaceId]
  );

  let matchedFlow: RowDataPacket | null = null;
  for (const row of flows) {
    const ttype    = row.trigger_type as string;
    const rawVal   = (row.trigger_value as string || '');
    // Support comma-separated keywords: "hi, hii, hello, hey"
    const keywords = rawVal.split(',').map((k: string) => k.trim().toLowerCase()).filter(Boolean);
    if (ttype === 'any') { matchedFlow = row; break; }
    if (ttype === 'keyword'     && keywords.some((k) => msg.includes(k)))    { matchedFlow = row; break; }
    if (ttype === 'starts_with' && keywords.some((k) => msg.startsWith(k)))  { matchedFlow = row; break; }
  }
  if (!matchedFlow) return false;

  const nodes: FlowNode[] = typeof matchedFlow.nodes === 'string' ? JSON.parse(matchedFlow.nodes) : matchedFlow.nodes;
  const edges: FlowEdge[] = typeof matchedFlow.edges === 'string' ? JSON.parse(matchedFlow.edges) : matchedFlow.edges;

  const targetIds  = new Set(edges.map((e) => e.target));
  const startNode  = nodes.find((n) => !targetIds.has(n.id)) || nodes[0];
  if (!startNode) return false;

  await abandonOldSessions(workspaceId, contactId);

  const sessionId = await insert(
    `INSERT INTO flow_sessions (workspace_id, contact_id, flow_id, current_node_id, variables, status)
     VALUES (?, ?, ?, ?, '{}', 'active')`,
    [workspaceId, contactId, matchedFlow.id, startNode.id]
  );

  // Get contact name
  const contactRows = await query<RowDataPacket[]>('SELECT name FROM contacts WHERE id = ? LIMIT 1', [contactId]);
  const contactName = (contactRows[0]?.name as string) || '';

  const session: FlowSession = { id: sessionId, contact_id: contactId, flow_id: matchedFlow.id as number, current_node_id: startNode.id, variables: {} };
  const flow = { ...matchedFlow, nodes, edges } as unknown as FlowDefinition;

  await executeFromNode(flow, session, startNode, accessToken, phoneNumberId, contactPhone, workspaceId, userMessage, contactName);
  return true;
}

export async function tryResumeFlow(
  workspaceId:   number,
  contactId:     number,
  contactPhone:  string,
  userMessage:   string,
  accessToken:   string,
  phoneNumberId: string,
  buttonPayload?: string, // button id when user clicked an interactive button
): Promise<boolean> {
  const sessions = await query<RowDataPacket[]>(
    "SELECT * FROM flow_sessions WHERE workspace_id = ? AND contact_id = ? AND status = 'active' ORDER BY id DESC LIMIT 1",
    [workspaceId, contactId]
  );
  if (sessions.length === 0) return false;

  const sess = sessions[0];
  const session: FlowSession = {
    id:              sess.id as number,
    contact_id:      sess.contact_id as number,
    flow_id:         sess.flow_id as number,
    current_node_id: sess.current_node_id as string,
    variables:       typeof sess.variables === 'string' ? JSON.parse(sess.variables) : sess.variables || {},
  };

  const flowRows = await query<RowDataPacket[]>('SELECT * FROM flows WHERE id = ? AND workspace_id = ? LIMIT 1', [session.flow_id, workspaceId]);
  if (flowRows.length === 0) { await endSession(session.id); return false; }

  const flowRow = flowRows[0];
  const nodes: FlowNode[] = typeof flowRow.nodes === 'string' ? JSON.parse(flowRow.nodes) : flowRow.nodes;
  const edges: FlowEdge[] = typeof flowRow.edges === 'string' ? JSON.parse(flowRow.edges) : flowRow.edges;
  const flow = { ...flowRow, nodes, edges } as unknown as FlowDefinition;

  const currentNode = getNode(nodes, session.current_node_id);
  if (!currentNode) { await endSession(session.id); return false; }

  let nextNode: FlowNode | null = null;
  // Effective match value: button payload (id) takes priority over text
  const effectiveMsg = (buttonPayload || userMessage).trim().toLowerCase();

  const contactRows0 = await query<RowDataPacket[]>('SELECT name FROM contacts WHERE id = ? LIMIT 1', [contactId]);
  const contactName  = (contactRows0[0]?.name as string) || '';

  if (currentNode.type === 'wait' || currentNode.type === 'set_variable') {
    nextNode = getNextNode(edges, nodes, currentNode.id);
  } else if (currentNode.type === 'condition') {
    const cVariable = (currentNode.data.condition_variable as string) || 'user_message';
    const cOperator = (currentNode.data.condition_operator as string) || 'equal';
    const cValue    = ((currentNode.data.condition_value as string) || '').toLowerCase();

    const varVal = (
      cVariable === 'user_message'   ? userMessage :
      cVariable === 'contact_phone'  ? contactPhone :
      cVariable === 'contact_name'   ? contactName :
      cVariable === 'current_date'   ? new Date().toISOString().slice(0,10) :
      cVariable === 'current_time'   ? new Date().toTimeString().slice(0,5) :
      cVariable === 'current_day'    ? ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'][new Date().getDay()] :
      cVariable === 'current_hour'   ? String(new Date().getHours()) :
      (session.variables[cVariable] || '')
    ).toLowerCase();

    let conditionMet = false;
    switch (cOperator) {
      case 'equal':       conditionMet = varVal === cValue; break;
      case 'not_equal':   conditionMet = varVal !== cValue; break;
      case 'contains':    conditionMet = varVal.includes(cValue); break;
      case 'starts_with': conditionMet = varVal.startsWith(cValue); break;
      case 'any':         conditionMet = true; break;
      default:            conditionMet = varVal === cValue;
    }
    const handle = conditionMet ? 'true' : 'false';
    nextNode = getNextNode(edges, nodes, currentNode.id, handle);
  } else if (currentNode.type === 'button_message' || currentNode.type === 'list_message' || currentNode.type === 'multi_product' || currentNode.type === 'media_message') {
    if (buttonPayload) {
      // User clicked a button/list item/product (interactive reply) — advance based on button ID
      nextNode = getNextNode(edges, nodes, currentNode.id, effectiveMsg)
        || getNextNode(edges, nodes, currentNode.id);
    } else {
      // Plain text received while waiting for interactive click — end session so trigger keyword can restart flow
      await endSession(session.id);
      return false;
    }
  } else if (currentNode.type === 'dynamic_list') {
    if (buttonPayload) {
      // Pehle check: kya dynamic_list ka koi connected output node hai?
      const anyNext = getNextNode(edges, nodes, currentNode.id);
      if (anyNext) {
        // Output connected hai → user ne service select ki → aage jao
        nextNode = anyNext;
      } else {
        // Output nahi → user ne purani category list se re-select kiya → re-run
        const contactRows2 = await query<RowDataPacket[]>('SELECT name FROM contacts WHERE id = ? LIMIT 1', [contactId]);
        const contactName2 = (contactRows2[0]?.name as string) || '';
        const rerunVars: Record<string, string> = { ...session.variables };
        rerunVars['selected_id']    = effectiveMsg;
        rerunVars['selected_title'] = userMessage;
        if (currentNode.data.save_id_as?.trim())    rerunVars[currentNode.data.save_id_as.trim()]    = effectiveMsg;
        if (currentNode.data.save_title_as?.trim()) rerunVars[currentNode.data.save_title_as.trim()] = userMessage;
        await updateSessionNode(session.id, currentNode.id, rerunVars);
        session.variables = rerunVars;
        await executeFromNode(flow, session, currentNode, accessToken, phoneNumberId, contactPhone, workspaceId, effectiveMsg, contactName2);
        return true;
      }
    }
  }

  if (!nextNode) {
    await endSession(session.id);
    return false;
  }

  // For button/list/product/dynamic_list — save selected_id and selected_title into session vars
  const updatedVars = { ...session.variables };
  if (
    currentNode.type === 'button_message' ||
    currentNode.type === 'list_message'   ||
    currentNode.type === 'multi_product'  ||
    currentNode.type === 'dynamic_list'
  ) {
    // Always save to default variables
    updatedVars['selected_id']    = effectiveMsg;
    updatedVars['selected_title'] = userMessage;
    // Also save to custom variable names if defined
    if (currentNode.data.save_id_as?.trim())    updatedVars[currentNode.data.save_id_as.trim()]    = effectiveMsg;
    if (currentNode.data.save_title_as?.trim()) updatedVars[currentNode.data.save_title_as.trim()] = userMessage;
  }

  await updateSessionNode(session.id, nextNode.id, updatedVars);
  const msgToPass = (
    currentNode.type === 'button_message' ||
    currentNode.type === 'list_message'   ||
    currentNode.type === 'multi_product'  ||
    currentNode.type === 'dynamic_list'
  ) ? effectiveMsg : userMessage;

  // Update session with new vars before executing
  session.variables = updatedVars;
  await executeFromNode(flow, session, nextNode, accessToken, phoneNumberId, contactPhone, workspaceId, msgToPass, contactName);
  return true;
}
