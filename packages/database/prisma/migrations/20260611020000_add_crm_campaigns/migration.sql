-- CRM Campaigns: CrmCampaign and CrmCampaignRecipient models

CREATE TABLE IF NOT EXISTS "CrmCampaign" (
  "id"              TEXT          NOT NULL,
  "tenant_id"       TEXT          NOT NULL,
  "name"            TEXT          NOT NULL,
  "description"     TEXT,
  "status"          TEXT          NOT NULL DEFAULT 'DRAFT',
  "channel"         TEXT          NOT NULL,
  "target_segment"  TEXT,
  "target_group_id" TEXT,
  "message"         TEXT          NOT NULL,
  "scheduled_at"    TIMESTAMP(3),
  "sent_at"         TIMESTAMP(3),
  "recipient_count" INTEGER       NOT NULL DEFAULT 0,
  "delivered_count" INTEGER       NOT NULL DEFAULT 0,
  "failed_count"    INTEGER       NOT NULL DEFAULT 0,
  "created_by"      TEXT,
  "created_at"      TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"      TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "CrmCampaign_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "CrmCampaign_tenant_id_status_idx"
  ON "CrmCampaign"("tenant_id", "status");

CREATE INDEX IF NOT EXISTS "CrmCampaign_tenant_id_created_at_idx"
  ON "CrmCampaign"("tenant_id", "created_at");

ALTER TABLE "CrmCampaign"
  ADD CONSTRAINT "CrmCampaign_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "CrmCampaign_created_by_fkey"
    FOREIGN KEY ("created_by") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE IF NOT EXISTS "CrmCampaignRecipient" (
  "id"          TEXT          NOT NULL,
  "campaign_id" TEXT          NOT NULL,
  "customer_id" TEXT          NOT NULL,
  "phone"       TEXT          NOT NULL,
  "status"      TEXT          NOT NULL DEFAULT 'PENDING',
  "sent_at"     TIMESTAMP(3),
  "error"       TEXT,

  CONSTRAINT "CrmCampaignRecipient_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "CrmCampaignRecipient_campaign_id_customer_id_key"
  ON "CrmCampaignRecipient"("campaign_id", "customer_id");

CREATE INDEX IF NOT EXISTS "CrmCampaignRecipient_campaign_id_status_idx"
  ON "CrmCampaignRecipient"("campaign_id", "status");

ALTER TABLE "CrmCampaignRecipient"
  ADD CONSTRAINT "CrmCampaignRecipient_campaign_id_fkey"
    FOREIGN KEY ("campaign_id") REFERENCES "CrmCampaign"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "CrmCampaignRecipient_customer_id_fkey"
    FOREIGN KEY ("customer_id") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
