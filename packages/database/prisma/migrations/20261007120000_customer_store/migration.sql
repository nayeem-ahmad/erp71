-- The branch a customer was added at. A member limited to some branches sees
-- the customers added at them plus those with a sale there. No backfill: an
-- existing customer reaches a branch through their sales, and one who never
-- bought stays visible to all-branch members only until someone assigns it.
ALTER TABLE "Customer" ADD COLUMN "store_id" TEXT;

CREATE INDEX "Customer_tenant_id_store_id_idx" ON "Customer"("tenant_id", "store_id");

ALTER TABLE "Customer" ADD CONSTRAINT "Customer_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "Store"("id") ON DELETE SET NULL ON UPDATE CASCADE;
