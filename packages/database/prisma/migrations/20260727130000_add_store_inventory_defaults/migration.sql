-- Per-store override of the tenant-wide InventorySettings warehouse defaults.
-- Warehouses are store-scoped, so a single tenant-level default only ever
-- matches one store; multi-store tenants set a row here per store.

CREATE TABLE "StoreInventoryDefaults" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "store_id" TEXT NOT NULL,
    "default_product_warehouse_id" TEXT,
    "default_purchase_warehouse_id" TEXT,
    "default_sales_warehouse_id" TEXT,
    "default_shrinkage_warehouse_id" TEXT,
    "default_transfer_source_warehouse_id" TEXT,
    "default_transfer_destination_warehouse_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StoreInventoryDefaults_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "StoreInventoryDefaults_tenant_id_store_id_key" ON "StoreInventoryDefaults"("tenant_id", "store_id");
CREATE INDEX "StoreInventoryDefaults_store_id_idx" ON "StoreInventoryDefaults"("store_id");
CREATE INDEX "StoreInventoryDefaults_default_product_warehouse_id_idx" ON "StoreInventoryDefaults"("default_product_warehouse_id");
CREATE INDEX "StoreInventoryDefaults_default_purchase_warehouse_id_idx" ON "StoreInventoryDefaults"("default_purchase_warehouse_id");
CREATE INDEX "StoreInventoryDefaults_default_sales_warehouse_id_idx" ON "StoreInventoryDefaults"("default_sales_warehouse_id");
CREATE INDEX "StoreInventoryDefaults_default_shrinkage_warehouse_id_idx" ON "StoreInventoryDefaults"("default_shrinkage_warehouse_id");
CREATE INDEX "StoreInventoryDefaults_default_transfer_source_warehouse_id_idx" ON "StoreInventoryDefaults"("default_transfer_source_warehouse_id");
CREATE INDEX "StoreInventoryDefaults_default_transfer_destination_warehou_idx" ON "StoreInventoryDefaults"("default_transfer_destination_warehouse_id");

ALTER TABLE "StoreInventoryDefaults" ADD CONSTRAINT "StoreInventoryDefaults_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StoreInventoryDefaults" ADD CONSTRAINT "StoreInventoryDefaults_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StoreInventoryDefaults" ADD CONSTRAINT "StoreInventoryDefaults_default_product_warehouse_id_fkey" FOREIGN KEY ("default_product_warehouse_id") REFERENCES "Warehouse"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "StoreInventoryDefaults" ADD CONSTRAINT "StoreInventoryDefaults_default_purchase_warehouse_id_fkey" FOREIGN KEY ("default_purchase_warehouse_id") REFERENCES "Warehouse"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "StoreInventoryDefaults" ADD CONSTRAINT "StoreInventoryDefaults_default_sales_warehouse_id_fkey" FOREIGN KEY ("default_sales_warehouse_id") REFERENCES "Warehouse"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "StoreInventoryDefaults" ADD CONSTRAINT "StoreInventoryDefaults_default_shrinkage_warehouse_id_fkey" FOREIGN KEY ("default_shrinkage_warehouse_id") REFERENCES "Warehouse"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "StoreInventoryDefaults" ADD CONSTRAINT "StoreInventoryDefaults_default_transfer_source_warehouse_id_fkey" FOREIGN KEY ("default_transfer_source_warehouse_id") REFERENCES "Warehouse"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "StoreInventoryDefaults" ADD CONSTRAINT "StoreInventoryDefaults_default_transfer_destination_warehouse_id_fkey" FOREIGN KEY ("default_transfer_destination_warehouse_id") REFERENCES "Warehouse"("id") ON DELETE SET NULL ON UPDATE CASCADE;
