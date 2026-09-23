/**
 * POST /api/admin/workspaces/[id]/sync-templates — pull this project's
 * templates from Meta (super-admin only).
 * Refreshes status/category/content of known templates and imports the ones
 * that exist only on Meta. Project users cannot trigger this.
 */
import { NextRequest } from 'next/server';
import { requireSuperAdmin } from '@/lib/admin';
import { apiSuccess, apiError } from '@/lib/utils';
import { syncWorkspaceTemplates, TemplateSyncError } from '@/lib/templateSync';
import axios from 'axios';

type Params = { params: { id: string } };

export async function POST(req: NextRequest, { params }: Params) {
  try {
    await requireSuperAdmin(req);
    const id = Number(params.id);
    if (!id) return apiError('Invalid id');

    return apiSuccess(await syncWorkspaceTemplates(id));
  } catch (err: unknown) {
    if (err instanceof Error && err.message === 'UNAUTHORIZED') return apiError('Unauthorized', 401);
    if (err instanceof Error && err.message === 'FORBIDDEN')    return apiError('Forbidden', 403);
    if (err instanceof TemplateSyncError)                       return apiError(err.message, 400);
    if (axios.isAxiosError(err)) {
      const errData = (err.response?.data as Record<string, unknown>)?.error as Record<string, unknown>;
      return apiError(`Meta API Error: ${(errData?.message as string) || err.message}`, 500);
    }
    console.error('[admin/sync-templates]', err);
    return apiError('Sync failed', 500);
  }
}
