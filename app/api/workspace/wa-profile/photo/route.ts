/**
 * POST /api/workspace/wa-profile/photo — change the WhatsApp display picture.
 * The file goes to Meta's resumable upload API, and the handle it returns is
 * what whatsapp_business_profile accepts as profile_picture_handle.
 */
import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { query, execute } from '@/lib/db';
import { apiSuccess, apiError } from '@/lib/utils';
import { uploadResumable, MetaUploadError } from '@/lib/metaUpload';
import { RowDataPacket } from 'mysql2';

const GRAPH   = 'https://graph.facebook.com/v20.0';
const ALLOWED = ['image/jpeg', 'image/png'];
const MAX_MB  = 5;

export async function POST(req: NextRequest) {
  try {
    const payload = await requireAuth(req);

    const rows = await query<RowDataPacket[]>(
      'SELECT phone_number_id, access_token FROM workspaces WHERE id = ? LIMIT 1',
      [payload.workspaceId]
    );
    const phoneId = (rows[0]?.phone_number_id as string) || '';
    const token   = (rows[0]?.access_token    as string) || '';
    if (!phoneId || !token) return apiError('WhatsApp number not connected — finish setup in Auth & WhatsApp', 400);

    const form = await req.formData();
    const file = form.get('file') as File | null;
    if (!file) return apiError('No file provided');
    if (!ALLOWED.includes(file.type)) {
      return apiError(`Unsupported type "${file.type || 'unknown'}" — WhatsApp profile photos must be JPG or PNG`);
    }
    if (file.size > MAX_MB * 1024 * 1024) {
      return apiError(`Image is ${(file.size / (1024 * 1024)).toFixed(1)} MB — must be under ${MAX_MB} MB`);
    }

    const handle = await uploadResumable(token, Buffer.from(await file.arrayBuffer()), file.type);

    const res  = await fetch(`${GRAPH}/${phoneId}/whatsapp_business_profile`, {
      method:  'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body:    JSON.stringify({ messaging_product: 'whatsapp', profile_picture_handle: handle }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || json?.error) {
      return apiError(`Meta: ${json?.error?.error_user_msg || json?.error?.message || `HTTP ${res.status}`}`, 400);
    }

    // Read the new URL back so the dashboard avatar updates too
    let pictureUrl = '';
    try {
      const picRes  = await fetch(
        `${GRAPH}/${phoneId}/whatsapp_business_profile?fields=profile_picture_url`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      const picJson = await picRes.json();
      pictureUrl = picJson?.data?.[0]?.profile_picture_url || '';
      if (pictureUrl) {
        await execute('UPDATE workspaces SET profile_picture_url = ? WHERE id = ?', [pictureUrl, payload.workspaceId]);
      }
    } catch { /* the photo is already live — the cached URL can wait */ }

    return apiSuccess({ updated: true, profile_picture_url: pictureUrl });
  } catch (err) {
    if (err instanceof Error && err.message === 'UNAUTHORIZED') return apiError('Unauthorized', 401);
    if (err instanceof MetaUploadError) return apiError(err.message, 400);
    console.error('[wa-profile photo]', err);
    return apiError('Server error', 500);
  }
}
