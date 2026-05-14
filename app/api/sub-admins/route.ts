/**
 * GET  /api/sub-admins  — list sub-admins for current admin's workspaces
 * POST /api/sub-admins  — create a new sub-admin with assigned workspaces
 */
import { NextRequest } from 'next/server';
import { requireAuth, hashPassword } from '@/lib/auth';
import { query, insert } from '@/lib/db';
import { apiSuccess, apiError } from '@/lib/utils';
import { RowDataPacket } from 'mysql2';

// ── All workspace IDs where current user is admin or owner ──
async function getAdminWorkspaceIds(userId: number): Promise<number[]> {
  const rows = await query<RowDataPacket[]>(
    `SELECT DISTINCT w.id
     FROM workspaces w
     LEFT JOIN workspace_members wm ON wm.workspace_id = w.id AND wm.user_id = ?
     WHERE w.owner_id = ? OR wm.role = 'admin'`,
    [userId, userId]
  );
  return rows.map((r) => r.id as number);
}

export async function GET(req: NextRequest) {
  try {
    const payload      = requireAuth(req);
    const workspaceIds = await getAdminWorkspaceIds(payload.userId);

    if (workspaceIds.length === 0) return apiSuccess([]);

    // Fetch sub-admins tracked in sub_admins table, filtered to admin's workspaces
    const rows = await query<RowDataPacket[]>(
      `SELECT u.id, u.name, u.email, u.is_active,
              w.id    AS workspace_id,
              w.name  AS workspace_name,
              wm.role AS workspace_role
       FROM sub_admins sa
       JOIN users u              ON u.id = sa.user_id
       JOIN workspace_members wm ON wm.user_id = u.id
       JOIN workspaces w         ON w.id = wm.workspace_id
       WHERE wm.workspace_id IN (${workspaceIds.map(() => '?').join(',')})
       ORDER BY u.id, w.id`,
      workspaceIds
    );

    // Group by user
    const map = new Map<number, {
      id: number; name: string; email: string; is_active: number;
      workspaces: { id: number; name: string; role: string }[];
    }>();

    for (const r of rows) {
      const uid = r.id as number;
      if (!map.has(uid)) {
        map.set(uid, {
          id:         uid,
          name:       r.name as string,
          email:      r.email as string,
          is_active:  r.is_active as number,
          workspaces: [],
        });
      }
      map.get(uid)!.workspaces.push({
        id:   r.workspace_id as number,
        name: r.workspace_name as string,
        role: r.workspace_role as string,
      });
    }

    return apiSuccess(Array.from(map.values()));
  } catch (err) {
    if (err instanceof Error && err.message === 'UNAUTHORIZED') return apiError('Unauthorized', 401);
    console.error('[sub-admins GET]', err);
    return apiError('Server error', 500);
  }
}

export async function POST(req: NextRequest) {
  try {
    const payload      = requireAuth(req);
    const workspaceIds = await getAdminWorkspaceIds(payload.userId);
    if (workspaceIds.length === 0) return apiError('No admin workspaces found', 403);

    const { name, email, password, assigned_workspace_ids, workspace_role = 'admin' } = await req.json();

    if (!name || !email || !password) return apiError('Name, email and password are required');
    if (!Array.isArray(assigned_workspace_ids) || assigned_workspace_ids.length === 0)
      return apiError('Select at least one workspace');

    const allowed = (assigned_workspace_ids as number[])
      .map(Number)
      .filter((id) => workspaceIds.includes(id));

    if (allowed.length === 0) return apiError('No valid workspaces selected');

    const existing = await query<RowDataPacket[]>(
      'SELECT id FROM users WHERE email = ? LIMIT 1', [email]
    );
    if (existing.length > 0) return apiError('Email already exists');

    const hashed = await hashPassword(password);

    // Create user — role 'sub_admin' (requires migration_sub_admins.sql to be run)
    const userId = await insert(
      `INSERT INTO users (name, email, password, role, is_active) VALUES (?, ?, ?, 'sub_admin', 1)`,
      [name.trim(), email.trim().toLowerCase(), hashed]
    );

    // Track in sub_admins table
    await insert(
      'INSERT IGNORE INTO sub_admins (user_id, created_by) VALUES (?, ?)',
      [userId, payload.userId]
    );

    // Assign to selected workspaces
    for (const wsId of allowed) {
      await insert(
        'INSERT IGNORE INTO workspace_members (workspace_id, user_id, role) VALUES (?, ?, ?)',
        [wsId, userId, workspace_role]
      );
    }

    return apiSuccess({ id: userId, name, email, workspaces: allowed }, 201);
  } catch (err) {
    if (err instanceof Error && err.message === 'UNAUTHORIZED') return apiError('Unauthorized', 401);
    console.error('[sub-admins POST]', err);
    return apiError('Server error', 500);
  }
}
