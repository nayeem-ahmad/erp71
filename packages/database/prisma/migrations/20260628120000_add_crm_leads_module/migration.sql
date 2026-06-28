-- CRM leads, lead conversations, optional task targets, and lead permissions

ALTER TYPE "StorePermission" ADD VALUE IF NOT EXISTS 'VIEW_LEADS';
ALTER TYPE "StorePermission" ADD VALUE IF NOT EXISTS 'MANAGE_LEADS';
ALTER TYPE "StorePermission" ADD VALUE IF NOT EXISTS 'VIEW_LEAD_CONVERSATIONS';
ALTER TYPE "StorePermission" ADD VALUE IF NOT EXISTS 'CREATE_LEAD_CONVERSATIONS';

CREATE TABLE "Lead" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "store_id" TEXT,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "email" TEXT,
    "address" TEXT,
    "source" TEXT NOT NULL DEFAULT 'OTHER',
    "status" TEXT NOT NULL DEFAULT 'NEW',
    "assigned_to" TEXT,
    "notes" TEXT,
    "last_contacted_at" TIMESTAMP(3),
    "converted_customer_id" TEXT,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Lead_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Lead_tenant_id_phone_key" ON "Lead"("tenant_id", "phone");
CREATE INDEX "Lead_tenant_id_status_idx" ON "Lead"("tenant_id", "status");
CREATE INDEX "Lead_tenant_id_assigned_to_idx" ON "Lead"("tenant_id", "assigned_to");

ALTER TABLE "Lead" ADD CONSTRAINT "Lead_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_assigned_to_fkey"
    FOREIGN KEY ("assigned_to") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_created_by_fkey"
    FOREIGN KEY ("created_by") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_converted_customer_id_fkey"
    FOREIGN KEY ("converted_customer_id") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "LeadConversation" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "store_id" TEXT,
    "lead_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "direction" TEXT NOT NULL DEFAULT 'OUTBOUND',
    "summary" TEXT NOT NULL,
    "outcome" TEXT,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeadConversation_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "LeadConversation_tenant_id_lead_id_idx" ON "LeadConversation"("tenant_id", "lead_id");
CREATE INDEX "LeadConversation_tenant_id_created_at_idx" ON "LeadConversation"("tenant_id", "created_at");

ALTER TABLE "LeadConversation" ADD CONSTRAINT "LeadConversation_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LeadConversation" ADD CONSTRAINT "LeadConversation_lead_id_fkey"
    FOREIGN KEY ("lead_id") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LeadConversation" ADD CONSTRAINT "LeadConversation_created_by_fkey"
    FOREIGN KEY ("created_by") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "CrmTask" ALTER COLUMN "customer_id" DROP NOT NULL;
ALTER TABLE "CrmTask" ADD COLUMN "lead_id" TEXT;
CREATE INDEX "CrmTask_tenant_id_lead_id_idx" ON "CrmTask"("tenant_id", "lead_id");
ALTER TABLE "CrmTask" ADD CONSTRAINT "CrmTask_lead_id_fkey"
    FOREIGN KEY ("lead_id") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

UPDATE "SubscriptionPlan"
SET "features_json" = "features_json" || '{"premiumCrm": true}'::jsonb
WHERE "code" = 'PREMIUM';

UPDATE "SubscriptionPlan"
SET "features_json" = "features_json" || '{"premiumCrm": false}'::jsonb
WHERE "code" IN ('FREE', 'BASIC', 'ACCOUNTING', 'STANDARD')
  AND NOT ("features_json" ? 'premiumCrm');