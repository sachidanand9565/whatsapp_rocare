/**
 * POST /api/leads/sync  — import existing contacts as leads (skip duplicates)
 */
import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { query, insert, execute } from '@/lib/db';
import { apiSuccess, apiError, utcNow } from '@/lib/utils';
import { RowDataPacket } from 'mysql2';

// Batched to avoid 2 sequential INSERTs per contact (was up to minutes of
// serial round trips for large workspaces). A single multi-row INSERT reserves
// a consecutive block of auto_increment ids per statement (InnoDB default
// innodb_autoinc_lock_mode), so lead_activities rows can be linked via
// firstLeadId + offset without a second round trip to read each id back.
const CHUNK_SIZE = 500;

export async function POST(req: NextRequest) {
  try {
    const payload = await requireAuth(req);
    const now = utcNow();

    // Get all contacts that don't already have a lead (match by phone)
    const contacts = await query<RowDataPacket[]>(
      `SELECT c.id, c.name, c.phone, c.source
       FROM contacts c
       WHERE c.workspace_id = ?
         AND c.phone IS NOT NULL
         AND NOT EXISTS (
           SELECT 1 FROM leads l
           WHERE l.workspace_id = c.workspace_id AND l.phone = c.phone
         )`,
      [payload.workspaceId]
    );

    if (contacts.length === 0) {
      return apiSuccess({ imported: 0, message: 'All contacts already have leads' });
    }

    let imported = 0;
    for (let i = 0; i < contacts.length; i += CHUNK_SIZE) {
      const chunk = contacts.slice(i, i + CHUNK_SIZE);

      const leadPlaceholders = chunk.map(() => `(?, ?, ?, ?, ?, 'new', ?, ?)`).join(', ');
      const leadParams: unknown[] = [];
      for (const c of chunk) {
        leadParams.push(
          payload.workspaceId,
          c.id,
          c.name || null,
          c.phone,
          c.source === 'inbound' ? 'whatsapp' : (c.source || 'manual'),
          now,
          now,
        );
      }
      const firstLeadId = await insert(
        `INSERT INTO leads (workspace_id, contact_id, name, phone, source, stage, created_at, updated_at) VALUES ${leadPlaceholders}`,
        leadParams
      );

      const activityPlaceholders = chunk.map(() => `(?, 'note', 'Lead imported from contacts', ?, ?)`).join(', ');
      const activityParams: unknown[] = [];
      chunk.forEach((_, idx) => activityParams.push(firstLeadId + idx, payload.userId, now));
      await execute(
        `INSERT INTO lead_activities (lead_id, type, description, done_by, created_at) VALUES ${activityPlaceholders}`,
        activityParams
      );

      imported += chunk.length;
    }

    return apiSuccess({ imported, total: contacts.length });
  } catch (err) {
    if (err instanceof Error && err.message === 'UNAUTHORIZED') return apiError('Unauthorized', 401);
    return apiError('Server error', 500);
  }
}
