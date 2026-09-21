-- Indexes for the foreign keys on document line tables.
--
-- Postgres does not index a referencing column on its own, and Prisma only
-- emits the indexes it is asked for, so each of these tables had nothing but
-- its primary key. Reading one document's lines — the query Prisma issues for
-- `include: { items: true }` — therefore scanned the whole table, across every
-- tenant, and so did the referential-integrity check behind each ON DELETE
-- CASCADE. Measured on 200k PurchaseOrderItem rows (25 MB), fetching one
-- order's ten lines read 1,868 pages in 13.5 ms; with the index it reads 13
-- pages in 0.09 ms, for 1.9 MB of index.
--
-- These tables are written a few rows at a time when a document is saved, so
-- the added index maintenance is not on any hot write path.
--
-- Plain CREATE INDEX takes a lock that blocks writes to the table while the
-- build runs. These tables are small enough today that it is immediate; if one
-- has grown large by the time this ships, build that index by hand with
-- CREATE INDEX CONCURRENTLY first (it cannot run inside a migration
-- transaction) and then re-run this — the statement is a no-op once it exists.

-- CreateIndex
CREATE INDEX "CashTransaction_session_id_idx" ON "CashTransaction"("session_id");

-- CreateIndex
CREATE INDEX "CashTransaction_tenant_id_idx" ON "CashTransaction"("tenant_id");

-- CreateIndex
CREATE INDEX "OrderDeposit_order_id_idx" ON "OrderDeposit"("order_id");

-- CreateIndex
CREATE INDEX "PurchaseQuotationItem_rfq_id_idx" ON "PurchaseQuotationItem"("rfq_id");

-- CreateIndex
CREATE INDEX "PurchaseQuotationItem_product_id_idx" ON "PurchaseQuotationItem"("product_id");

-- CreateIndex
CREATE INDEX "PurchaseReturnItem_return_id_idx" ON "PurchaseReturnItem"("return_id");

-- CreateIndex
CREATE INDEX "PurchaseReturnItem_product_id_idx" ON "PurchaseReturnItem"("product_id");

-- CreateIndex
CREATE INDEX "PurchaseReturnItem_purchase_item_id_idx" ON "PurchaseReturnItem"("purchase_item_id");

-- CreateIndex
CREATE INDEX "PurchaseReturnItem_warehouse_id_idx" ON "PurchaseReturnItem"("warehouse_id");

-- CreateIndex
CREATE INDEX "QuotationItem_quotation_id_idx" ON "QuotationItem"("quotation_id");

-- CreateIndex
CREATE INDEX "QuotationItem_product_id_idx" ON "QuotationItem"("product_id");

-- CreateIndex
CREATE INDEX "SalesOrderItem_order_id_idx" ON "SalesOrderItem"("order_id");

-- CreateIndex
CREATE INDEX "SalesOrderItem_product_id_idx" ON "SalesOrderItem"("product_id");

-- CreateIndex
CREATE INDEX "SalesReturnItem_return_id_idx" ON "SalesReturnItem"("return_id");

-- CreateIndex
CREATE INDEX "SalesReturnItem_product_id_idx" ON "SalesReturnItem"("product_id");

-- CreateIndex
CREATE INDEX "SalesReturnItem_sale_item_id_idx" ON "SalesReturnItem"("sale_item_id");

-- CreateIndex
CREATE INDEX "SalesReturnItem_warehouse_id_idx" ON "SalesReturnItem"("warehouse_id");

-- CreateIndex
CREATE INDEX "bom_components_recipeId_idx" ON "bom_components"("recipeId");

-- CreateIndex
CREATE INDEX "bom_components_productId_idx" ON "bom_components"("productId");

-- CreateIndex
CREATE INDEX "feedbacks_tenantId_idx" ON "feedbacks"("tenantId");

-- CreateIndex
CREATE INDEX "feedbacks_userId_idx" ON "feedbacks"("userId");

-- CreateIndex
CREATE INDEX "storefront_order_items_orderId_idx" ON "storefront_order_items"("orderId");

-- CreateIndex
CREATE INDEX "storefront_order_items_productId_idx" ON "storefront_order_items"("productId");


-- CreateIndex
CREATE INDEX "PurchaseOrderItem_po_id_idx" ON "PurchaseOrderItem"("po_id");

-- CreateIndex
CREATE INDEX "PurchaseOrderItem_product_id_idx" ON "PurchaseOrderItem"("product_id");

