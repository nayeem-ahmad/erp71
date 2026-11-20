-- Project costing, Phase B: direct costs beyond labour.
-- Additive throughout. Production applies schema via `prisma db push`; this
-- file is the history.

CREATE TYPE "ProjectCostCategory" AS ENUM ('MATERIAL', 'SERVICES', 'EXPENSE', 'OVERHEAD', 'OTHER');

ALTER TABLE "ExpenseEntry" ADD COLUMN "project_id" TEXT;
CREATE INDEX "ExpenseEntry_tenant_id_project_id_idx" ON "ExpenseEntry"("tenant_id", "project_id");
ALTER TABLE "ExpenseEntry" ADD CONSTRAINT "ExpenseEntry_project_id_fkey"
    FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "project_cost_entries" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "category" "ProjectCostCategory" NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "cost_date" DATE NOT NULL,
    "description" TEXT NOT NULL,
    "source_purchase_item_id" TEXT,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "project_cost_entries_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "project_cost_entries_tenant_id_project_id_cost_date_idx" ON "project_cost_entries"("tenant_id", "project_id", "cost_date");
CREATE INDEX "project_cost_entries_source_purchase_item_id_idx" ON "project_cost_entries"("source_purchase_item_id");
ALTER TABLE "project_cost_entries" ADD CONSTRAINT "project_cost_entries_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "project_cost_entries" ADD CONSTRAINT "project_cost_entries_project_id_fkey"
    FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "project_cost_entries" ADD CONSTRAINT "project_cost_entries_source_purchase_item_id_fkey"
    FOREIGN KEY ("source_purchase_item_id") REFERENCES "PurchaseItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "project_material_issues" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "warehouse_id" TEXT NOT NULL,
    "issue_date" DATE NOT NULL,
    "note" TEXT,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "project_material_issues_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "project_material_issues_tenant_id_project_id_issue_date_idx" ON "project_material_issues"("tenant_id", "project_id", "issue_date");
ALTER TABLE "project_material_issues" ADD CONSTRAINT "project_material_issues_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "project_material_issues" ADD CONSTRAINT "project_material_issues_project_id_fkey"
    FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "project_material_issues" ADD CONSTRAINT "project_material_issues_warehouse_id_fkey"
    FOREIGN KEY ("warehouse_id") REFERENCES "Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "project_material_issue_lines" (
    "id" TEXT NOT NULL,
    "issue_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unit_cost" DECIMAL(12,2),
    "line_cost" DECIMAL(14,2),
    CONSTRAINT "project_material_issue_lines_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "project_material_issue_lines_issue_id_idx" ON "project_material_issue_lines"("issue_id");
ALTER TABLE "project_material_issue_lines" ADD CONSTRAINT "project_material_issue_lines_issue_id_fkey"
    FOREIGN KEY ("issue_id") REFERENCES "project_material_issues"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "project_material_issue_lines" ADD CONSTRAINT "project_material_issue_lines_product_id_fkey"
    FOREIGN KEY ("product_id") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
