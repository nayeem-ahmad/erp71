-- Where a sales entry came from, when it was raised by "convert to sale" on a
-- quotation or a sales order.
--
-- Structural columns rather than text stuffed into `reference_number`: that
-- column is the tenant's own invoice numbering, is unique per tenant, and is
-- auto-generated when the cashier leaves it blank, so it cannot also carry a
-- pointer to a source document.
--
-- Both are nullable with no backfill: an ordinary counter sale has no source
-- document, which is exactly what NULL says.
ALTER TABLE "Sale"
    ADD COLUMN "quotation_id" TEXT,
    ADD COLUMN "sales_order_id" TEXT;

-- "Has this quotation/order already been invoiced?" is asked per tenant, on
-- every conversion and on the source document's detail page.
CREATE INDEX "Sale_tenant_id_quotation_id_idx" ON "Sale"("tenant_id", "quotation_id");
CREATE INDEX "Sale_tenant_id_sales_order_id_idx" ON "Sale"("tenant_id", "sales_order_id");

-- SET NULL, not CASCADE: deleting a quotation must never take the invoice
-- raised from it — and the money posted behind it — with it.
ALTER TABLE "Sale" ADD CONSTRAINT "Sale_quotation_id_fkey" FOREIGN KEY ("quotation_id") REFERENCES "Quotation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Sale" ADD CONSTRAINT "Sale_sales_order_id_fkey" FOREIGN KEY ("sales_order_id") REFERENCES "SalesOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;
