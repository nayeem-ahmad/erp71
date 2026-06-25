-- AlterTable
ALTER TABLE "Supplier" ADD COLUMN "due_balance" DECIMAL(12,2) NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "SupplierCreditTransaction" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "supplier_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "balance_after" DECIMAL(12,2) NOT NULL,
    "reference_type" TEXT,
    "reference_id" TEXT,
    "notes" TEXT,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupplierCreditTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SupplierCreditTransaction_tenant_id_supplier_id_idx" ON "SupplierCreditTransaction"("tenant_id", "supplier_id");

-- CreateIndex
CREATE INDEX "SupplierCreditTransaction_tenant_id_created_at_idx" ON "SupplierCreditTransaction"("tenant_id", "created_at");

-- AddForeignKey
ALTER TABLE "SupplierCreditTransaction" ADD CONSTRAINT "SupplierCreditTransaction_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierCreditTransaction" ADD CONSTRAINT "SupplierCreditTransaction_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "Supplier"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierCreditTransaction" ADD CONSTRAINT "SupplierCreditTransaction_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;