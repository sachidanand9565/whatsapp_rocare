/**
 * lib/agentEvents.ts — who got / intervened / resolved a chat, for the per-agent
 * counts on the Agents page (agent_chat_events). Logging never breaks the
 * action itself: before migration-agent-chat-events.sql runs it is a no-op.
 */
import { execute } from '@/lib/db';

export type AgentChatEvent = 'assigned' | 'intervened' | 'resolved';

export async function logAgentEvent(workspaceId: number, userId: number, contactId: number, event: AgentChatEvent) {
  try {
    await execute(
      `INSERT INTO agent_chat_events (workspace_id, user_id, contact_id, event, created_at)
       VALUES (?, ?, ?, ?, UTC_TIMESTAMP())`,
      [workspaceId, userId, contactId, event]
    );
  } catch {
    // table missing — counts just start later
  }
}

/** Bulk version: log `event` for every contact matched by `fromWhere` (… FROM contacts c WHERE …). */
export async function logAgentEventBulk(
  workspaceId: number, userId: number, event: AgentChatEvent, fromWhere: string, params: unknown[]
) {
  try {
    await execute(
      `INSERT INTO agent_chat_events (workspace_id, user_id, contact_id, event, created_at)
       SELECT ?, ?, c.id, ?, UTC_TIMESTAMP() ${fromWhere}`,
      [workspaceId, userId, event, ...params]
    );
  } catch {
    // table missing — counts just start later
  }
}
