-- ============================================================
-- Dynamic List node caching.
-- Stores the API response per node + resolved request (URL/body),
-- so the flow doesn't hit the external API on every message.
-- Refreshed automatically after 24h (or whatever TTL the engine uses).
-- Run once in phpMyAdmin.
-- ============================================================
CREATE TABLE IF NOT EXISTS flow_list_cache (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  workspace_id INT NOT NULL,
  node_id      VARCHAR(64) NOT NULL,           -- flow node id
  cache_key    CHAR(32) NOT NULL,              -- md5(method|url|body) — different vars → different cache
  data         MEDIUMTEXT,                     -- cached raw JSON response
  fetched_at   DATETIME NOT NULL,
  UNIQUE KEY uq_node_key (node_id, cache_key),
  INDEX idx_ws (workspace_id)
) ENGINE=InnoDB;
