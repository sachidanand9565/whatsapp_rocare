-- ============================================================
-- Migration: Leads CRM System
-- Run this against your whatsapp_saas database
-- ============================================================

USE whatsapp_saas;

CREATE TABLE IF NOT EXISTS leads (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  workspace_id INT NOT NULL,
  contact_id   INT NULL,
  name         VARCHAR(255) NULL,
  phone        VARCHAR(50)  NULL,
  email        VARCHAR(150) NULL,
  source       ENUM('whatsapp','scraper','manual','campaign','flow') DEFAULT 'manual',
  stage        ENUM('new','contacted','qualified','proposal','negotiation','won','lost') DEFAULT 'new',
  assigned_to  INT NULL,
  deal_value   DECIMAL(12,2) NULL,
  notes        TEXT NULL,
  created_at   DATETIME NOT NULL,
  updated_at   DATETIME NOT NULL,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  INDEX idx_workspace_stage   (workspace_id, stage),
  INDEX idx_workspace_created (workspace_id, created_at),
  INDEX idx_contact           (contact_id)
);

CREATE TABLE IF NOT EXISTS lead_activities (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  lead_id      INT NOT NULL,
  type         ENUM('note','stage_change','call','followup','assigned','message') DEFAULT 'note',
  description  TEXT,
  done_by      INT NULL,
  scheduled_at DATETIME NULL,
  created_at   DATETIME NOT NULL,
  FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE,
  INDEX idx_lead_created (lead_id, created_at)
);
