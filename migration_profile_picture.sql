-- Migration: WhatsApp Business Profile Picture
ALTER TABLE workspaces
  ADD COLUMN profile_picture_url VARCHAR(1000) NULL;
