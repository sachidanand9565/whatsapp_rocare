-- CRM Integrations: fire API on specific template button reply
CREATE TABLE IF NOT EXISTS crm_integrations (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  workspace_id INT          NOT NULL,
  name         VARCHAR(255) NOT NULL,
  template_name VARCHAR(255) NOT NULL,
  api_url      VARCHAR(500) NOT NULL,
  api_method   ENUM('POST','GET') NOT NULL DEFAULT 'POST',
  api_headers  TEXT         DEFAULT NULL,  -- JSON string e.g. {"X-API-Key":"abc"}
  is_active    TINYINT      NOT NULL DEFAULT 1,
  created_at   DATETIME     NOT NULL,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
);
