-- ============================================================
-- Password reset via emailed OTP.
-- One row per requested code. The code itself is never stored —
-- only a SHA-256 hash, same idea as a password hash.
-- Run once in phpMyAdmin.
-- ============================================================
CREATE TABLE password_resets (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  user_id     INT NOT NULL,
  email       VARCHAR(150) NOT NULL,
  otp_hash    CHAR(64) NOT NULL,           -- sha256(otp + email)
  reset_token CHAR(64) NULL,               -- issued after the OTP is verified
  expires_at  DATETIME NOT NULL,
  attempts    TINYINT DEFAULT 0,           -- wrong codes entered so far
  used_at     DATETIME NULL,               -- set once the password is changed
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_email_created (email, created_at),
  INDEX idx_reset_token   (reset_token)
) ENGINE=InnoDB;
