-- Warehouse selection on sales, purchases and their returns.
--
-- Until now these four documents never recorded where the goods moved: the
-- service resolved a warehouse at posting time from InventorySettings and
-- threw the answer away. Two consequences, both fixed by these columns:
--
--   1. A tenant with more than one warehouse could not say which one a
--      document drew on or delivered to.
--   2. Editing or deleting a posted document re-resolved the default, so
--      changing the tenant's default warehouse afterwards made the reversal
--      restock somewhere the goods had never been.
--
-- Header and line both carry the column. The line is an override for a
-- document split across warehouses; NULL there means "follow the document".
-- NULL on the header keeps the old behaviour — the configured default — which
-- is what every row written before this migration relies on.
ALTER TABLE "Sale" ADD COLUMN IF NOT EXISTS "warehouse_id" TEXT;
ALTER TABLE "SaleItem" ADD COLUMN IF NOT EXISTS "warehouse_id" TEXT;
ALTER TABLE "Purchase" ADD COLUMN IF NOT EXISTS "warehouse_id" TEXT;
ALTER TABLE "PurchaseItem" ADD COLUMN IF NOT EXISTS "warehouse_id" TEXT;
ALTER TABLE "SalesReturn" ADD COLUMN IF NOT EXISTS "warehouse_id" TEXT;
ALTER TABLE "SalesReturnItem" ADD COLUMN IF NOT EXISTS "warehouse_id" TEXT;
ALTER TABLE "PurchaseReturn" ADD COLUMN IF NOT EXISTS "warehouse_id" TEXT;
ALTER TABLE "PurchaseReturnItem" ADD COLUMN IF NOT EXISTS "warehouse_id" TEXT;

-- SET NULL, not RESTRICT. A warehouse is retired by clearing `is_active`, never
-- deleted — there is no delete endpoint for one — so in practice the only thing
-- that removes a Warehouse row is deleting its whole Tenant, and every document
-- here is cascade-deleted by that same operation. RESTRICT is evaluated
-- immediately rather than at end of statement, so it could fail that cascade
-- depending on the order Postgres happens to take the rows in; SET NULL cannot.
-- A document left with a null warehouse falls back to the configured default
-- exactly as a pre-migration row does.
ALTER TABLE "Sale" ADD CONSTRAINT "Sale_warehouse_id_fkey"
    FOREIGN KEY ("warehouse_id") REFERENCES "Warehouse"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SaleItem" ADD CONSTRAINT "SaleItem_warehouse_id_fkey"
    FOREIGN KEY ("warehouse_id") REFERENCES "Warehouse"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Purchase" ADD CONSTRAINT "Purchase_warehouse_id_fkey"
    FOREIGN KEY ("warehouse_id") REFERENCES "Warehouse"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PurchaseItem" ADD CONSTRAINT "PurchaseItem_warehouse_id_fkey"
    FOREIGN KEY ("warehouse_id") REFERENCES "Warehouse"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SalesReturn" ADD CONSTRAINT "SalesReturn_warehouse_id_fkey"
    FOREIGN KEY ("warehouse_id") REFERENCES "Warehouse"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SalesReturnItem" ADD CONSTRAINT "SalesReturnItem_warehouse_id_fkey"
    FOREIGN KEY ("warehouse_id") REFERENCES "Warehouse"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PurchaseReturn" ADD CONSTRAINT "PurchaseReturn_warehouse_id_fkey"
    FOREIGN KEY ("warehouse_id") REFERENCES "Warehouse"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PurchaseReturnItem" ADD CONSTRAINT "PurchaseReturnItem_warehouse_id_fkey"
    FOREIGN KEY ("warehouse_id") REFERENCES "Warehouse"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Only the headers get an index: "what did this warehouse handle?" is a
-- document-level question, and the line tables are already the largest in the
-- schema — four more indexes there would cost every insert to serve a query
-- nothing runs.
CREATE INDEX IF NOT EXISTS "Sale_tenant_id_warehouse_id_idx" ON "Sale"("tenant_id", "warehouse_id");
CREATE INDEX IF NOT EXISTS "Purchase_tenant_id_warehouse_id_idx" ON "Purchase"("tenant_id", "warehouse_id");
CREATE INDEX IF NOT EXISTS "SalesReturn_tenant_id_warehouse_id_idx" ON "SalesReturn"("tenant_id", "warehouse_id");
CREATE INDEX IF NOT EXISTS "PurchaseReturn_tenant_id_warehouse_id_idx" ON "PurchaseReturn"("tenant_id", "warehouse_id");
