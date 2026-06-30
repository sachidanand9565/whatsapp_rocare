/**
 * GET  /api/catalog?action=catalogs          — list connected catalogs from Meta
 * GET  /api/catalog?action=products&id=XYZ   — list products in a catalog
 * POST /api/catalog                          — save selected catalog_id to workspace
 */
import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { query, execute } from '@/lib/db';
import { apiSuccess, apiError } from '@/lib/utils';
import { RowDataPacket } from 'mysql2';

const GV = 'v20.0';

export async function GET(req: NextRequest) {
  try {
    const payload = await requireAuth(req);
    const sp      = new URL(req.url).searchParams;
    const action  = sp.get('action') || 'catalogs';

    // Get workspace access_token
    const ws = await query<RowDataPacket[]>(
      'SELECT access_token, waba_id, catalog_id FROM workspaces WHERE id = ? LIMIT 1',
      [payload.workspaceId]
    );
    if (!ws.length || !ws[0].access_token) return apiError('WhatsApp not connected', 400);
    const token = ws[0].access_token as string;

    if (action === 'catalogs') {
      // Step 1: get business accounts linked to this token
      const bizRes  = await fetch(`https://graph.facebook.com/${GV}/me/businesses?fields=id,name&access_token=${token}`);
      const bizData = await bizRes.json();
      if (bizData.error) return apiError(bizData.error.message || 'Meta API error', 400);

      const businesses = bizData.data || [];
      const allCatalogs: { id: string; name: string; business_id: string; business_name: string }[] = [];

      for (const biz of businesses) {
        const catRes  = await fetch(`https://graph.facebook.com/${GV}/${biz.id}/owned_product_catalogs?fields=id,name&access_token=${token}`);
        const catData = await catRes.json();
        for (const cat of catData.data || []) {
          allCatalogs.push({ id: cat.id, name: cat.name, business_id: biz.id, business_name: biz.name });
        }
      }

      return apiSuccess({ catalogs: allCatalogs, selected_catalog_id: ws[0].catalog_id || '' });
    }

    if (action === 'products') {
      const catalogId = sp.get('id') || '';
      if (!catalogId) return apiError('catalog id required', 400);

      const res  = await fetch(
        `https://graph.facebook.com/${GV}/${catalogId}/products?fields=retailer_id,name,description,price,currency,image_url&limit=100&access_token=${token}`
      );
      const data = await res.json();
      if (data.error) return apiError(data.error.message || 'Meta API error', 400);

      return apiSuccess({ products: data.data || [] });
    }

    return apiError('Unknown action', 400);
  } catch (err: unknown) {
    if (err instanceof Error && err.message === 'UNAUTHORIZED') return apiError('Unauthorized', 401);
    console.error('[catalog GET]', err);
    return apiError('Failed', 500);
  }
}

export async function POST(req: NextRequest) {
  try {
    const payload    = await requireAuth(req);
    const { catalog_id } = await req.json();

    // Ensure column exists (safe to run each time — IF NOT EXISTS)
    try {
      await execute('ALTER TABLE workspaces ADD COLUMN catalog_id VARCHAR(64) DEFAULT NULL', []);
    } catch { /* column already exists */ }

    await execute('UPDATE workspaces SET catalog_id = ? WHERE id = ?', [catalog_id || null, payload.workspaceId]);
    return apiSuccess({ ok: true });
  } catch (err: unknown) {
    if (err instanceof Error && err.message === 'UNAUTHORIZED') return apiError('Unauthorized', 401);
    console.error('[catalog POST]', err);
    return apiError('Failed', 500);
  }
}
