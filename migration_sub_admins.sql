-- ============================================================
-- Migration: Sub Admin System
-- Run this against your whatsapp_saas database
-- ============================================================

USE whatsapp_saas;

-- 1. Add 'sub_admin' to users.role ENUM
ALTER TABLE users
  MODIFY COLUMN role ENUM('admin','manager','agent','sub_admin') DEFAULT 'agent';

-- 2. Create sub_admins tracking table
--    Marks which 'manager' users are actually sub-admins (multi-project access)
CREATE TABLE IF NOT EXISTS sub_admins (
  user_id    INT NOT NULL PRIMARY KEY,
  created_by INT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id)    REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE CASCADE
);
