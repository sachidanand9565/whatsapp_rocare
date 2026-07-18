-- ============================================================
-- Performance audit fix: missing indexes on hot lookup paths.
-- Run once in phpMyAdmin / mysql client. Additive only — no data changes,
-- safe to run on a live DB (ALTER TABLE ... ADD INDEX takes a metadata
-- lock briefly; on very large tables consider running in a maintenance
-- window, but these tables are well within InnoDB online-DDL range).
-- ============================================================

-- 1) workspaces: looked up by api_key / phone_number_id / verify_token / waba_id
--    on EVERY inbound Meta webhook call and every external-API request, across
--    all tenants. Currently only PRIMARY KEY(id) + KEY(owner_id) exist -> full
--    table scan per lookup.
ALTER TABLE workspaces
  ADD UNIQUE KEY uq_api_key       (api_key),
  ADD INDEX      idx_phone_number (phone_number_id),
  ADD INDEX      idx_verify_token (verify_token),
  ADD INDEX      idx_waba_id      (waba_id);

-- 2) leads: only PRIMARY KEY(id) exists. The leads list endpoint runs ~7
--    sequential full-table-scan queries per request (list, count, stage
--    counts, source counts, value totals, daily trend, campaign replies),
--    all filtered by workspace_id (+ stage/source/assigned_to/created_at).
ALTER TABLE leads
  ADD INDEX idx_ws_stage   (workspace_id, stage),
  ADD INDEX idx_ws_created (workspace_id, created_at),
  ADD INDEX idx_ws_source  (workspace_id, source),
  ADD INDEX idx_assigned   (assigned_to);

-- 3) lead_activities: only PRIMARY KEY(id) exists. Lead-detail activity feed
--    does `WHERE lead_id = ? ORDER BY created_at DESC` over 80k+ rows ->
--    full scan + filesort per lead opened.
ALTER TABLE lead_activities
  ADD INDEX idx_lead (lead_id, created_at);
