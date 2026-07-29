-- SalesReturn was the last document model with no field for the source
-- system's own number; Sale, Purchase and PurchaseReturn all have one.
--
-- Not unique, matching Purchase.reference_number: imported references can
-- repeat across source systems.

ALTER TABLE "SalesReturn" ADD COLUMN "reference_number" TEXT;

CREATE INDEX "SalesReturn_tenant_id_reference_number_idx" ON "SalesReturn"("tenant_id", "reference_number");
