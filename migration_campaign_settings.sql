-- Migration: Campaign Settings
-- Adds auto_pause_campaigns toggle to workspaces table
ALTER TABLE workspaces
  ADD COLUMN auto_pause_campaigns TINYINT(1) NOT NULL DEFAULT 1;
