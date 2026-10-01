-- ============================================================
-- Email OTP verification for signup.
-- Rows are created BEFORE the user exists, so there is no user_id here.
-- The code itself is never stored — only a SHA-256 hash.
-- Run once in phpMyAdmin.
-- ============================================================
CREATE TABLE email_verifications (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  email        VARCHAR(150) NOT NULL,
  otp_hash     CHAR(64) NOT NULL,          -- sha256(otp + email)
  verify_token CHAR(64) NULL,              -- issued once the OTP is correct
  expires_at   DATETIME NOT NULL,
  attempts     TINYINT DEFAULT 0,          -- wrong codes entered so far
  used_at      DATETIME NULL,              -- set when the account is created
  created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_email_created (email, created_at),
  INDEX idx_verify_token  (verify_token)
) ENGINE=InnoDB;
