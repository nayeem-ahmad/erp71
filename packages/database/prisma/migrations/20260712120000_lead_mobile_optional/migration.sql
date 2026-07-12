-- Make Lead.mobile optional: only name is required when creating a lead.
ALTER TABLE "Lead" ALTER COLUMN "mobile" DROP NOT NULL;
