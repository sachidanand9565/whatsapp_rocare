-- Failed-message webhooks: one webhook → many campaigns
-- Run once. Until it runs, the code keeps working with the old single
-- failed_msg_webhooks.campaign_id (only one campaign per webhook can be saved).

-- Link table: which campaigns a failed-message webhook fires for.
CREATE TABLE IF NOT EXISTS failed_msg_webhook_campaigns (
  webhook_id  INT NOT NULL,
  campaign_id INT NOT NULL,
  PRIMARY KEY (webhook_id, campaign_id),
  INDEX idx_campaign (campaign_id),
  CONSTRAINT fk_fmwc_webhook  FOREIGN KEY (webhook_id)  REFERENCES failed_msg_webhooks (id) ON DELETE CASCADE,
  CONSTRAINT fk_fmwc_campaign FOREIGN KEY (campaign_id) REFERENCES campaigns (id)           ON DELETE CASCADE
) ENGINE=InnoDB;

-- Carry existing single-campaign webhooks over.
INSERT IGNORE INTO failed_msg_webhook_campaigns (webhook_id, campaign_id)
SELECT id, campaign_id FROM failed_msg_webhooks WHERE campaign_id IS NOT NULL;

-- campaign_id stays as the "first selected" campaign for backward compatibility.
-- Previously deleting that campaign cascaded and deleted the whole webhook, even
-- if other campaigns were still linked — switch it to SET NULL instead.
ALTER TABLE failed_msg_webhooks DROP FOREIGN KEY failed_msg_webhooks_ibfk_2;
ALTER TABLE failed_msg_webhooks MODIFY campaign_id INT NULL;
ALTER TABLE failed_msg_webhooks
  ADD CONSTRAINT failed_msg_webhooks_ibfk_2
  FOREIGN KEY (campaign_id) REFERENCES campaigns (id) ON DELETE SET NULL;
