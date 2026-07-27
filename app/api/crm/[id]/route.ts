/**
 * PATCH  /api/crm/[id]  — toggle active / update
 * DELETE /api/crm/[id]  — delete integration
 */
import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { execute } from '@/lib/db';
import { apiSuccess, apiError } from '@/lib/utils';

type Ctx = { params: { id: string } };

export async function PATCH(req: NextRequest, { params }: Ctx) {
  try {
    const payload = await requireAuth(req);
    const body = await req.json();
    const id = Number(params.id);

    // Build UPDATE from whichever editable fields are present in the body
    const fields: string[]  = [];
    const values: unknown[] = [];
    if ('is_active' in body)     { fields.push('is_active = ?');     values.push(body.is_active); }
    if ('name' in body)          { fields.push('name = ?');          values.push(body.name); }
    if ('template_name' in body) { fields.push('template_name = ?'); values.push(body.template_name); }
    if ('api_url' in body)       { fields.push('api_url = ?');       values.push(body.api_url); }
    if ('api_method' in body)    { fields.push('api_method = ?');    values.push(body.api_method === 'GET' ? 'GET' : 'POST'); }
    if ('api_headers' in body)   { fields.push('api_headers = ?');   values.push(body.api_headers || null); }

    if (fields.length === 0) return apiError('No fields to update', 400);

    await execute(
      `UPDATE crm_integrations SET ${fields.join(', ')} WHERE id = ? AND workspace_id = ?`,
      [...values, id, payload.workspaceId]
    );
    return apiSuccess({ updated: true });
  } catch (err) {
    if (err instanceof Error && err.message === 'UNAUTHORIZED') return apiError('Unauthorized', 401);
    return apiError('Server error', 500);
  }
}

export async function DELETE(req: NextRequest, { params }: Ctx) {
  try {
    const payload = await requireAuth(req);
    await execute(
      'DELETE FROM crm_integrations WHERE id = ? AND workspace_id = ?',
      [Number(params.id), payload.workspaceId]
    );
    return apiSuccess({ deleted: true });
  } catch (err) {
    if (err instanceof Error && err.message === 'UNAUTHORIZED') return apiError('Unauthorized', 401);
    return apiError('Server error', 500);
  }
}
