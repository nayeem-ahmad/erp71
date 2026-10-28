-- Cash drawers belong to one branch. Banks, wallets, and the rest of the
-- chart stay shared (store_id null). Employee and payroll branch columns
-- stay nullable until sync-branch-books fills them.

ALTER TABLE "accounts" ADD COLUMN "store_id" TEXT;

ALTER TABLE "accounts"
  ADD CONSTRAINT "accounts_store_id_fkey"
  FOREIGN KEY ("store_id") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "accounts_tenant_id_store_id_idx" ON "accounts"("tenant_id", "store_id");

DROP INDEX "accounts_tenant_id_name_key";

CREATE UNIQUE INDEX "accounts_shared_name_key" ON "accounts"("tenant_id", "name") WHERE "store_id" IS NULL;

CREATE UNIQUE INDEX "accounts_one_drawer_per_branch" ON "accounts"("tenant_id", "store_id") WHERE "store_id" IS NOT NULL;

ALTER TABLE "accounts"
  ADD CONSTRAINT "accounts_store_id_cash_only"
  CHECK ("store_id" IS NULL OR "category" = 'cash');

ALTER TABLE "Employee" ADD COLUMN "store_id" TEXT;

ALTER TABLE "Employee"
  ADD CONSTRAINT "Employee_store_id_fkey"
  FOREIGN KEY ("store_id") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "Employee_tenant_id_store_id_idx" ON "Employee"("tenant_id", "store_id");

ALTER TABLE "payroll_runs" ADD COLUMN "store_id" TEXT;

ALTER TABLE "payroll_runs"
  ADD CONSTRAINT "payroll_runs_store_id_fkey"
  FOREIGN KEY ("store_id") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "payroll_runs" DROP CONSTRAINT IF EXISTS "payroll_runs_tenant_id_year_month_kind_key";

CREATE UNIQUE INDEX "payroll_runs_tenant_id_year_month_kind_store_id_key"
  ON "payroll_runs"("tenant_id", "year", "month", "kind", "store_id");
