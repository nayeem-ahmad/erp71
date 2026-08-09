ALTER TABLE "CrmCampaign" ADD COLUMN "recipient_source" TEXT NOT NULL DEFAULT 'SEGMENT';
ALTER TABLE "CrmCampaign" ADD COLUMN "body_format" TEXT NOT NULL DEFAULT 'TEXT';
ALTER TABLE "CrmCampaign" ALTER COLUMN "message" DROP NOT NULL;

ALTER TABLE "CrmCampaignRecipient" ALTER COLUMN "customer_id" DROP NOT NULL;
ALTER TABLE "CrmCampaignRecipient" ALTER COLUMN "phone" DROP NOT NULL;
ALTER TABLE "CrmCampaignRecipient" ADD COLUMN "lead_id" TEXT;
ALTER TABLE "CrmCampaignRecipient" ADD COLUMN "contact_id" TEXT;
ALTER TABLE "CrmCampaignRecipient" ADD COLUMN "email" TEXT;
ALTER TABLE "CrmCampaignRecipient" ADD COLUMN "name" TEXT;
ALTER TABLE "CrmCampaignRecipient" ADD COLUMN "subject" TEXT;
ALTER TABLE "CrmCampaignRecipient" ADD COLUMN "message" TEXT;

CREATE UNIQUE INDEX "CrmCampaignRecipient_campaign_id_email_key" ON "CrmCampaignRecipient"("campaign_id", "email");
CREATE INDEX "CrmCampaignRecipient_lead_id_idx" ON "CrmCampaignRecipient"("lead_id");
CREATE INDEX "CrmCampaignRecipient_contact_id_idx" ON "CrmCampaignRecipient"("contact_id");

ALTER TABLE "CrmCampaignRecipient" ADD CONSTRAINT "CrmCampaignRecipient_lead_id_fkey"
    FOREIGN KEY ("lead_id") REFERENCES "Lead"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CrmCampaignRecipient" ADD CONSTRAINT "CrmCampaignRecipient_contact_id_fkey"
    FOREIGN KEY ("contact_id") REFERENCES "CrmContact"("id") ON DELETE SET NULL ON UPDATE CASCADE;
