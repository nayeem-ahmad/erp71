-- Setting a product's cost outside of a stock movement: an opening cost for
-- stock nobody priced, a correction, or a write-down to net realisable value.
--
-- Posts no voucher. Under the periodic inventory model this system books,
-- purchases are expensed when billed and inventory is not carried in the
-- ledger, so the weighted-average pool (product_costs) is a valuation basis
-- rather than a balance. An adjustment changes the COGS of goods leaving after
-- it and what stock on hand is valued at; it never restates a past sale.

-- The permission that gates it. `StorePermission` is a Postgres enum as well as
-- a TypeScript const, and `seedDefaultTenantRoles` writes a TenantRolePermission
-- row per granted permission at tenant creation — so a value present only in
-- `packages/shared-types` makes every signup fail, not just this route.
ALTER TYPE "StorePermission" ADD VALUE IF NOT EXISTS 'ADJUST_PRODUCT_COST';

CREATE TABLE "product_cost_adjustments" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "previous_cost" DECIMAL(12,4),
    "new_cost" DECIMAL(12,4) NOT NULL,
    "qty_on_hand" INTEGER NOT NULL,
    "note" TEXT,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_cost_adjustments_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "product_cost_adjustments_tenant_id_created_at_idx" ON "product_cost_adjustments"("tenant_id", "created_at");

CREATE INDEX "product_cost_adjustments_tenant_id_product_id_created_at_idx" ON "product_cost_adjustments"("tenant_id", "product_id", "created_at");

ALTER TABLE "product_cost_adjustments" ADD CONSTRAINT "product_cost_adjustments_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "product_cost_adjustments" ADD CONSTRAINT "product_cost_adjustments_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "product_cost_adjustments" ADD CONSTRAINT "product_cost_adjustments_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
