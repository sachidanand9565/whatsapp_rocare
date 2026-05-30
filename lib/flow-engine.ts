/**
 * lib/flow-engine.ts
 * Flow execution engine — handles starting, resuming, and executing chatbot flows.
 */
import { query, insert, execute } from '@/lib/db';
import { sendTextMessage } from '@/lib/whatsapp';
import { utcNow } from '@/lib/utils';
import { emitSSE } from '@/lib/sse';
import { RowDataPacket } from 'mysql2';

// ── Types ────────────────────────────────────────────────────────

export interface FlowNode {
  id:       string;
  type:     'message' | 'wait' | 'condition' | 'transfer' | 'end';
  data:     {
    text?:        string;          // message node
    conditions?:  { value: string; label: string }[]; // condition node
    transferNote?: string;         // transfer node
  };
  position: { x: number; y: number };
}

export interface FlowEdge {
  id:           string;
  source:       string;
  target:       string;
  sourceHandle?: string | null; // condition branch: condition value or 'default'
}

export interface FlowDefinition {
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

// ── Helpers ──────────────────────────────────────────────────────

function getNode(nodes: FlowNode[], id: string): FlowNode | null {
  return nodes.find((n) => n.id === id) || null;
}

// Get the next node following an edge from source, optionally matching a handle
function getNextNode(edges: FlowEdge[], nodes: FlowNode[], sourceId: string, handle?: string): FlowNode | null {
  const edge = handle
    ? edges.find((e) => e.source === sourceId && e.sourceHandle === handle)
      || edges.find((e) => e.source === sourceId && e.sourceHandle === 'default')
      || edges.find((e) => e.source === sourceId && !e.sourceHandle)
    : edges.find((e) => e.source === sourceId);
  if (!edge) return null;
  return getNode(nodes, edge.target);
}

async function saveMessage(workspaceId: number, contactId: number, text: string, wamid: string | null) {
  const now = utcNow();
  await insert(
    `INSERT INTO messages (workspace_id, contact_id, wamid, direction, type, content, status, sent_at, created_at)
     VALUES (?, ?, ?, 'outbound', 'text', ?, 'sent', ?, ?)`,
    [workspaceId, contactId, wamid, text, now, now]
  );
  emitSSE({ type: 'new_message', workspaceId, contactId, direction: 'outbound' });
}

async function updateSession(sessionId: number, nodeId: string) {
  await execute(
    'UPDATE flow_sessions SET current_node_id = ?, updated_at = NOW() WHERE id = ?',
    [nodeId, sessionId]
  );
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

// ── Core Executor ────────────────────────────────────────────────

async function executeFromNode(
  flow:        FlowDefinition,
  session:     FlowSession,
  startNode:   FlowNode,
  accessToken: string,
  phoneNumberId: string,
  contactPhone: string,
  workspaceId: number,
): Promise<void> {
  let node: FlowNode | null = startNode;

  while (node) {
    switch (node.type) {

      case 'message': {
        const text = node.data.text || '';
        let wamid: string | null = null;
        try {
          const res = await sendTextMessage(accessToken, phoneNumberId, contactPhone, text);
          wamid = res?.messages?.[0]?.id || null;
        } catch { /* log but continue */ }
        await saveMessage(workspaceId, session.contact_id, text, wamid);
        node = getNextNode(flow.edges, flow.nodes, node.id);
        if (node) await updateSession(session.id, node.id);
        break;
      }

      case 'wait': {
        // Pause here — next user message will resume
        await updateSession(session.id, node.id);
        return;
      }

      case 'condition': {
        // Condition node itself just routes — it needs user reply
        // So we treat it like wait: pause and let resumeFlow handle branching
        await updateSession(session.id, node.id);
        return;
      }

      case 'transfer': {
        const note = node.data.transferNote || 'Flow transferred to agent';
        await execute(
          "UPDATE contacts SET chat_status = 'open' WHERE id = ?",
          [session.contact_id]
        );
        const now = utcNow();
        await insert(
          `INSERT INTO messages (workspace_id, contact_id, wamid, direction, type, content, status, sent_at, created_at)
           VALUES (?, ?, NULL, 'outbound', 'system', ?, 'delivered', ?, ?)`,
          [workspaceId, session.contact_id, note, now, now]
        );
        emitSSE({ type: 'new_message', workspaceId, contactId: session.contact_id, direction: 'outbound' });
        await endSession(session.id);
        return;
      }

      case 'end':
      default: {
        await endSession(session.id);
        return;
      }
    }
  }

  // No more nodes — session complete
  await endSession(session.id);
}

// ── Public API ───────────────────────────────────────────────────

/**
 * Check if a flow matches the incoming message and start it.
 * Returns true if a flow was started.
 */
export async function tryStartFlow(
  workspaceId:  number,
  contactId:    number,
  contactPhone: string,
  userMessage:  string,
  accessToken:  string,
  phoneNumberId: string,
): Promise<boolean> {
  const msg = userMessage.trim().toLowerCase();

  const flows = await query<RowDataPacket[]>(
    'SELECT * FROM flows WHERE workspace_id = ? AND is_active = 1 ORDER BY id ASC',
    [workspaceId]
  );

  let matchedFlow: FlowDefinition | null = null;
  for (const row of flows) {
    const f = row as RowDataPacket;
    const ttype = f.trigger_type as string;
    const tval  = (f.trigger_value as string || '').toLowerCase();
    if (ttype === 'any') { matchedFlow = f as unknown as FlowDefinition; break; }
    if (ttype === 'keyword' && msg.includes(tval)) { matchedFlow = f as unknown as FlowDefinition; break; }
    if (ttype === 'starts_with' && msg.startsWith(tval)) { matchedFlow = f as unknown as FlowDefinition; break; }
  }

  if (!matchedFlow) return false;

  const nodes: FlowNode[] = typeof matchedFlow.nodes === 'string'
    ? JSON.parse(matchedFlow.nodes) : matchedFlow.nodes;
  const edges: FlowEdge[] = typeof matchedFlow.edges === 'string'
    ? JSON.parse(matchedFlow.edges) : matchedFlow.edges;

  // Find start node (no incoming edges)
  const targetIds = new Set(edges.map((e) => e.target));
  const startNode = nodes.find((n) => !targetIds.has(n.id)) || nodes[0];
  if (!startNode) return false;

  // Abandon any existing active session for this contact
  await abandonOldSessions(workspaceId, contactId);

  // Create new session
  const sessionId = await insert(
    `INSERT INTO flow_sessions (workspace_id, contact_id, flow_id, current_node_id, variables, status)
     VALUES (?, ?, ?, ?, '{}', 'active')`,
    [workspaceId, contactId, matchedFlow.id, startNode.id]
  );

  const session: FlowSession = {
    id: sessionId, contact_id: contactId, flow_id: matchedFlow.id,
    current_node_id: startNode.id, variables: {},
  };

  await executeFromNode(
    { ...matchedFlow, nodes, edges },
    session, startNode,
    accessToken, phoneNumberId, contactPhone, workspaceId
  );

  return true;
}

/**
 * Resume an active flow session with user's reply.
 * Returns true if a session was active and handled the message.
 */
export async function tryResumeFlow(
  workspaceId:  number,
  contactId:    number,
  contactPhone: string,
  userMessage:  string,
  accessToken:  string,
  phoneNumberId: string,
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

  const flowRows = await query<RowDataPacket[]>(
    'SELECT * FROM flows WHERE id = ? AND workspace_id = ? LIMIT 1',
    [session.flow_id, workspaceId]
  );
  if (flowRows.length === 0) { await endSession(session.id); return false; }

  const flowRow = flowRows[0];
  const nodes: FlowNode[] = typeof flowRow.nodes === 'string' ? JSON.parse(flowRow.nodes) : flowRow.nodes;
  const edges: FlowEdge[] = typeof flowRow.edges === 'string' ? JSON.parse(flowRow.edges) : flowRow.edges;
  const flow = { ...flowRow, nodes, edges } as unknown as FlowDefinition;

  const currentNode = getNode(nodes, session.current_node_id);
  if (!currentNode) { await endSession(session.id); return false; }

  let nextNode: FlowNode | null = null;

  if (currentNode.type === 'wait') {
    // Simple wait — just move to next node
    nextNode = getNextNode(edges, nodes, currentNode.id);
  } else if (currentNode.type === 'condition') {
    // Match user reply to a condition branch
    const msg = userMessage.trim().toLowerCase();
    const conditions = currentNode.data.conditions || [];
    const matched = conditions.find((c) => msg === c.value.toLowerCase() || msg.includes(c.value.toLowerCase()));
    const handle = matched ? matched.value : 'default';
    nextNode = getNextNode(edges, nodes, currentNode.id, handle);
  }

  if (!nextNode) { await endSession(session.id); return false; }

  await updateSession(session.id, nextNode.id);
  await executeFromNode(flow, session, nextNode, accessToken, phoneNumberId, contactPhone, workspaceId);

  return true;
}
