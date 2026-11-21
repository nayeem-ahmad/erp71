-- A warehouse transfer's own date, chosen on the entry form and defaulting to
-- the moment it is saved. `created_at` stays the time the row was inserted.
ALTER TABLE "WarehouseTransfer" ADD COLUMN "transfer_date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE INDEX "WarehouseTransfer_tenant_id_transfer_date_idx" ON "WarehouseTransfer"("tenant_id", "transfer_date");

-- Existing transfers happened when they were created.
UPDATE "WarehouseTransfer" SET "transfer_date" = "created_at";
