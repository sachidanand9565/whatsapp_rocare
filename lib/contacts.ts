/**
 * lib/contacts.ts
 * Shared single-contact fetch + visibility rules for a given agent — reused
 * by both the /api/contacts list endpoint's per-row shape and the SSE push
 * path so real-time updates don't require the client to re-fetch the list.
 */
import { query } from '@/lib/db';
import { RowDataPacket } from 'mysql2';
import { Contact } from '@/types';

export interface ContactForAgentResult {
  contact:      (Contact & { last_inbound_at?: string | null }) | null;
  inInbox:      boolean;
  inIntervened: boolean;
}

const EMPTY_RESULT: ContactForAgentResult = { contact: null, inInbox: false, inIntervened: false };

/**
 * Fetches a single contact row (same shape as the /api/contacts list query)
 * and evaluates whether it currently belongs in this agent's "inbox" and/or
 * "intervened" tabs, mirroring the WHERE clauses in app/api/contacts/route.ts.
 * Returns contact: null if the contact doesn't exist, isn't in this workspace,
 * or isn't visible to this agent at all (campaign/assignment scoping).
 */
export async function getContactForAgent(
  workspaceId: number,
  contactId: number,
  userId: number,
  role: string
): Promise<ContactForAgentResult> {
  const rows = await query<RowDataPacket[]>(
    `SELECT c.*,
       (SELECT u.name FROM users u WHERE u.id = c.assigned_agent_id LIMIT 1) AS assigned_agent_name,
       (SELECT COUNT(*) FROM messages m
        WHERE m.contact_id = c.id AND m.direction = 'inbound'
          AND m.created_at > COALESCE(c.last_read_at, '2000-01-01 00:00:00')
       ) AS unread_count,
       (SELECT COUNT(*) FROM messages mi
        WHERE mi.contact_id = c.id AND mi.direction = 'inbound'
       ) AS inbound_count
     FROM contacts c WHERE c.workspace_id = ? AND c.id = ? LIMIT 1`,
    [workspaceId, contactId]
  );
  if (rows.length === 0) return EMPTY_RESULT;
  const contact = rows[0] as unknown as Contact & { last_inbound_at?: string | null };

  // Base visibility (mirrors agentFilterMain in app/api/contacts/route.ts)
  let visible = true;
  if (role === 'agent') {
    if (contact.assigned_agent_id === userId) {
      visible = true;
    } else if (contact.assigned_agent_id == null) {
      const hasCampaigns = await query<RowDataPacket[]>(
        'SELECT 1 FROM campaign_assignments WHERE agent_id = ? LIMIT 1',
        [userId]
      );
      if (hasCampaigns.length === 0) {
        visible = true;
      } else {
        const inCampaign = await query<RowDataPacket[]>(
          `SELECT 1 FROM campaign_contacts cc
           JOIN campaign_assignments ca ON ca.campaign_id = cc.campaign_id
           WHERE ca.agent_id = ? AND cc.contact_id = ? LIMIT 1`,
          [userId, contactId]
        );
        visible = inCampaign.length > 0;
      }
    } else {
      visible = false;
    }
  }
  if (!visible) return EMPTY_RESULT;

  const lastInboundAt = contact.last_inbound_at ? new Date(contact.last_inbound_at.replace(' ', 'T') + 'Z') : null;
  const within24h = !!lastInboundAt && Date.now() - lastInboundAt.getTime() < 24 * 60 * 60 * 1000;

  const inInbox = within24h && (contact.assigned_agent_id == null || contact.assigned_agent_id === userId);
  const inIntervened = contact.chat_status === 'intervened' && (role !== 'agent' || contact.assigned_agent_id === userId);

  return { contact, inInbox, inIntervened };
}
