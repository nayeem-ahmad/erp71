-- Project costing, Phase A: labour cost from hours.
-- Additive and nullable throughout. Production applies schema via
-- `prisma db push`; this file is the history.

ALTER TYPE "StorePermission" ADD VALUE IF NOT EXISTS 'VIEW_PROJECT_FINANCIALS';

CREATE TYPE "LabourCostSource" AS ENUM ('RATE', 'SALARY');

ALTER TABLE "project_time_entries"
    ADD COLUMN "cost_rate" DECIMAL(12,2),
    ADD COLUMN "cost_amount" DECIMAL(14,2),
    ADD COLUMN "cost_source" "LabourCostSource";

CREATE TABLE "employee_cost_rates" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "hourly_cost" DECIMAL(12,2) NOT NULL,
    "effective_from" DATE NOT NULL,
    "note" TEXT,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "employee_cost_rates_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "employee_cost_rates_employee_id_effective_from_key" ON "employee_cost_rates"("employee_id", "effective_from");
CREATE INDEX "employee_cost_rates_tenant_id_employee_id_idx" ON "employee_cost_rates"("tenant_id", "employee_id");
ALTER TABLE "employee_cost_rates" ADD CONSTRAINT "employee_cost_rates_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "employee_cost_rates" ADD CONSTRAINT "employee_cost_rates_employee_id_fkey"
    FOREIGN KEY ("employee_id") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "project_costing_settings" (
    "tenant_id" TEXT NOT NULL,
    "standard_monthly_hours" DECIMAL(6,2) NOT NULL DEFAULT 208,
    "labour_overhead_pct" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "updated_by" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "project_costing_settings_pkey" PRIMARY KEY ("tenant_id")
);
ALTER TABLE "project_costing_settings" ADD CONSTRAINT "project_costing_settings_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
