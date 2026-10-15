-- ============================================================
-- Account health alerts: email the workspace when sending breaks
-- (payment failure, number banned, token expired).
-- Run once in phpMyAdmin.
-- ============================================================

-- Per-workspace settings. A workspace with no row here still gets alerts —
-- the owner's registration email is the default recipient.
CREATE TABLE alert_settings (
  workspace_id INT NOT NULL PRIMARY KEY,
  enabled      TINYINT(1) DEFAULT 1,
  extra_emails VARCHAR(500) NULL,          -- comma-separated, besides the owner
  updated_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- One row per email actually sent — also the throttle: a repeat of the same
-- alert type within the cooldown window is skipped.
CREATE TABLE alert_log (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  workspace_id INT NOT NULL,
  alert_type   VARCHAR(40) NOT NULL,       -- payment | banned | token | other
  error_code   INT NULL,                   -- Meta error code that triggered it
  detail       VARCHAR(500) NULL,
  recipients   VARCHAR(500) NULL,
  sent_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  INDEX idx_ws_type_sent (workspace_id, alert_type, sent_at)
) ENGINE=InnoDB;
