CREATE TABLE IF NOT EXISTS failed_msg_webhooks (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  workspace_id INT NOT NULL,
  name         VARCHAR(255) NOT NULL,
  campaign_id  INT NOT NULL,
  api_url      VARCHAR(500) NOT NULL,
  api_method   ENUM('POST','GET') DEFAULT 'POST',
  api_headers  TEXT DEFAULT NULL,
  is_active    TINYINT DEFAULT 1,
  created_at   DATETIME NOT NULL,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY (campaign_id)  REFERENCES campaigns(id)  ON DELETE CASCADE
) ENGINE=InnoDB;
