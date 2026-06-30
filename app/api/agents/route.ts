/**
 * GET  /api/agents  — list all agents/managers in this workspace
 * POST /api/agents  — create a new agent or manager (admin only)
 */
import { NextRequest } from 'next/server';
import { requireAuth, hashPassword } from '@/lib/auth';
import { query, insert } from '@/lib/db';
import { apiSuccess, apiError } from '@/lib/utils';
import { RowDataPacket } from 'mysql2';

export async function GET(req: NextRequest) {
  try {
    const payload = await requireAuth(req);

    const agents = await query<RowDataPacket[]>(
      `SELECT u.id, u.name, u.email, u.phone, u.role, u.is_active, u.created_at,
              wm.role AS workspace_role, u.plain_password
       FROM workspace_members wm
       JOIN users u ON u.id = wm.user_id
       WHERE wm.workspace_id = ?
         AND wm.role IN ('admin','manager','agent')
         AND wm.user_id != ?
       ORDER BY wm.role ASC, u.name ASC`,
      [payload.workspaceId, payload.userId]
    );

    return apiSuccess(agents);
  } catch (err: unknown) {
    if (err instanceof Error && err.message === 'UNAUTHORIZED') return apiError('Unauthorized', 401);
    return apiError('Server error', 500);
  }
}

export async function POST(req: NextRequest) {
  try {
    const payload = await requireAuth(req);
    if (payload.role !== 'admin') return apiError('Admin only', 403);

    const { name, email, phone, role, password } = await req.json();

    if (!name || !email || !password) return apiError('Name, email, and password are required');
    if (!['manager', 'agent'].includes(role)) return apiError('Role must be manager or agent');

    // Check if email already exists
    const existing = await query<RowDataPacket[]>(
      'SELECT id FROM users WHERE email = ? LIMIT 1',
      [email]
    );
    if (existing.length > 0) return apiError('Email already in use', 409);

    const hashed = await hashPassword(password);

    const userId = await insert(
      'INSERT INTO users (name, email, phone, password, plain_password, role) VALUES (?, ?, ?, ?, ?, ?)',
      [name, email, phone || null, hashed, password, role]
    );

    await insert(
      'INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (?, ?, ?)',
      [payload.workspaceId, userId, role]
    );

    return apiSuccess({ id: userId, name, email, phone, role }, 201);
  } catch (err: unknown) {
    if (err instanceof Error && err.message === 'UNAUTHORIZED') return apiError('Unauthorized', 401);
    console.error('[agents POST]', err);
    return apiError('Server error', 500);
  }
}
