/**
 * GET /api/analytics
 * Returns dashboard analytics summary + chart data
 */
import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { query } from '@/lib/db';
import { apiSuccess, apiError } from '@/lib/utils';
import { RowDataPacket } from 'mysql2';

export async function GET(req: NextRequest) {
  try {
    const payload = await requireAuth(req);
    const wid = payload.workspaceId;
    const isAgent = payload.role === 'agent';
    const uid = payload.userId;

    // Date range — default last 30 days
    const sp = new URL(req.url).searchParams;
    const startDate = sp.get('start_date');
    const endDate   = sp.get('end_date');
    const dateStart = startDate ? `${startDate} 00:00:00` : null;
    const dateEnd   = endDate   ? `${endDate} 23:59:59`   : null;
    const dateFilter      = dateStart && dateEnd ? `AND created_at BETWEEN ? AND ?`         : `AND created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)`;
    const dateFilterUpd   = dateStart && dateEnd ? `AND updated_at BETWEEN ? AND ?`         : `AND updated_at  >= DATE_SUB(NOW(), INTERVAL 30 DAY)`;
    const dateFilterNew   = dateStart && dateEnd ? `AND created_at BETWEEN ? AND ?`         : `AND created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)`;
    const dateParams      = dateStart && dateEnd ? [dateStart, dateEnd] : [];

    // Agent: scope to contacts in their assigned campaigns only
    const contactFilter = isAgent
      ? `AND contact_id IN (
           SELECT cc.contact_id FROM campaign_contacts cc
           JOIN campaign_assignments ca ON ca.campaign_id = cc.campaign_id
           WHERE ca.agent_id = ${uid}
         )`
      : '';

    const campaignFilter = isAgent
      ? `AND id IN (SELECT campaign_id FROM campaign_assignments WHERE agent_id = ${uid})`
      : '';

    const contactTableFilter = isAgent
      ? `AND id IN (
           SELECT cc.contact_id FROM campaign_contacts cc
           JOIN campaign_assignments ca ON ca.campaign_id = cc.campaign_id
           WHERE ca.agent_id = ${uid}
         )`
      : '';

    const [
      msgStats,
      contactStats,
      campaignStats,
      dailyMessages,
      leadConversion,
    ] = await Promise.all([
      // Message stats for selected range
      query<RowDataPacket[]>(
        `SELECT
           COUNT(*) as total,
           SUM(direction = 'outbound') as sent,
           SUM(status = 'delivered') as delivered,
           SUM(status = 'read') as read_count,
           SUM(status = 'failed') as failed
         FROM messages WHERE workspace_id = ? ${dateFilter} ${contactFilter}`,
        [wid, ...dateParams]
      ),
      // Contact stats — total is all-time, new/opted filtered by range
      query<RowDataPacket[]>(
        `SELECT
           COUNT(*) as total,
           SUM(${dateStart && dateEnd ? `created_at BETWEEN '${dateStart}' AND '${dateEnd}'` : `created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)`}) as today,
           SUM(status = 'converted') as converted,
           SUM(opted_in = 1) as opted_in
         FROM contacts WHERE workspace_id = ? ${contactTableFilter}`,
        [wid]
      ),
      // Campaign stats — all-time totals
      query<RowDataPacket[]>(
        `SELECT
           COUNT(*) as total,
           SUM(status = 'running') as active,
           SUM(status = 'completed') as completed,
           SUM(sent_count) as total_sent
         FROM campaigns WHERE workspace_id = ? ${campaignFilter}`,
        [wid]
      ),
      // Daily messages for selected range
      query<RowDataPacket[]>(
        `SELECT
           DATE(created_at) as date,
           SUM(direction = 'outbound') as sent,
           SUM(direction = 'inbound') as received
         FROM messages
         WHERE workspace_id = ? ${dateFilter} ${contactFilter}
         GROUP BY DATE(created_at)
         ORDER BY date ASC`,
        [wid, ...dateParams]
      ),
      // Lead conversions for selected range
      query<RowDataPacket[]>(
        `SELECT
           DATE(updated_at) as date,
           COUNT(*) as conversions
         FROM contacts
         WHERE workspace_id = ? AND status = 'converted'
           ${dateFilterUpd} ${contactTableFilter}
         GROUP BY DATE(updated_at)
         ORDER BY date ASC`,
        [wid, ...dateParams]
      ),
    ]);

    const m = msgStats[0] || {};
    const c = contactStats[0] || {};
    const camp = campaignStats[0] || {};

    const totalSent      = Number(m.sent || 0);
    const totalDelivered = Number(m.delivered || 0);
    const totalRead      = Number(m.read_count || 0);

    return apiSuccess({
      summary: {
        total_messages_sent:     totalSent,
        total_messages_received: Number(m.total || 0) - totalSent,
        delivery_rate:           totalSent > 0 ? Math.round((totalDelivered / totalSent) * 100) : 0,
        read_rate:               totalSent > 0 ? Math.round((totalRead / totalSent) * 100) : 0,
        total_contacts:          Number(c.total || 0),
        new_contacts_today:      Number(c.today || 0),
        opted_in_contacts:       Number(c.opted_in || 0),
        active_campaigns:        Number(camp.active || 0),
        converted_leads:         Number(c.converted || 0),
        messages_failed:         Number(m.failed || 0),
      },
      charts: {
        daily_messages:   dailyMessages,
        lead_conversions: leadConversion,
      },
    });
  } catch (err: unknown) {
    if (err instanceof Error && err.message === 'UNAUTHORIZED') return apiError('Unauthorized', 401);
    console.error('[analytics]', err);
    return apiError('Server error', 500);
  }
}
