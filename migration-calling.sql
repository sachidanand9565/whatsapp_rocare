-- ============================================================
-- WhatsApp Business Calling API (Phase 1) — run once in phpMyAdmin
-- ============================================================

-- Per-workspace calling preferences.
--   calling_enabled            : mirror of Meta's calling.status for the phone number
--   missed_call_template       : template sent automatically after a missed inbound
--                                call (lets agents reply even outside the 24h window).
--                                NULL = auto-reply off.
--   missed_call_template_lang  : language code of that template
ALTER TABLE workspaces
  ADD COLUMN calling_enabled           TINYINT(1)   NOT NULL DEFAULT 0,
  ADD COLUMN missed_call_template      VARCHAR(255) NULL,
  ADD COLUMN missed_call_template_lang VARCHAR(16)  NULL DEFAULT 'en';

-- Call records live in `messages` (type = 'call', wamid = 'call_<wacid>');
-- messages.wamid is already UNIQUE, no schema change needed there.

-- ------------------------------------------------------------
-- Call history (Calls page). One row per call; the webhook fills
-- start/end/duration on terminate, the inbox fills agent on answer/place.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS call_logs (
  id            BIGINT AUTO_INCREMENT PRIMARY KEY,
  workspace_id  INT NOT NULL,
  contact_id    INT NULL,
  call_id       VARCHAR(120) NOT NULL,                       -- Meta wacid
  direction     ENUM('inbound','outbound') NOT NULL,
  status        ENUM('ringing','completed','missed','rejected','failed') NOT NULL DEFAULT 'ringing',
  agent_id      INT NULL,                                    -- user who answered / placed the call
  started_at    DATETIME NULL,                               -- ring start
  answered_at   DATETIME NULL,
  ended_at      DATETIME NULL,
  duration_sec  INT NOT NULL DEFAULT 0,
  created_at    DATETIME NOT NULL,
  UNIQUE KEY uq_call (call_id),
  INDEX idx_ws_created (workspace_id, created_at),
  INDEX idx_ws_contact (workspace_id, contact_id)
);
