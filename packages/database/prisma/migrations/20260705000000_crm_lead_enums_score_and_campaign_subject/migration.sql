-- Promote Lead's free-text status/source/category/priority to native enums,
-- add lead scoring + lost-reason tracking, and add an email subject line to campaigns.

-- CreateEnum
CREATE TYPE "LeadStatus" AS ENUM ('NEW', 'CONTACTED', 'QUALIFIED', 'LOST', 'CONVERTED');

-- CreateEnum
CREATE TYPE "LeadSource" AS ENUM ('WALK_IN', 'PHONE', 'FACEBOOK', 'REFERRAL', 'WEBSITE', 'OTHER');

-- CreateEnum
CREATE TYPE "LeadCategory" AS ENUM ('RETAIL', 'WHOLESALE', 'CORPORATE', 'INDIVIDUAL', 'PARTNER', 'OTHER');

-- CreateEnum
CREATE TYPE "LeadPriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'URGENT');

-- AlterTable: convert existing text columns to the new enum types
ALTER TABLE "Lead" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "Lead" ALTER COLUMN "status" TYPE "LeadStatus" USING status::"LeadStatus";
ALTER TABLE "Lead" ALTER COLUMN "status" SET DEFAULT 'NEW';

ALTER TABLE "Lead" ALTER COLUMN "source" DROP DEFAULT;
ALTER TABLE "Lead" ALTER COLUMN "source" TYPE "LeadSource" USING source::"LeadSource";
ALTER TABLE "Lead" ALTER COLUMN "source" SET DEFAULT 'OTHER';

ALTER TABLE "Lead" ALTER COLUMN "priority" DROP DEFAULT;
ALTER TABLE "Lead" ALTER COLUMN "priority" TYPE "LeadPriority" USING priority::"LeadPriority";
ALTER TABLE "Lead" ALTER COLUMN "priority" SET DEFAULT 'MEDIUM';

ALTER TABLE "Lead" ALTER COLUMN "category" TYPE "LeadCategory" USING category::"LeadCategory";

-- AlterTable: lead scoring + lost reason
ALTER TABLE "Lead" ADD COLUMN "lost_reason" TEXT;
ALTER TABLE "Lead" ADD COLUMN "score" INTEGER NOT NULL DEFAULT 0;

-- AlterTable: email subject line for campaigns
ALTER TABLE "CrmCampaign" ADD COLUMN "subject" TEXT;
