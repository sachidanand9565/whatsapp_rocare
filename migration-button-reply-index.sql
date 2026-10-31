-- ============================================================
-- Inbox "Filter by Button Reply": index for the latest-tap-per-contact lookup
-- (app/api/contacts/button-replies). Without it MySQL walks every message of
-- the workspace (campaign sends included) to find the few inbound button taps.
-- Additive only — no data changes. messages is the biggest table: run it in a
-- quiet hour (InnoDB online DDL, but it still has to build over all rows).
-- ============================================================
ALTER TABLE messages
  ADD INDEX idx_ws_dir_type_created (workspace_id, direction, type, created_at, contact_id);
