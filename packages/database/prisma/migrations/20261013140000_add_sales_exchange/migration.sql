-- A posted exchange: goods coming back from an invoice and a replacement
-- going out, settled by the price difference only.

CREATE TABLE "SalesExchange" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "store_id" TEXT NOT NULL,
    "sale_id" TEXT NOT NULL,
    "session_id" TEXT,
    "exchange_number" TEXT NOT NULL,
    "reason" TEXT,
    "status" TEXT NOT NULL DEFAULT 'COMPLETED',
    "returned_total" DECIMAL(12,2) NOT NULL,
    "replacement_total" DECIMAL(12,2) NOT NULL,
    "difference" DECIMAL(12,2) NOT NULL,
    "settlement_mode" TEXT NOT NULL,
    "due_delta" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "cash_delta" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "warehouse_id" TEXT,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cancelled_at" TIMESTAMP(3),
    "cancelled_by" TEXT,
    "cancellation_note" TEXT,

    CONSTRAINT "SalesExchange_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SalesExchangeLine" (
    "id" TEXT NOT NULL,
    "exchange_id" TEXT NOT NULL,
    "sale_item_id" TEXT NOT NULL,
    "returned_product_id" TEXT NOT NULL,
    "returned_quantity" INTEGER NOT NULL,
    "returned_unit_price" DECIMAL(12,2) NOT NULL,
    "returned_unit_cost" DECIMAL(12,2),
    "returned_vat_rate" DECIMAL(5,2),
    "returned_sd_rate" DECIMAL(5,2),
    "returned_vat_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "returned_sd_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "replacement_product_id" TEXT NOT NULL,
    "replacement_quantity" INTEGER NOT NULL,
    "replacement_unit_price" DECIMAL(12,2) NOT NULL,
    "replacement_unit_cost" DECIMAL(12,2),
    "replacement_vat_rate" DECIMAL(5,2),
    "replacement_sd_rate" DECIMAL(5,2),
    "replacement_vat_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "replacement_sd_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "warehouse_id" TEXT,

    CONSTRAINT "SalesExchangeLine_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SalesExchange_tenant_id_exchange_number_key" ON "SalesExchange"("tenant_id", "exchange_number");
CREATE INDEX "SalesExchange_tenant_id_created_at_idx" ON "SalesExchange"("tenant_id", "created_at");
CREATE INDEX "SalesExchange_tenant_id_sale_id_idx" ON "SalesExchange"("tenant_id", "sale_id");
CREATE INDEX "SalesExchange_tenant_id_status_idx" ON "SalesExchange"("tenant_id", "status");
CREATE INDEX "SalesExchange_tenant_id_session_id_idx" ON "SalesExchange"("tenant_id", "session_id");
CREATE INDEX "SalesExchange_tenant_id_store_id_idx" ON "SalesExchange"("tenant_id", "store_id");
CREATE INDEX "SalesExchange_tenant_id_warehouse_id_idx" ON "SalesExchange"("tenant_id", "warehouse_id");

CREATE INDEX "SalesExchangeLine_exchange_id_idx" ON "SalesExchangeLine"("exchange_id");
CREATE INDEX "SalesExchangeLine_sale_item_id_idx" ON "SalesExchangeLine"("sale_item_id");
CREATE INDEX "SalesExchangeLine_returned_product_id_idx" ON "SalesExchangeLine"("returned_product_id");
CREATE INDEX "SalesExchangeLine_replacement_product_id_idx" ON "SalesExchangeLine"("replacement_product_id");
CREATE INDEX "SalesExchangeLine_warehouse_id_idx" ON "SalesExchangeLine"("warehouse_id");

ALTER TABLE "SalesExchange" ADD CONSTRAINT "SalesExchange_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SalesExchange" ADD CONSTRAINT "SalesExchange_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SalesExchange" ADD CONSTRAINT "SalesExchange_sale_id_fkey" FOREIGN KEY ("sale_id") REFERENCES "Sale"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SalesExchange" ADD CONSTRAINT "SalesExchange_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "CashierSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SalesExchange" ADD CONSTRAINT "SalesExchange_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "Warehouse"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "SalesExchangeLine" ADD CONSTRAINT "SalesExchangeLine_exchange_id_fkey" FOREIGN KEY ("exchange_id") REFERENCES "SalesExchange"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SalesExchangeLine" ADD CONSTRAINT "SalesExchangeLine_sale_item_id_fkey" FOREIGN KEY ("sale_item_id") REFERENCES "SaleItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SalesExchangeLine" ADD CONSTRAINT "SalesExchangeLine_returned_product_id_fkey" FOREIGN KEY ("returned_product_id") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SalesExchangeLine" ADD CONSTRAINT "SalesExchangeLine_replacement_product_id_fkey" FOREIGN KEY ("replacement_product_id") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SalesExchangeLine" ADD CONSTRAINT "SalesExchangeLine_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "Warehouse"("id") ON DELETE SET NULL ON UPDATE CASCADE;
