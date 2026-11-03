-- ============================================================
-- Agents page chat counts: who got / intervened / resolved which chat.
-- Resolving a chat clears its assigned agent, so this log is the only
-- record of who resolved it. Counting starts from when this runs.
-- One NEW table (app.limbu.ai panel only) — nothing existing changes.
-- ============================================================
CREATE TABLE IF NOT EXISTS agent_chat_events (
  id           BIGINT AUTO_INCREMENT PRIMARY KEY,
  workspace_id INT NOT NULL,
  user_id      INT NOT NULL,
  contact_id   INT NOT NULL,
  event        ENUM('assigned','intervened','resolved') NOT NULL,
  created_at   DATETIME NOT NULL,              -- UTC
  INDEX idx_ws_created (workspace_id, created_at),
  INDEX idx_ws_user_event (workspace_id, user_id, event, created_at)
) ENGINE=InnoDB;
