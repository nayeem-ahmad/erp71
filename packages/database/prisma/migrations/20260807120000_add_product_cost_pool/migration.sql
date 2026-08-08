-- Weighted-average cost pool, held one row per product per tenant.
--
-- Before this, a sale snapshotted its cost from the newest ProductPrice.cost —
-- a standard cost that never reflected what the goods were actually bought for.
-- This table carries a running average that every stock movement maintains, so
-- gross profit is computed against real purchase cost.

CREATE TABLE IF NOT EXISTS "product_costs" (
  "id"          TEXT           NOT NULL,
  "tenant_id"   TEXT           NOT NULL,
  "product_id"  TEXT           NOT NULL,
  "avg_cost"    DECIMAL(12, 4) NOT NULL,
  "qty_on_hand" INTEGER        NOT NULL DEFAULT 0,
  "updated_at"  TIMESTAMP(3)   NOT NULL,

  CONSTRAINT "product_costs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "product_costs_product_id_key"
  ON "product_costs"("product_id");

CREATE UNIQUE INDEX IF NOT EXISTS "product_costs_tenant_id_product_id_key"
  ON "product_costs"("tenant_id", "product_id");

CREATE INDEX IF NOT EXISTS "product_costs_tenant_id_idx"
  ON "product_costs"("tenant_id");

ALTER TABLE "product_costs"
  ADD CONSTRAINT "product_costs_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "product_costs"
  ADD CONSTRAINT "product_costs_product_id_fkey"
    FOREIGN KEY ("product_id") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Which cost a sale snapshots. Existing tenants default to WEIGHTED_AVERAGE
-- along with everyone else: the backfill script replays their movement history
-- into the pool and restates past sales, so the new default is the basis their
-- numbers were rebuilt on. A tenant that prefers the old behaviour can switch
-- back to LATEST_COST from inventory settings.
ALTER TABLE "InventorySettings"
  ADD COLUMN IF NOT EXISTS "costing_method" TEXT NOT NULL DEFAULT 'WEIGHTED_AVERAGE';
