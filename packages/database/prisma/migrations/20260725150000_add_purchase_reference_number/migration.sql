-- Purchase had no field for the supplier's / source system's own document
-- number, only our generated purchase_number. Sale already has one.
--
-- Deliberately NOT unique: unlike Sale.reference_number (a user-entered value
-- we hold unique per tenant), this also receives imported references, which can
-- repeat across suppliers and across source systems.

ALTER TABLE "Purchase" ADD COLUMN "reference_number" TEXT;

CREATE INDEX "Purchase_tenant_id_reference_number_idx" ON "Purchase"("tenant_id", "reference_number");
