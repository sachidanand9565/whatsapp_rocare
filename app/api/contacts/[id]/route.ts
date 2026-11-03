/**
 * GET    /api/contacts/[id]
 * PUT    /api/contacts/[id]
 * DELETE /api/contacts/[id]
 */
import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { query, execute, insert } from '@/lib/db';
import { apiSuccess, apiError, utcNow } from '@/lib/utils';
import { RowDataPacket } from 'mysql2';
import { emitSSE } from '@/lib/sse';
import { getAutoAssignSettings } from '@/lib/autoAssign';
import { logAgentEvent } from '@/lib/agentEvents';

type Params = { params: { id: string } };

export async function GET(req: NextRequest, { params }: Params) {
  try {
    const payload = await requireAuth(req);
    const rows = await query<RowDataPacket[]>(
      'SELECT * FROM contacts WHERE id = ? AND workspace_id = ?',
      [params.id, payload.workspaceId]
    );
    if (rows.length === 0) return apiError('Not found', 404);
    return apiSuccess(rows[0]);
  } catch (err: unknown) {
    if (err instanceof Error && err.message === 'UNAUTHORIZED') return apiError('Unauthorized', 401);
    return apiError('Server error', 500);
  }
}

export async function PUT(req: NextRequest, { params }: Params) {
  try {
    const payload = await requireAuth(req);
    const body = await req.json();
    const { name, email, city, source, status, tags, notes, opted_in, chat_status, transfer_to_id, reset_unread } = body;

    // Mark chat as read — store server-side timestamp so all devices stay in sync
    if (reset_unread) {
      await execute(
        'UPDATE contacts SET last_read_at = UTC_TIMESTAMP() WHERE id = ? AND workspace_id = ?',
        [params.id, payload.workspaceId]
      );
      return apiSuccess({ updated: true });
    }

    // Chat transfer — reassign contact to a specific agent
    if (transfer_to_id !== undefined) {
      // Look up target agent name (for system message)
      const [actorRows, targetRows] = await Promise.all([
        query<RowDataPacket[]>('SELECT name FROM users WHERE id = ? LIMIT 1', [payload.userId]),
        query<RowDataPacket[]>('SELECT name FROM users WHERE id = ? LIMIT 1', [transfer_to_id]),
      ]);
      const actorName  = actorRows[0]?.name  || payload.email;
      const targetName = targetRows[0]?.name || 'Unknown';

      // intervened_by stores WHO transferred (actor), so profile panel shows "Transferred By: [actor]"
      await execute(
        'UPDATE contacts SET assigned_agent_id = ?, intervened_by = ? WHERE id = ? AND workspace_id = ?',
        [transfer_to_id, actorName, params.id, payload.workspaceId]
      );
      const t = utcNow();
      await insert(
        `INSERT INTO messages (workspace_id, contact_id, direction, type, content, status, sent_at, created_at)
         VALUES (?, ?, 'outbound', 'system', ?, 'delivered', ?, ?)`,
        [payload.workspaceId, params.id, `Transferred to ${targetName} by ${actorName}`, t, t]
      );
      if (transfer_to_id) await logAgentEvent(payload.workspaceId, Number(transfer_to_id), Number(params.id), 'assigned');
      emitSSE({ type: 'chat_status_update', workspaceId: payload.workspaceId, contactId: Number(params.id), chatStatus: 'intervened' });
      return apiSuccess({ updated: true });
    }

    // Chat status transition (intervene / resolve / reopen)
    if (chat_status !== undefined) {
      // Fetch actor's name for system message
      const userRows = await query<RowDataPacket[]>(
        'SELECT name FROM users WHERE id = ? LIMIT 1',
        [payload.userId]
      );
      const actorName = userRows[0]?.name || payload.email;

      const sets: string[] = ['chat_status = ?'];
      const vals: unknown[] = [chat_status];
      if (chat_status === 'intervened') {
        // Auto-assign projects: whoever intervenes owns the chat (e.g. a pool chat
        // that came in while nobody was Active). Elsewhere: unchanged.
        const takeOver = (await getAutoAssignSettings(payload.workspaceId)).enabled;
        sets.push('intervened_by = ?', takeOver ? 'assigned_agent_id = ?' : 'assigned_agent_id = NULL');
        vals.push(actorName);
        if (takeOver) vals.push(payload.userId);
      } else if (chat_status === 'resolved' || chat_status === 'open') {
        // Clear agent assignment so next inbound is visible to all (admin + campaigns)
        sets.push('intervened_by = NULL', 'assigned_agent_id = NULL');
      }
      vals.push(params.id, payload.workspaceId);
      await execute(
        `UPDATE contacts SET ${sets.join(', ')} WHERE id = ? AND workspace_id = ?`, vals
      );

      // Agents page counts (resolving clears the agent, so log who did it)
      if (chat_status === 'intervened' || chat_status === 'resolved') {
        await logAgentEvent(payload.workspaceId, payload.userId, Number(params.id), chat_status);
      }

      // Insert system message so it appears in chat
      let systemText = '';
      if (chat_status === 'intervened') {
        systemText = `Intervened by ${actorName}`;
      } else if (chat_status === 'resolved') {
        systemText = `Closed by ${actorName}`;
      } else if (chat_status === 'open') {
        systemText = `Reopened by ${actorName}`;
      }
      if (systemText) {
        const t = utcNow();
        await insert(
          `INSERT INTO messages (workspace_id, contact_id, direction, type, content, status, sent_at, created_at)
           VALUES (?, ?, 'outbound', 'system', ?, 'delivered', ?, ?)`,
          [payload.workspaceId, params.id, systemText, t, t]
        );
      }

      emitSSE({ type: 'chat_status_update', workspaceId: payload.workspaceId, contactId: Number(params.id), chatStatus: chat_status });
      return apiSuccess({ updated: true });
    }

    // Partial update — only set fields that were actually sent in the request
    const sets: string[] = [];
    const vals: unknown[] = [];

    if (name      !== undefined) { sets.push('name = ?');     vals.push(name); }
    if (email     !== undefined) { sets.push('email = ?');    vals.push(email); }
    if (city      !== undefined) { sets.push('city = ?');     vals.push(city); }
    if (source    !== undefined) { sets.push('source = ?');   vals.push(source); }
    if (status    !== undefined) { sets.push('status = ?');   vals.push(status); }
    if (tags      !== undefined) { sets.push('tags = ?');     vals.push(JSON.stringify(tags || [])); }
    if (notes     !== undefined) { sets.push('notes = ?');    vals.push(notes); }
    if (opted_in  !== undefined) { sets.push('opted_in = ?'); vals.push(opted_in ? 1 : 0); }

    if (sets.length === 0) return apiSuccess({ updated: false });

    vals.push(params.id, payload.workspaceId);
    await execute(
      `UPDATE contacts SET ${sets.join(', ')} WHERE id = ? AND workspace_id = ?`,
      vals
    );
    return apiSuccess({ updated: true });
  } catch (err: unknown) {
    if (err instanceof Error && err.message === 'UNAUTHORIZED') return apiError('Unauthorized', 401);
    return apiError('Server error', 500);
  }
}

export async function DELETE(req: NextRequest, { params }: Params) {
  try {
    const payload = await requireAuth(req);
    await execute(
      'DELETE FROM contacts WHERE id = ? AND workspace_id = ?',
      [params.id, payload.workspaceId]
    );
    return apiSuccess({ deleted: true });
  } catch (err: unknown) {
    if (err instanceof Error && err.message === 'UNAUTHORIZED') return apiError('Unauthorized', 401);
    return apiError('Server error', 500);
  }
}
