-- Project costing, Phase C: revenue and billing.
-- Additive throughout; existing projects become INTERNAL (bill nothing) until
-- someone says otherwise. Production applies schema via `prisma db push`; this
-- file is the history.

CREATE TYPE "ProjectBillingType" AS ENUM ('FIXED_PRICE', 'TIME_AND_MATERIALS', 'INTERNAL');

ALTER TABLE "projects"
    ADD COLUMN "billing_type" "ProjectBillingType" NOT NULL DEFAULT 'INTERNAL',
    ADD COLUMN "contract_value" DECIMAL(14,2),
    ADD COLUMN "bill_rate" DECIMAL(12,2);

ALTER TABLE "project_members" ADD COLUMN "bill_rate" DECIMAL(12,2);

ALTER TABLE "project_milestones"
    ADD COLUMN "amount" DECIMAL(14,2),
    ADD COLUMN "sale_id" TEXT;
ALTER TABLE "project_milestones" ADD CONSTRAINT "project_milestones_sale_id_fkey"
    FOREIGN KEY ("sale_id") REFERENCES "Sale"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "project_time_tags" ADD COLUMN "billable" BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE "project_time_entries" ADD COLUMN "billed_sale_id" TEXT;
ALTER TABLE "project_time_entries" ADD CONSTRAINT "project_time_entries_billed_sale_id_fkey"
    FOREIGN KEY ("billed_sale_id") REFERENCES "Sale"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Sale" ADD COLUMN "project_id" TEXT;
CREATE INDEX "Sale_tenant_id_project_id_idx" ON "Sale"("tenant_id", "project_id");
ALTER TABLE "Sale" ADD CONSTRAINT "Sale_project_id_fkey"
    FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "project_costing_settings" ADD COLUMN "billing_product_id" TEXT;
ALTER TABLE "project_costing_settings" ADD CONSTRAINT "project_costing_settings_billing_product_id_fkey"
    FOREIGN KEY ("billing_product_id") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;
