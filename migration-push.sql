-- Web Push notifications (incoming-call alerts on mobile / closed tabs)
-- Run once. Code degrades gracefully until this runs (pushes just skip).

-- One row per browser/device an agent enabled notifications on.
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id           BIGINT AUTO_INCREMENT PRIMARY KEY,
  workspace_id INT NOT NULL,
  user_id      INT NOT NULL,
  endpoint     VARCHAR(512) NOT NULL,        -- browser push service URL (unique per device)
  p256dh       VARCHAR(255) NOT NULL,        -- encryption keys from the browser
  auth         VARCHAR(64)  NOT NULL,
  created_at   DATETIME NOT NULL,
  UNIQUE KEY uq_endpoint (endpoint(191)),
  INDEX idx_ws (workspace_id)
);

-- Server-wide VAPID keypair, generated automatically on first use — no env needed.
CREATE TABLE IF NOT EXISTS push_vapid (
  id          TINYINT PRIMARY KEY,           -- always 1
  public_key  VARCHAR(255) NOT NULL,
  private_key VARCHAR(255) NOT NULL,
  created_at  DATETIME NOT NULL
);
