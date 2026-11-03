-- ============================================================
-- Auto-assign: which agents/managers get chats automatically
-- (the "Auto Assign" toggle on the Agents page). Run AFTER
-- migration-auto-assign.sql. One NEW table — nothing existing changes.
-- ============================================================
CREATE TABLE IF NOT EXISTS auto_assign_agents (
  workspace_id INT NOT NULL,
  user_id      INT NOT NULL,
  created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (workspace_id, user_id),
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id)      REFERENCES users(id)      ON DELETE CASCADE
) ENGINE=InnoDB;
