/**
 * POST /api/campaigns/[id]/bulk-queue
 * Queue all opted-in workspace contacts into an API campaign for cron-based sending.
 * Body (optional): { contact_ids: number[] }  — omit to use ALL opted-in contacts
 */
import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { query, execute, insert } from '@/lib/db';
import { apiSuccess, apiError, utcNow } from '@/lib/utils';
import { RowDataPacket } from 'mysql2';

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const payload    = await requireAuth(req);
    const campaignId = Number(params.id);
    const body       = await req.json().catch(() => ({})) as { contact_ids?: number[] };

    // Load campaign
    const camps = await query<RowDataPacket[]>(
      `SELECT c.status, c.campaign_type, w.access_token, w.phone_number_id
       FROM campaigns c JOIN workspaces w ON w.id = c.workspace_id
       WHERE c.id = ? AND c.workspace_id = ?`,
      [campaignId, payload.workspaceId]
    );
    if (camps.length === 0) return apiError('Campaign not found', 404);
    const camp = camps[0];

    if (!camp.access_token || !camp.phone_number_id) return apiError('WhatsApp API not configured', 400);
    if (camp.status === 'running') return apiError('Campaign is already running', 400);
    if (camp.status === 'completed') return apiError('Campaign already completed', 400);

    // Get contacts to queue
    let contacts: RowDataPacket[];
    if (body.contact_ids && body.contact_ids.length > 0) {
      contacts = await query<RowDataPacket[]>(
        `SELECT id FROM contacts
         WHERE workspace_id = ? AND id IN (${body.contact_ids.map(() => '?').join(',')})
           AND (opted_in IS NULL OR opted_in = 1)`,
        [payload.workspaceId, ...body.contact_ids]
      );
    } else {
      contacts = await query<RowDataPacket[]>(
        `SELECT id FROM contacts
         WHERE workspace_id = ? AND (opted_in IS NULL OR opted_in = 1)`,
        [payload.workspaceId]
      );
    }

    if (contacts.length === 0) return apiError('No opted-in contacts found', 400);

    // Insert pending rows — skip duplicates (ON DUPLICATE KEY UPDATE keeps existing status)
    const now = utcNow();
    for (const c of contacts) {
      await insert(
        `INSERT INTO campaign_contacts (campaign_id, contact_id, status, sent_at)
         VALUES (?, ?, 'pending', ?)
         ON DUPLICATE KEY UPDATE
           status   = IF(status = 'failed', 'pending', status),
           sent_at  = IF(status = 'failed', VALUES(sent_at), sent_at)`,
        [campaignId, c.id as number, now]
      );
    }

    // Update campaign totals and mark running
    const pendingCount = await query<RowDataPacket[]>(
      `SELECT COUNT(*) as cnt FROM campaign_contacts WHERE campaign_id = ? AND status = 'pending'`,
      [campaignId]
    );
    const total = Number(pendingCount[0]?.cnt || 0);

    await execute(
      `UPDATE campaigns SET status = 'running', started_at = ?, total_contacts = ? WHERE id = ?`,
      [now, total, campaignId]
    );

    return apiSuccess({ queued: contacts.length, total, message: `${contacts.length} contacts queued — cron will process them` });
  } catch (err: unknown) {
    if (err instanceof Error && err.message === 'UNAUTHORIZED') return apiError('Unauthorized', 401);
    console.error('[bulk-queue]', err);
    return apiError('Server error', 500);
  }
}
