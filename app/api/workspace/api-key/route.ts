/**
 * GET  /api/workspace/api-key  — fetch current API key
 * POST /api/workspace/api-key  — regenerate API key
 */
import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { query, execute } from '@/lib/db';
import { apiSuccess, apiError } from '@/lib/utils';
import { RowDataPacket } from 'mysql2';
import { randomBytes } from 'crypto';

export async function GET(req: NextRequest) {
  try {
    const payload = await requireAuth(req);
    const rows = await query<RowDataPacket[]>(
      'SELECT api_key FROM workspaces WHERE id = ? LIMIT 1',
      [payload.workspaceId]
    );
    let apiKey = rows[0]?.api_key as string | null;

    // Auto-generate if column exists but key is not set yet
    if (!apiKey) {
      const newKey = 'ws_' + randomBytes(24).toString('hex');
      try {
        await execute('UPDATE workspaces SET api_key = ? WHERE id = ?', [newKey, payload.workspaceId]);
        apiKey = newKey;
      } catch {
        // Column may not exist yet — return null, settings page will show migration hint
        return apiSuccess({ api_key: null });
      }
    }

    return apiSuccess({ api_key: apiKey });
  } catch (err: unknown) {
    if (err instanceof Error && err.message === 'UNAUTHORIZED') return apiError('Unauthorized', 401);
    return apiError('Server error', 500);
  }
}

export async function POST(req: NextRequest) {
  try {
    const payload = await requireAuth(req);
    if (payload.role !== 'admin') return apiError('Only admins can regenerate API keys', 403);

    const newKey = 'ws_' + randomBytes(24).toString('hex');
    await execute(
      'UPDATE workspaces SET api_key = ? WHERE id = ?',
      [newKey, payload.workspaceId]
    );
    return apiSuccess({ api_key: newKey });
  } catch (err: unknown) {
    if (err instanceof Error && err.message === 'UNAUTHORIZED') return apiError('Unauthorized', 401);
    return apiError('Server error', 500);
  }
}
