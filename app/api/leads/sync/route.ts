/**
 * POST /api/leads/sync  — import existing contacts as leads (skip duplicates)
 */
import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { query, insert } from '@/lib/db';
import { apiSuccess, apiError, utcNow } from '@/lib/utils';
import { RowDataPacket } from 'mysql2';

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
    for (const c of contacts) {
      try {
        const leadId = await insert(
          `INSERT INTO leads (workspace_id, contact_id, name, phone, source, stage, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, 'new', ?, ?)`,
          [
            payload.workspaceId,
            c.id,
            c.name || null,
            c.phone,
            c.source === 'inbound' ? 'whatsapp' : (c.source || 'manual'),
            now,
            now,
          ]
        );
        await insert(
          `INSERT INTO lead_activities (lead_id, type, description, done_by, created_at) VALUES (?, ?, ?, ?, ?)`,
          [leadId, 'note', 'Lead imported from contacts', payload.userId, now]
        );
        imported++;
      } catch { /* skip duplicates */ }
    }

    return apiSuccess({ imported, total: contacts.length });
  } catch (err) {
    if (err instanceof Error && err.message === 'UNAUTHORIZED') return apiError('Unauthorized', 401);
    return apiError('Server error', 500);
  }
}
