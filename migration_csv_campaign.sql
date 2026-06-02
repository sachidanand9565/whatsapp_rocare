-- Add per-contact variables column for CSV-based campaigns
ALTER TABLE campaign_contacts
  ADD COLUMN IF NOT EXISTS variables JSON NULL DEFAULT NULL;
