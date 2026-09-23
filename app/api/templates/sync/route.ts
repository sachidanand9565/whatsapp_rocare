/**
 * POST /api/templates/sync
 * Pull this workspace's templates from Meta: refresh status/category/content
 * of the ones we know and import the ones that only exist on Meta.
 * Shared logic lives in lib/templateSync — the super-admin panel runs the same
 * sync for any project via /api/admin/workspaces/[id]/sync-templates.
 */
import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { apiSuccess, apiError } from '@/lib/utils';
import { syncWorkspaceTemplates, TemplateSyncError } from '@/lib/templateSync';
import axios from 'axios';

export async function POST(req: NextRequest) {
  try {
    const payload = await requireAuth(req);
    return apiSuccess(await syncWorkspaceTemplates(payload.workspaceId));
  } catch (err: unknown) {
    if (err instanceof Error && err.message === 'UNAUTHORIZED') return apiError('Unauthorized', 401);
    if (err instanceof TemplateSyncError) return apiError(err.message, 400);
    if (axios.isAxiosError(err)) {
      const errData = (err.response?.data as Record<string, unknown>)?.error as Record<string, unknown>;
      return apiError(`Meta API Error: ${(errData?.message as string) || err.message}`, 500);
    }
    console.error('[sync]', err);
    return apiError('Sync failed', 500);
  }
}
