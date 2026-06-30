-- ============================================================
-- Super Admin (platform owner) — run once in phpMyAdmin
-- ============================================================

-- 1. Flag column on users
ALTER TABLE users
  ADD COLUMN is_super_admin TINYINT(1) NOT NULL DEFAULT 0 AFTER role;

-- 2. Make your account a super admin (apna email daalo)
-- UPDATE users SET is_super_admin = 1 WHERE email = 'your-email@example.com';

-- Note: SUPER_ADMIN_EMAILS env var me jo emails honge wo bhi
-- automatically super-admin maane jaate hain (bina is column ke bhi).
