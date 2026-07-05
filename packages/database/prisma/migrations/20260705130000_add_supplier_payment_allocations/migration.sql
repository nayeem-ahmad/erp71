-- AlterTable: track how much of a purchase bill has been settled by allocated
-- supplier payments, so bills can be listed as open/partial/paid.
ALTER TABLE "Purchase" ADD COLUMN "paid_amount" DECIMAL(12,2) NOT NULL DEFAULT 0;
ALTER TABLE "Purchase" ADD COLUMN "payment_status" TEXT NOT NULL DEFAULT 'UNPAID';

-- CreateIndex
CREATE INDEX "Purchase_tenant_id_payment_status_idx" ON "Purchase"("tenant_id", "payment_status");

-- CreateTable: matches a supplier PAYMENT transaction (in full or in part) to
-- a specific Purchase bill, so advances and part-payments taken before/without
-- a bill can be applied to the correct bill(s) later.
CREATE TABLE "SupplierPaymentAllocation" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "transaction_id" TEXT NOT NULL,
    "purchase_id" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupplierPaymentAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SupplierPaymentAllocation_tenant_id_purchase_id_idx" ON "SupplierPaymentAllocation"("tenant_id", "purchase_id");

-- CreateIndex
CREATE INDEX "SupplierPaymentAllocation_tenant_id_transaction_id_idx" ON "SupplierPaymentAllocation"("tenant_id", "transaction_id");

-- AddForeignKey
ALTER TABLE "SupplierPaymentAllocation" ADD CONSTRAINT "SupplierPaymentAllocation_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierPaymentAllocation" ADD CONSTRAINT "SupplierPaymentAllocation_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "SupplierCreditTransaction"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierPaymentAllocation" ADD CONSTRAINT "SupplierPaymentAllocation_purchase_id_fkey" FOREIGN KEY ("purchase_id") REFERENCES "Purchase"("id") ON DELETE CASCADE ON UPDATE CASCADE;
