-- ============================================================
-- Speed up Inbox/History contact lists at scale.
-- Denormalize last message times onto contacts so the list query
-- no longer runs a per-contact subquery for sorting/filtering.
-- Run once in phpMyAdmin.
-- ============================================================

-- 1) Columns
ALTER TABLE contacts
  ADD COLUMN last_message_at DATETIME NULL,
  ADD COLUMN last_inbound_at DATETIME NULL;

-- 2) Backfill from existing messages (uses the new messages indexes — fast-ish, but
--    on a large table this can take a minute or two; let it finish).
UPDATE contacts c
SET
  c.last_message_at = (SELECT MAX(m.created_at) FROM messages m WHERE m.contact_id = c.id),
  c.last_inbound_at = (SELECT MAX(m.created_at) FROM messages m WHERE m.contact_id = c.id AND m.direction = 'inbound');

-- 3) Indexes for the inbox/history list (filter + sort)
ALTER TABLE contacts
  ADD INDEX idx_ws_lastmsg (workspace_id, last_message_at),
  ADD INDEX idx_ws_lastin  (workspace_id, last_inbound_at);
