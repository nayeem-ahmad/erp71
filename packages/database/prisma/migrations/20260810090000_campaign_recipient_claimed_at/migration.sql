-- Stamps when a recipient was claimed for sending, so a drain pass can tell a
-- row that is genuinely in flight from one orphaned by a crash or redeploy and
-- re-queue the latter instead of stranding it in SENDING forever.
ALTER TABLE "CrmCampaignRecipient" ADD COLUMN "claimed_at" TIMESTAMP(3);

-- Uploaded campaign rows are resolved against leads and contacts by email.
-- Neither table had an email index, so every upload was a tenant-wide scan.
CREATE INDEX "Lead_tenant_id_email_idx" ON "Lead"("tenant_id", "email");
CREATE INDEX "CrmContact_tenant_id_email_idx" ON "CrmContact"("tenant_id", "email");
