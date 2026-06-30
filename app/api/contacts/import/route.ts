/**
 * POST /api/contacts/import
 * Import contacts from CSV file
 * Expected CSV columns: name, phone, email, city, source
 */
import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { insert, query } from '@/lib/db';
import { apiSuccess, apiError, normalizePhone } from '@/lib/utils';
import { parse } from 'csv-parse/sync';
import { RowDataPacket } from 'mysql2';

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

    let imported = 0;
    let skipped  = 0;

    for (const row of records) {
      const phone = normalizePhone(row.phone || '');
      if (!phone) { skipped++; continue; }

      // Check duplicate
      const existing = await query<RowDataPacket[]>(
        'SELECT id FROM contacts WHERE workspace_id = ? AND phone = ?',
        [payload.workspaceId, phone]
      );
      if (existing.length > 0) { skipped++; continue; }

      await insert(
        `INSERT INTO contacts (workspace_id, name, phone, email, city, source, status)
         VALUES (?, ?, ?, ?, ?, ?, 'new')`,
        [
          payload.workspaceId,
          row.name || null, phone,
          row.email || null, row.city || null,
          row.source || 'csv_import',
        ]
      );
      imported++;
    }

    return apiSuccess({ imported, skipped, total: records.length });
  } catch (err: unknown) {
    if (err instanceof Error && err.message === 'UNAUTHORIZED') return apiError('Unauthorized', 401);
    console.error('[import]', err);
    return apiError('Failed to import: ' + (err instanceof Error ? err.message : 'unknown error'), 500);
  }
}
