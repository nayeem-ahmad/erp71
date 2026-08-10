-- Stamps when a recipient was claimed for sending, so a drain pass can tell a
-- row that is genuinely in flight from one orphaned by a crash or redeploy and
-- re-queue the latter instead of stranding it in SENDING forever.
ALTER TABLE "CrmCampaignRecipient" ADD COLUMN "claimed_at" TIMESTAMP(3);
