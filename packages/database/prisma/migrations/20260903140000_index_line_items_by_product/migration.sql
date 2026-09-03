-- Rate history on the sale and purchase entry screens asks, per product,
-- "what did this last go out (or come in) at, and to whom?" — a filter on
-- product_id joined back to the parent document, newest first.
--
-- SaleItem carried only an index on sale_id and PurchaseItem carried none, so
-- that lookup seq-scanned the two largest tables in the schema on every
-- product a user staged. These make it an index scan.
CREATE INDEX IF NOT EXISTS "SaleItem_product_id_idx" ON "SaleItem"("product_id");
CREATE INDEX IF NOT EXISTS "PurchaseItem_purchase_id_idx" ON "PurchaseItem"("purchase_id");
CREATE INDEX IF NOT EXISTS "PurchaseItem_product_id_idx" ON "PurchaseItem"("product_id");
