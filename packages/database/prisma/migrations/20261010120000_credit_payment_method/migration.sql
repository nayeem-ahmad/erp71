-- Customer and supplier payments remember the tender they were paid by.
-- The name is a snapshot for receipts and history; the id is cleared when the
-- method is deleted, leaving the name behind.
ALTER TABLE "CustomerCreditTransaction" ADD COLUMN IF NOT EXISTS "payment_method_id" TEXT;
ALTER TABLE "CustomerCreditTransaction" ADD COLUMN IF NOT EXISTS "payment_method_name" TEXT;
ALTER TABLE "SupplierCreditTransaction" ADD COLUMN IF NOT EXISTS "payment_method_id" TEXT;
ALTER TABLE "SupplierCreditTransaction" ADD COLUMN IF NOT EXISTS "payment_method_name" TEXT;

ALTER TABLE "CustomerCreditTransaction" ADD CONSTRAINT "CustomerCreditTransaction_payment_method_id_fkey" FOREIGN KEY ("payment_method_id") REFERENCES "PaymentMethod"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SupplierCreditTransaction" ADD CONSTRAINT "SupplierCreditTransaction_payment_method_id_fkey" FOREIGN KEY ("payment_method_id") REFERENCES "PaymentMethod"("id") ON DELETE SET NULL ON UPDATE CASCADE;
