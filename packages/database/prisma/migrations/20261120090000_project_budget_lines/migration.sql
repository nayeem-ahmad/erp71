-- Project costing, Phase D: budget by category. Additive.
CREATE TYPE "ProjectBudgetCategory" AS ENUM ('LABOUR', 'MATERIAL', 'SERVICES', 'EXPENSE', 'OVERHEAD', 'OTHER');

CREATE TABLE "project_budget_lines" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "category" "ProjectBudgetCategory" NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "updated_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "project_budget_lines_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "project_budget_lines_project_id_category_key" ON "project_budget_lines"("project_id", "category");
CREATE INDEX "project_budget_lines_tenant_id_project_id_idx" ON "project_budget_lines"("tenant_id", "project_id");

ALTER TABLE "project_budget_lines" ADD CONSTRAINT "project_budget_lines_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "project_budget_lines" ADD CONSTRAINT "project_budget_lines_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
