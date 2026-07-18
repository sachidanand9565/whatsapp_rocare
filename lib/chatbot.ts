/**
 * lib/chatbot.ts
 * Chatbot rule matching — runs in workers/chatbot-worker.ts, reached only
 * when no flow claimed the incoming message (see workers/flow-worker.ts).
 */
import { query, insert } from '@/lib/db';
import { sendTextMessage } from '@/lib/whatsapp';
import { utcNow } from '@/lib/utils';
import { emitSSE } from '@/lib/sse';
import { RowDataPacket } from 'mysql2';

export async function processChatbot(
  workspaceId: number,
  contactId: number,
  text: string,
  phoneNumberId: string
): Promise<void> {
  const rules = await query<RowDataPacket[]>(
    `SELECT cr.*, w.access_token FROM chatbot_rules cr
     JOIN workspaces w ON w.id = cr.workspace_id
     WHERE cr.workspace_id = ? AND cr.is_active = 1
     ORDER BY cr.priority DESC`,
    [workspaceId]
  );

  // Get contact phone for sending reply
  const contacts = await query<RowDataPacket[]>(
    'SELECT phone FROM contacts WHERE id = ?', [contactId]
  );
  if (contacts.length === 0) return;

  const phone     = contacts[0].phone as string;
  const lowerText = text.toLowerCase().trim();

  for (const rule of rules) {
    const trigger = (rule.trigger_value as string || '').toLowerCase();
    let matched    = false;

    switch (rule.trigger_type) {
      case 'exact':       matched = lowerText === trigger; break;
      case 'keyword':     matched = lowerText.includes(trigger); break;
      case 'contains':    matched = lowerText.includes(trigger); break;
      case 'starts_with': matched = lowerText.startsWith(trigger); break;
      case 'any':         matched = true; break;
    }

    if (matched && rule.response_type === 'text' && rule.response_text) {
      const result = await sendTextMessage(
        rule.access_token as string, phoneNumberId, phone, rule.response_text as string
      );
      const wamid = result?.messages?.[0]?.id;
      if (wamid) {
        const t = utcNow();
        await insert(
          `INSERT INTO messages (workspace_id, contact_id, wamid, direction, type, content, status, sent_at, created_at)
           VALUES (?, ?, ?, 'outbound', 'text', ?, 'sent', ?, ?)`,
          [workspaceId, contactId, wamid, rule.response_text, t, t]
        );
        // Notify inbox clients so chatbot reply shows live (outbound — don't increment badge)
        emitSSE({ type: 'new_message', workspaceId, contactId, direction: 'outbound' });
      }
      break;
    }
  }
}
