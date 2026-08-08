-- Product demands: a branch asking head office for stock it does not have.
--
-- Two tables and two permission enum values. Nothing here backfills or rewrites
-- an existing row, and no column is dropped or narrowed.
--
-- Additive only. Production reconciles its schema with `prisma db push` on
-- container start and never runs this directory (see
-- 20260804090000_add_referral_commission_reversal for the same note), so this
-- exists to keep the migration history honest rather than because it is the
-- mechanism that ships the change.
--
-- The permissions reach EXISTING tenants' roles and members via
-- `sync-role-permissions.ts` (group `product-demands`), which runs in the
-- container start chain — not from this file. A new tenant picks them up from
-- ROLE_DEFAULT_PERMISSIONS at signup.

-- Added to packages/shared-types first, which typechecks but does not teach
-- Postgres about them: UserStorePermission.permission is this enum, so a grant
-- cannot be written at all until the values exist.
ALTER TYPE "StorePermission" ADD VALUE IF NOT EXISTS 'CREATE_PRODUCT_DEMAND';
ALTER TYPE "StorePermission" ADD VALUE IF NOT EXISTS 'APPROVE_PRODUCT_DEMAND';

-- CreateTable
CREATE TABLE "ProductDemand" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "store_id" TEXT,
    "warehouse_id" TEXT NOT NULL,
    "demand_number" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "priority" TEXT NOT NULL DEFAULT 'NORMAL',
    "needed_by" TIMESTAMP(3),
    "notes" TEXT,
    "requested_by" TEXT,
    "submitted_at" TIMESTAMP(3),
    "reviewed_by" TEXT,
    "reviewed_at" TIMESTAMP(3),
    "review_note" TEXT,
    "fulfilled_at" TIMESTAMP(3),
    "fulfilled_by" TEXT,
    "fulfilment_note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductDemand_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductDemandItem" (
    "id" TEXT NOT NULL,
    "demand_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "quantity_requested" INTEGER NOT NULL,
    "quantity_approved" INTEGER,
    "note" TEXT,

    CONSTRAINT "ProductDemandItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProductDemand_tenant_id_demand_number_key" ON "ProductDemand"("tenant_id", "demand_number");

-- CreateIndex
CREATE INDEX "ProductDemand_tenant_id_status_created_at_idx" ON "ProductDemand"("tenant_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "ProductDemand_tenant_id_warehouse_id_idx" ON "ProductDemand"("tenant_id", "warehouse_id");

-- CreateIndex
CREATE INDEX "ProductDemand_tenant_id_requested_by_idx" ON "ProductDemand"("tenant_id", "requested_by");

-- CreateIndex
CREATE UNIQUE INDEX "ProductDemandItem_demand_id_product_id_key" ON "ProductDemandItem"("demand_id", "product_id");

-- AddForeignKey
ALTER TABLE "ProductDemand" ADD CONSTRAINT "ProductDemand_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductDemand" ADD CONSTRAINT "ProductDemand_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "Store"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductDemand" ADD CONSTRAINT "ProductDemand_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductDemandItem" ADD CONSTRAINT "ProductDemandItem_demand_id_fkey" FOREIGN KEY ("demand_id") REFERENCES "ProductDemand"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductDemandItem" ADD CONSTRAINT "ProductDemandItem_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
