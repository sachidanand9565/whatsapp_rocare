/**
 * GET    /api/campaigns/[id]  — campaign detail
 * DELETE /api/campaigns/[id]  — delete campaign + contacts
 */
import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { query, execute } from '@/lib/db';
import { apiSuccess, apiError } from '@/lib/utils';
import { RowDataPacket } from 'mysql2';

type Params = { params: { id: string } };

const VALID_STATUSES = ['all', 'sent', 'delivered', 'read', 'failed', 'pending', 'replied'];

export async function GET(req: NextRequest, { params }: Params) {
  try {
    const payload    = await requireAuth(req);
    const campaignId = Number(params.id);
    const url        = new URL(req.url);

    const rawStatus = url.searchParams.get('status') || 'all';
    const status    = VALID_STATUSES.includes(rawStatus) ? rawStatus : 'all';
    const page      = Math.max(1, Number(url.searchParams.get('page') || 1));
    const limit     = Math.min(100, Math.max(1, Number(url.searchParams.get('limit') || 50)));
    const offset    = (page - 1) * limit;
    const dateFrom  = url.searchParams.get('dateFrom') || null;
    const dateTo    = url.searchParams.get('dateTo')   || null;

    // ── Campaign row ────────────────────────────────────────
    const camps = await query<RowDataPacket[]>(
      `SELECT c.*, t.name as template_name, t.language, t.body_text, t.buttons,
              t.header_type, t.header_content, t.footer_text
       FROM campaigns c
       JOIN templates t ON t.id = c.template_id
       WHERE c.id = ? AND c.workspace_id = ?`,
      [campaignId, payload.workspaceId]
    );
    if (camps.length === 0) return apiError('Campaign not found', 404);
    const campaign = camps[0];

    // ── Accurate counts from messages table (every individual send) ──
    const countRows = await query<RowDataPacket[]>(
      `SELECT
        COALESCE(SUM(status IN ('sent','delivered','read')), 0) AS sent,
        COALESCE(SUM(status IN ('delivered','read')),        0) AS delivered,
        COALESCE(SUM(status = 'read'),                       0) AS \`read\`,
        COALESCE(SUM(status = 'failed'),                     0) AS failed,
        COALESCE(SUM(status = 'queued'),                     0) AS pending
       FROM messages
       WHERE campaign_id = ? AND direction = 'outbound'`,
      [campaignId]
    );

    // ── Reply count ─────────────────────────────────────────
    const replyRows = await query<RowDataPacket[]>(
      `SELECT COUNT(DISTINCT m.contact_id) AS replied
       FROM messages m
       INNER JOIN campaign_contacts cc ON cc.contact_id = m.contact_id AND cc.campaign_id = ?
       WHERE m.direction = 'inbound'
         AND m.workspace_id = ?
         AND m.created_at >= (SELECT COALESCE(started_at, created_at) FROM campaigns WHERE id = ?)`,
      [campaignId, payload.workspaceId, campaignId]
    );

    // Rows that failed BEFORE a message row was created (Meta rejected the send,
    // opted-out skip, etc.) only exist in campaign_contacts — include them so a
    // fully-failed campaign doesn't show all zeros. Same for still-pending rows.
    const ccCountRows = await query<RowDataPacket[]>(
      `SELECT
        COALESCE(SUM(status = 'failed' AND message_id IS NULL), 0) AS failed_no_msg,
        COALESCE(SUM(status = 'pending'),                       0) AS pending
       FROM campaign_contacts WHERE campaign_id = ?`,
      [campaignId]
    );

    const counts = {
      sent:      Number(countRows[0]?.sent      || 0),
      delivered: Number(countRows[0]?.delivered || 0),
      read:      Number(countRows[0]?.read      || 0),
      failed:    Number(countRows[0]?.failed    || 0) + Number(ccCountRows[0]?.failed_no_msg || 0),
      pending:   Number(countRows[0]?.pending   || 0) + Number(ccCountRows[0]?.pending       || 0),
      replied:   Number(replyRows[0]?.replied   || 0),
    };

    // ── Most common failure reason (shown as a banner on the detail page) ──
    let failure_reason: string | null = null;
    if (counts.failed > 0) {
      const topErr = await query<RowDataPacket[]>(
        `SELECT error, COUNT(*) AS cnt FROM campaign_contacts
         WHERE campaign_id = ? AND status = 'failed' AND error IS NOT NULL AND error <> ''
         GROUP BY error ORDER BY cnt DESC LIMIT 1`,
        [campaignId]
      );
      if (topErr.length > 0) failure_reason = topErr[0].error as string;
    }

    // ── Daily chart — per-status counts per day ─────────────
    const chartFrom = dateFrom || (() => { const d = new Date(); d.setDate(d.getDate() - 7); return d.toISOString().split('T')[0]; })();
    const chartTo   = dateTo   || new Date().toISOString().split('T')[0];

    const daily = await query<RowDataPacket[]>(
      `SELECT
         DATE(cc.sent_at)                                            AS date,
         COALESCE(SUM(cc.status IN ('sent','delivered','read')), 0)  AS sent,
         COALESCE(SUM(cc.status IN ('delivered','read')),        0)  AS delivered,
         COALESCE(SUM(cc.status = 'read'),                       0)  AS \`read\`,
         COALESCE(SUM(cc.status = 'failed'),                     0)  AS failed
       FROM campaign_contacts cc
       WHERE cc.campaign_id = ? AND cc.sent_at BETWEEN ? AND ?
       GROUP BY DATE(cc.sent_at)
       ORDER BY date ASC`,
      [campaignId, chartFrom, `${chartTo} 23:59:59`]
    );
    const dailyNorm = daily.map(r => ({
      date:      String(r.date).split('T')[0],
      sent:      Number(r.sent      || 0),
      delivered: Number(r.delivered || 0),
      read:      Number(r.read      || 0),
      failed:    Number(r.failed    || 0),
    }));

    // ── Build status clause (safe — no string interpolation of user input) ──
    const isRepliedFilter = status === 'replied';
    let statusClause = '';
    const statusParams: (string | number)[] = [];

    if (!isRepliedFilter && status !== 'all') {
      if (status === 'sent') {
        statusClause = `AND cc.status IN ('sent','delivered','read')`;
      } else if (status === 'delivered') {
        statusClause = `AND cc.status IN ('delivered','read')`;
      } else {
        statusClause = `AND cc.status = ?`;
        statusParams.push(status);
      }
    }

    // ── Date clause ─────────────────────────────────────────
    let dateClause = '';
    const dateParams_: (string | number)[] = [];
    if (dateFrom && dateTo) {
      dateClause = `AND cc.sent_at BETWEEN ? AND ?`;
      dateParams_.push(dateFrom, `${dateTo} 23:59:59`);
    }

    // ── Replied join ────────────────────────────────────────
    const repliedJoin = `LEFT JOIN (
      SELECT DISTINCT m2.contact_id
      FROM messages m2
      INNER JOIN campaign_contacts cc2 ON cc2.contact_id = m2.contact_id AND cc2.campaign_id = ?
      WHERE m2.direction = 'inbound' AND m2.workspace_id = ?
        AND m2.created_at >= (SELECT COALESCE(started_at, created_at) FROM campaigns WHERE id = ?)
    ) replied_contacts ON replied_contacts.contact_id = cc.contact_id`;
    const repliedFilter = isRepliedFilter ? 'AND replied_contacts.contact_id IS NOT NULL' : '';

    // ── Contact list ────────────────────────────────────────
    const contacts = await query<RowDataPacket[]>(
      `SELECT cc.id, cc.status, cc.error, cc.sent_at,
              COALESCE(c.name, c.phone) AS name, c.phone,
              m.wamid,
              (replied_contacts.contact_id IS NOT NULL) AS has_replied
       FROM campaign_contacts cc
       JOIN contacts c ON c.id = cc.contact_id
       LEFT JOIN messages m ON m.id = cc.message_id
       ${repliedJoin}
       WHERE cc.campaign_id = ? ${statusClause} ${dateClause} ${repliedFilter}
       ORDER BY cc.sent_at DESC, cc.id DESC
       LIMIT ? OFFSET ?`,
      [campaignId, payload.workspaceId, campaignId, campaignId, ...statusParams, ...dateParams_, limit, offset]
    );

    const totalRows = await query<RowDataPacket[]>(
      `SELECT COUNT(*) AS total
       FROM campaign_contacts cc
       ${repliedJoin}
       WHERE cc.campaign_id = ? ${statusClause} ${dateClause} ${repliedFilter}`,
      [campaignId, payload.workspaceId, campaignId, campaignId, ...statusParams, ...dateParams_]
    );
    const total = Number(totalRows[0]?.total || 0);

    return apiSuccess({
      campaign,
      counts,
      failure_reason,
      daily: dailyNorm,
      contacts,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    });
  } catch (err: unknown) {
    if (err instanceof Error && err.message === 'UNAUTHORIZED') return apiError('Unauthorized', 401);
    console.error('[campaign detail]', err);
    return apiError('Server error', 500);
  }
}

export async function DELETE(req: NextRequest, { params }: Params) {
  try {
    const payload    = await requireAuth(req);
    const campaignId = Number(params.id);
    if (!campaignId || isNaN(campaignId)) return apiError('Invalid id', 400);

    const rows = await query<RowDataPacket[]>(
      'SELECT id, status FROM campaigns WHERE id = ? AND workspace_id = ? LIMIT 1',
      [campaignId, payload.workspaceId]
    );
    if (rows.length === 0) return apiError('Campaign not found', 404);

    if (rows[0].status === 'running') {
      return apiError('Cannot delete a running campaign. Wait for it to complete.', 409);
    }

    await execute('DELETE FROM campaign_contacts WHERE campaign_id = ?', [campaignId]);
    await execute('DELETE FROM campaigns WHERE id = ? AND workspace_id = ?', [campaignId, payload.workspaceId]);

    return apiSuccess({ deleted: true });
  } catch (err: unknown) {
    if (err instanceof Error && err.message === 'UNAUTHORIZED') return apiError('Unauthorized', 401);
    console.error('[campaign DELETE]', err);
    return apiError('Server error', 500);
  }
}
