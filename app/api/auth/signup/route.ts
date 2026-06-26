/**
 * POST /api/auth/signup
 * Create new user + workspace
 */
import { NextRequest } from 'next/server';
import { hashPassword, signToken, signHandoffCode } from '@/lib/auth';
import { insert, query } from '@/lib/db';
import { apiSuccess, apiError } from '@/lib/utils';
import { RowDataPacket } from 'mysql2';

export async function POST(req: NextRequest) {
  try {
    const { name, email, password, workspaceName } = await req.json();

    if (!name || !email || !password || !workspaceName) {
      return apiError('All fields are required');
    }
    if (password.length < 8) {
      return apiError('Password must be at least 8 characters');
    }

    // Check duplicate email
    const existing = await query<RowDataPacket[]>('SELECT id FROM users WHERE email = ?', [email]);
    if (existing.length > 0) return apiError('Email already registered', 409);

    const hashed = await hashPassword(password);

    // Create user
    const userId = await insert(
      'INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, ?)',
      [name, email, hashed, 'admin']
    );

    // Create default workspace
    const workspaceId = await insert(
      'INSERT INTO workspaces (owner_id, name, verify_token) VALUES (?, ?, ?)',
      [userId, workspaceName, `vt_${Date.now()}`]
    );

    // Add user as workspace admin member
    await insert(
      'INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (?, ?, ?)',
      [workspaceId, userId, 'admin']
    );

    const token = signToken({ userId, email, role: 'admin', workspaceId });
    // Cross-domain redirect ke liye short-lived handoff code (e.g. limbu.ai -> whatsapp.limbu.ai/auth/sso)
    const handoffCode = signHandoffCode({ userId, email, role: 'admin', workspaceId });

    const response = apiSuccess({ token, userId, workspaceId, handoffCode }, 201);
    response.cookies.set('token', token, {
      httpOnly: true,
      secure:   process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge:   60 * 60 * 24 * 7, // 7 days
      path:     '/',
    });
    return response;
  } catch (err) {
    console.error('[signup]', err);
    return apiError('Internal server error', 500);
  }
}
