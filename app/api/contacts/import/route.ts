/**
 * POST /api/contacts/import
 * Import contacts from CSV file
 * Expected CSV columns: name, phone, email, city, source
 */
import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { execute } from '@/lib/db';
import { apiSuccess, apiError, normalizePhone } from '@/lib/utils';
import { parse } from 'csv-parse/sync';

// Batched to avoid a SELECT+INSERT round trip per row (was up to 20,000
// sequential DB calls for a 10k-row CSV, pinning a pool connection for
// minutes). Dedup relies on the existing uq_workspace_phone unique key via
// INSERT IGNORE instead of a per-row existence check.
const CHUNK_SIZE = 500;

export async function POST(req: NextRequest) {
  try {
    const payload = await requireAuth(req);

    const formData = await req.formData();
    const file = formData.get('file') as File | null;
    if (!file) return apiError('CSV file required');

    const text = await file.text();
    const records = parse(text, {
      columns:          true,
      skip_empty_lines: true,
      trim:             true,
    }) as Record<string, string>[];

    if (records.length === 0) return apiError('CSV is empty');
    if (records.length > 10000) return apiError('Max 10,000 contacts per import');

    let skipped = 0;
    const seenPhones = new Set<string>();
    const rows: { name: string | null; phone: string; email: string | null; city: string | null; source: string }[] = [];

    for (const row of records) {
      const phone = normalizePhone(row.phone || '');
      if (!phone || seenPhones.has(phone)) { skipped++; continue; }
      seenPhones.add(phone);
      rows.push({
        name:   row.name   || null,
        phone,
        email:  row.email  || null,
        city:   row.city   || null,
        source: row.source || 'csv_import',
      });
    }

    let imported = 0;
    for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
      const chunk = rows.slice(i, i + CHUNK_SIZE);
      const placeholders = chunk.map(() => `(?, ?, ?, ?, ?, ?, 'new')`).join(', ');
      const params: unknown[] = [];
      for (const r of chunk) params.push(payload.workspaceId, r.name, r.phone, r.email, r.city, r.source);
      const affected = await execute(
        `INSERT IGNORE INTO contacts (workspace_id, name, phone, email, city, source, status) VALUES ${placeholders}`,
        params
      );
      imported += affected;
    }
    // Rows that parsed fine but hit uq_workspace_phone (already existed) — INSERT IGNORE
    // silently skips them, so the gap between attempted and inserted counts them.
    skipped += rows.length - imported;

    return apiSuccess({ imported, skipped, total: records.length });
  } catch (err: unknown) {
    if (err instanceof Error && err.message === 'UNAUTHORIZED') return apiError('Unauthorized', 401);
    console.error('[import]', err);
    return apiError('Failed to import: ' + (err instanceof Error ? err.message : 'unknown error'), 500);
  }
}
