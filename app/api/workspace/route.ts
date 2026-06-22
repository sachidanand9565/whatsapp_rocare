/**
 * GET /api/workspace  — get workspace settings
 * PUT /api/workspace  — update workspace settings
 */
import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { query, execute } from '@/lib/db';
import { apiSuccess, apiError } from '@/lib/utils';
import { RowDataPacket } from 'mysql2';

export async function GET(req: NextRequest) {
  try {
    const payload = requireAuth(req);

    // Try with phone_display column, fallback if column doesn't exist yet
    let rows: RowDataPacket[];
    try {
      rows = await query<RowDataPacket[]>(
        `SELECT id, name, phone_number_id, phone_display, waba_id, verify_token, plan, is_active, access_token, profile_picture_url
         FROM workspaces WHERE id = ?`,
        [payload.workspaceId]
      );
    } catch {
      rows = await query<RowDataPacket[]>(
        `SELECT id, name, phone_number_id, waba_id, verify_token, plan, is_active, access_token
         FROM workspaces WHERE id = ?`,
        [payload.workspaceId]
      );
    }

    if (rows.length === 0) return apiError('Workspace not found', 404);
    const ws = rows[0];

    // Auto-fetch display phone number if missing but credentials exist
    if (!ws.phone_display && ws.phone_number_id && ws.access_token) {
      try {
        const metaRes = await fetch(
          `https://graph.facebook.com/v20.0/${ws.phone_number_id}?fields=display_phone_number,verified_name&access_token=${ws.access_token}`
        );
        const metaData = await metaRes.json();
        if (metaData.display_phone_number) {
          ws.phone_display = metaData.display_phone_number;
          await execute(
            'UPDATE workspaces SET phone_display = ? WHERE id = ?',
            [metaData.display_phone_number, ws.id]
          ).catch(() => { /* ignore if column missing */ });
        }
      } catch { /* ignore — Meta API unavailable */ }
    }

    // Auto-fetch WhatsApp Business profile picture if missing
    if (!ws.profile_picture_url && ws.phone_number_id && ws.access_token) {
      try {
        const picRes = await fetch(
          `https://graph.facebook.com/v20.0/${ws.phone_number_id}/whatsapp_business_profile?fields=profile_picture_url&access_token=${ws.access_token}`
        );
        const picData = await picRes.json();
        const picUrl = picData?.data?.[0]?.profile_picture_url;
        if (picUrl) {
          ws.profile_picture_url = picUrl;
          await execute(
            'UPDATE workspaces SET profile_picture_url = ? WHERE id = ?',
            [picUrl, ws.id]
          ).catch(() => { /* ignore if column missing */ });
        }
      } catch { /* ignore — Meta API unavailable */ }
    }

    // Never expose access_token to frontend
    const { access_token: _token, ...safeWs } = ws;
    void _token;
    return apiSuccess(safeWs);
  } catch (err: unknown) {
    if (err instanceof Error && err.message === 'UNAUTHORIZED') return apiError('Unauthorized', 401);
    return apiError('Server error', 500);
  }
}

export async function PUT(req: NextRequest) {
  try {
    const payload = requireAuth(req);
    if (payload.role !== 'admin') return apiError('Admin only', 403);

    const { name, phone_number_id, waba_id, access_token } = await req.json();

    // Phone number (or its credentials) changed — refresh the cached display number
    // from Meta so it doesn't keep showing the old number after a switch.
    let phone_display: string | null = null;
    if (phone_number_id && access_token) {
      try {
        const metaRes = await fetch(
          `https://graph.facebook.com/v20.0/${phone_number_id}?fields=display_phone_number&access_token=${access_token}`
        );
        const metaData = await metaRes.json();
        phone_display = metaData.display_phone_number || null;
      } catch { /* ignore — Meta API unavailable, falls back to null */ }
    }

    await execute(
      `UPDATE workspaces SET name=?, phone_number_id=?, waba_id=?, access_token=?, phone_display=? WHERE id = ?`,
      [name, phone_number_id, waba_id, access_token, phone_display, payload.workspaceId]
    );
    return apiSuccess({ updated: true });
  } catch (err: unknown) {
    if (err instanceof Error && err.message === 'UNAUTHORIZED') return apiError('Unauthorized', 401);
    return apiError('Server error', 500);
  }
}
