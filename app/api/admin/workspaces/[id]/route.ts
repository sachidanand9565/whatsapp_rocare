/**
 * GET    /api/admin/workspaces/[id] — single project full details (super-admin)
 * PATCH  /api/admin/workspaces/[id] — change plan / suspend-activate (super-admin)
 *   body: { plan?: 'free'|'pro'|'enterprise', is_active?: 0|1 }
 * DELETE /api/admin/workspaces/[id] — delete a workspace (super-admin)
 */
import { NextRequest } from 'next/server';
import { requireSuperAdmin } from '@/lib/admin';
import pool, { execute, query } from '@/lib/db';
import { apiSuccess, apiError } from '@/lib/utils';
import { RowDataPacket } from 'mysql2';

const PLANS = ['free', 'pro', 'enterprise'];

type Params = { params: { id: string } };

export async function GET(req: NextRequest, { params }: Params) {
  try {
    await requireSuperAdmin(req);
    const id = Number(params.id);
    if (!id) return apiError('Invalid id');

    const wsRows = await query<RowDataPacket[]>(
      `SELECT w.id, w.name, w.plan, w.is_active, w.phone_number_id, w.waba_id, w.created_at,
              (w.phone_number_id IS NOT NULL AND w.phone_number_id != ''
               AND w.access_token IS NOT NULL AND w.access_token != '') AS connected,
              ou.id AS owner_id, ou.name AS owner_name, ou.email AS owner_email
       FROM workspaces w LEFT JOIN users ou ON ou.id = w.owner_id
       WHERE w.id = ? LIMIT 1`,
      [id]
    );
    if (wsRows.length === 0) return apiError('Project not found', 404);

    const [counts, agents, chart] = await Promise.all([
      query<RowDataPacket[]>(
        `SELECT
           (SELECT COUNT(*) FROM workspace_members wm WHERE wm.workspace_id = ?) AS members,
           (SELECT COUNT(*) FROM workspace_members wm WHERE wm.workspace_id = ? AND wm.role='agent') AS agents,
           (SELECT COUNT(*) FROM contacts c WHERE c.workspace_id = ?)  AS contacts,
           (SELECT COUNT(*) FROM campaigns cp WHERE cp.workspace_id = ?) AS campaigns,
           (SELECT COUNT(*) FROM messages m WHERE m.workspace_id = ? AND m.direction='outbound') AS messages_sent,
           (SELECT COUNT(*) FROM messages m WHERE m.workspace_id = ? AND m.direction='inbound')  AS messages_received`,
        [id, id, id, id, id, id]
      ),
      query<RowDataPacket[]>(
        `SELECT u.id, u.name, u.email, wm.role, u.is_active
         FROM workspace_members wm JOIN users u ON u.id = wm.user_id
         WHERE wm.workspace_id = ? ORDER BY FIELD(wm.role,'admin','manager','agent'), u.name ASC`,
        [id]
      ),
      query<RowDataPacket[]>(
        `SELECT DATE(created_at) AS date, COUNT(*) AS count
         FROM messages
         WHERE workspace_id = ? AND direction='outbound' AND created_at >= DATE_SUB(NOW(), INTERVAL 14 DAY)
         GROUP BY DATE(created_at) ORDER BY date ASC`,
        [id]
      ),
    ]);

    return apiSuccess({
      project: wsRows[0],
      counts:  counts[0] || {},
      agents,
      messages14d: chart.map((r) => ({ date: String(r.date).split('T')[0], count: Number(r.count) })),
    });
  } catch (err) {
    if (err instanceof Error && err.message === 'UNAUTHORIZED') return apiError('Unauthorized', 401);
    if (err instanceof Error && err.message === 'FORBIDDEN')    return apiError('Forbidden — super admin only', 403);
    console.error('[admin/workspaces/[id] GET]', err);
    return apiError('Server error', 500);
  }
}

export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    await requireSuperAdmin(req);
    const id = Number(params.id);
    if (!id) return apiError('Invalid id');

    const body = await req.json() as { plan?: string; is_active?: number };
    const sets: string[] = [];
    const vals: unknown[] = [];

    if (body.plan !== undefined) {
      if (!PLANS.includes(body.plan)) return apiError('Invalid plan');
      sets.push('plan = ?'); vals.push(body.plan);
    }
    if (body.is_active !== undefined) {
      sets.push('is_active = ?'); vals.push(body.is_active ? 1 : 0);
    }
    if (sets.length === 0) return apiError('Nothing to update');

    vals.push(id);
    await execute(`UPDATE workspaces SET ${sets.join(', ')} WHERE id = ?`, vals);

    const rows = await query<RowDataPacket[]>(
      'SELECT id, name, plan, is_active FROM workspaces WHERE id = ? LIMIT 1', [id]
    );
    return apiSuccess(rows[0] || { id });
  } catch (err) {
    if (err instanceof Error && err.message === 'UNAUTHORIZED') return apiError('Unauthorized', 401);
    if (err instanceof Error && err.message === 'FORBIDDEN')    return apiError('Forbidden — super admin only', 403);
    console.error('[admin/workspaces PATCH]', err);
    return apiError('Server error', 500);
  }
}

export async function DELETE(req: NextRequest, { params }: Params) {
  try {
    await requireSuperAdmin(req);
    const id = Number(params.id);
    if (!id) return apiError('Invalid id');

    // Plain `DELETE FROM workspaces` fail hota hai kyunki kuch FK RESTRICT hain
    // (e.g. campaigns→templates). Isliye saare child tables ko ek transaction me
    // FK-checks off karke explicitly delete karte hain (information_schema se
    // dynamically saare workspace_id wale tables — future-proof).
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      await conn.query('SET FOREIGN_KEY_CHECKS = 0');

      // Junction tables jinme workspace_id nahi — scoped cleanup (best-effort)
      await conn.query(
        'DELETE cc FROM campaign_contacts cc JOIN campaigns c ON c.id = cc.campaign_id WHERE c.workspace_id = ?',
        [id]
      ).catch(() => {});
      await conn.query(
        'DELETE la FROM lead_activities la JOIN leads l ON l.id = la.lead_id WHERE l.workspace_id = ?',
        [id]
      ).catch(() => {});

      // Saare tables jinme workspace_id column hai
      const [cols] = await conn.query(
        `SELECT TABLE_NAME AS t FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND COLUMN_NAME = 'workspace_id' AND TABLE_NAME <> 'workspaces'`
      ) as unknown as [{ t: string }[], unknown];
      for (const row of cols) {
        await conn.query(`DELETE FROM \`${row.t}\` WHERE workspace_id = ?`, [id]).catch(() => {});
      }

      await conn.query('DELETE FROM workspaces WHERE id = ?', [id]);

      await conn.query('SET FOREIGN_KEY_CHECKS = 1');
      await conn.commit();
    } catch (e) {
      await conn.rollback().catch(() => {});
      throw e;
    } finally {
      await conn.query('SET FOREIGN_KEY_CHECKS = 1').catch(() => {});
      conn.release();
    }

    return apiSuccess({ deleted: true });
  } catch (err) {
    if (err instanceof Error && err.message === 'UNAUTHORIZED') return apiError('Unauthorized', 401);
    if (err instanceof Error && err.message === 'FORBIDDEN')    return apiError('Forbidden — super admin only', 403);
    console.error('[admin/workspaces DELETE]', err);
    return apiError('Server error', 500);
  }
}
