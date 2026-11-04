-- ============================================================
-- Calls ringing right now, shared by every server instance.
-- app.limbu.ai runs on Vercel: each relayed call event reaches only one
-- instance, so an in-memory list missed calls (two calls at once → one
-- never popped up). Rows live ~75s; the panel polls them every few seconds.
-- One NEW table (app.limbu.ai panel only) — nothing existing changes.
-- ============================================================
CREATE TABLE IF NOT EXISTS ringing_calls (
  call_id      VARCHAR(120) PRIMARY KEY,           -- Meta wacid
  workspace_id INT NOT NULL,
  contact_id   INT NULL,
  caller_name  VARCHAR(255) NOT NULL DEFAULT '',
  caller_phone VARCHAR(32)  NOT NULL DEFAULT '',
  sdp          MEDIUMTEXT NULL,                     -- caller's SDP offer, needed to answer
  created_at   DATETIME(3) NOT NULL,                -- UTC
  INDEX idx_ws_created (workspace_id, created_at)
) ENGINE=InnoDB;
