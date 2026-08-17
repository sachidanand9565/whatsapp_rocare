-- ============================================================
-- WhatsApp Business Calling API (Phase 1) — run once in phpMyAdmin
-- ============================================================

-- Per-workspace calling preferences.
--   calling_enabled            : mirror of Meta's calling.status for the phone number
--   missed_call_template       : template sent automatically after a missed inbound
--                                call (lets agents reply even outside the 24h window).
--                                NULL = auto-reply off.
--   missed_call_template_lang  : language code of that template
ALTER TABLE workspaces
  ADD COLUMN calling_enabled           TINYINT(1)   NOT NULL DEFAULT 0,
  ADD COLUMN missed_call_template      VARCHAR(255) NULL,
  ADD COLUMN missed_call_template_lang VARCHAR(16)  NULL DEFAULT 'en';

-- Call records live in `messages` (type = 'call', wamid = 'call_<wacid>');
-- messages.wamid is already UNIQUE, no schema change needed there.
