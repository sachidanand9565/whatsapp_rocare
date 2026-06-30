-- ============================================================
-- Serverless-safe "logout all sessions on password change".
-- Stores a per-user cutoff: tokens issued BEFORE this unix-time are rejected.
-- Run once in phpMyAdmin.
-- ============================================================
ALTER TABLE users ADD COLUMN tokens_valid_from BIGINT NULL;
