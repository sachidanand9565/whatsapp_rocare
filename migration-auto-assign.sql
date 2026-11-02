-- ============================================================
-- Auto-assign chats (app.limbu.ai panel only).
-- Two NEW tables — no existing table is changed, so the old panel
-- (whatsapp.limbu.ai) is not affected. Auto-assign stays OFF for every
-- project until an admin turns it on from the Agents page.
-- Run once in phpMyAdmin.
-- ============================================================

-- Active / Break / Offline per user. last_seen_at is refreshed every minute
-- by an open panel; no refresh for 5 minutes counts as Offline.
CREATE TABLE IF NOT EXISTS agent_availability (
  user_id          INT PRIMARY KEY,
  status           ENUM('active','break','offline') NOT NULL DEFAULT 'offline',
  last_seen_at     DATETIME NULL,            -- UTC
  last_assigned_at DATETIME(3) NULL,         -- UTC, round-robin tie-break
  updated_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- Per project switch. max_chats = 0 → no limit.
CREATE TABLE IF NOT EXISTS auto_assign_settings (
  workspace_id INT PRIMARY KEY,
  enabled      TINYINT(1) NOT NULL DEFAULT 0,
  max_chats    INT NOT NULL DEFAULT 0,
  updated_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
) ENGINE=InnoDB;
