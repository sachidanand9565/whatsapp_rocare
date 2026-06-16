-- GMB Scraper sessions table
CREATE TABLE IF NOT EXISTS scraper_sessions (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  workspace_id INT          NOT NULL,
  city         VARCHAR(150) NOT NULL,
  category     VARCHAR(150) NOT NULL,
  places       JSON         NOT NULL,
  total_count  INT          NOT NULL DEFAULT 0,
  phone_count  INT          NOT NULL DEFAULT 0,
  created_at   TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_ws (workspace_id),
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
) ENGINE=InnoDB CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
