-- Expand Lead with category, priority, remarks, social URLs, and next-step fields.
-- Rename phone -> mobile and notes -> remarks.

ALTER TABLE "Lead" RENAME COLUMN "phone" TO "mobile";
ALTER TABLE "Lead" RENAME COLUMN "notes" TO "remarks";

ALTER TABLE "Lead" ADD COLUMN "category" TEXT;
ALTER TABLE "Lead" ADD COLUMN "priority" TEXT NOT NULL DEFAULT 'MEDIUM';
ALTER TABLE "Lead" ADD COLUMN "linkedin_url" TEXT;
ALTER TABLE "Lead" ADD COLUMN "fb_url" TEXT;
ALTER TABLE "Lead" ADD COLUMN "x_url" TEXT;
ALTER TABLE "Lead" ADD COLUMN "website_url" TEXT;
ALTER TABLE "Lead" ADD COLUMN "next_step" TEXT;
ALTER TABLE "Lead" ADD COLUMN "next_step_date" TIMESTAMP(3);
ALTER TABLE "Lead" ADD COLUMN "next_step_assigned_to" TEXT;

DROP INDEX IF EXISTS "Lead_tenant_id_phone_key";
CREATE UNIQUE INDEX "Lead_tenant_id_mobile_key" ON "Lead"("tenant_id", "mobile");
CREATE INDEX "Lead_tenant_id_category_idx" ON "Lead"("tenant_id", "category");
CREATE INDEX "Lead_tenant_id_priority_idx" ON "Lead"("tenant_id", "priority");
CREATE INDEX "Lead_tenant_id_next_step_date_idx" ON "Lead"("tenant_id", "next_step_date");

ALTER TABLE "Lead" ADD CONSTRAINT "Lead_next_step_assigned_to_fkey"
    FOREIGN KEY ("next_step_assigned_to") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;