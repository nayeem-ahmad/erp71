-- AlterTable
ALTER TABLE "PaymentMethod" ADD COLUMN     "all_branches" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "TenantUser" ADD COLUMN     "payment_method_prefs" JSONB;

-- AlterTable
ALTER TABLE "PurchasePayment" ADD COLUMN     "account_id" TEXT,
ADD COLUMN     "payment_method_id" TEXT,
ADD COLUMN     "payment_method_name" TEXT;

-- AlterTable
ALTER TABLE "PurchaseReturn" ADD COLUMN     "tenders_recorded" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "PaymentRecord" ADD COLUMN     "payment_method_id" TEXT,
ADD COLUMN     "payment_method_name" TEXT;

-- AlterTable
ALTER TABLE "SalesReturn" ADD COLUMN     "tenders_recorded" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "PaymentMethodStore" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "payment_method_id" TEXT NOT NULL,
    "store_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentMethodStore_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseReturnPayment" (
    "id" TEXT NOT NULL,
    "return_id" TEXT NOT NULL,
    "payment_method" TEXT NOT NULL,
    "payment_method_id" TEXT,
    "payment_method_name" TEXT,
    "account_id" TEXT,
    "amount" DECIMAL(12,2) NOT NULL,
    "bank_name" TEXT,
    "bank_branch" TEXT,
    "bank_account_number" TEXT,
    "reference_no" TEXT,
    "instrument_date" DATE,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PurchaseReturnPayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalesReturnPayment" (
    "id" TEXT NOT NULL,
    "return_id" TEXT NOT NULL,
    "payment_method" TEXT NOT NULL,
    "payment_method_id" TEXT,
    "payment_method_name" TEXT,
    "account_id" TEXT,
    "amount" DECIMAL(12,2) NOT NULL,
    "bank_name" TEXT,
    "bank_branch" TEXT,
    "bank_account_number" TEXT,
    "reference_no" TEXT,
    "instrument_date" DATE,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SalesReturnPayment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PaymentMethodStore_tenant_id_store_id_idx" ON "PaymentMethodStore"("tenant_id", "store_id");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentMethodStore_payment_method_id_store_id_key" ON "PaymentMethodStore"("payment_method_id", "store_id");

-- CreateIndex
CREATE INDEX "PurchaseReturnPayment_return_id_idx" ON "PurchaseReturnPayment"("return_id");

-- CreateIndex
CREATE INDEX "PurchaseReturnPayment_payment_method_id_idx" ON "PurchaseReturnPayment"("payment_method_id");

-- CreateIndex
CREATE INDEX "PurchaseReturnPayment_account_id_idx" ON "PurchaseReturnPayment"("account_id");

-- CreateIndex
CREATE INDEX "SalesReturnPayment_return_id_idx" ON "SalesReturnPayment"("return_id");

-- CreateIndex
CREATE INDEX "SalesReturnPayment_payment_method_id_idx" ON "SalesReturnPayment"("payment_method_id");

-- CreateIndex
CREATE INDEX "SalesReturnPayment_account_id_idx" ON "SalesReturnPayment"("account_id");

-- CreateIndex
CREATE INDEX "PaymentMethod_account_id_idx" ON "PaymentMethod"("account_id");

-- CreateIndex
CREATE INDEX "PurchasePayment_payment_method_id_idx" ON "PurchasePayment"("payment_method_id");

-- CreateIndex
CREATE INDEX "PurchasePayment_account_id_idx" ON "PurchasePayment"("account_id");

-- CreateIndex
CREATE INDEX "PaymentRecord_payment_method_id_idx" ON "PaymentRecord"("payment_method_id");

-- PaymentMethod.account_id has always been a bare string with no foreign key,
-- so it can point at an account that has since been deleted. Null those out or
-- the constraint below cannot be added.
UPDATE "PaymentMethod" pm SET account_id = NULL WHERE account_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM accounts a WHERE a.id = pm.account_id);

-- AddForeignKey
ALTER TABLE "PaymentMethod" ADD CONSTRAINT "PaymentMethod_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentMethodStore" ADD CONSTRAINT "PaymentMethodStore_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentMethodStore" ADD CONSTRAINT "PaymentMethodStore_payment_method_id_fkey" FOREIGN KEY ("payment_method_id") REFERENCES "PaymentMethod"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentMethodStore" ADD CONSTRAINT "PaymentMethodStore_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchasePayment" ADD CONSTRAINT "PurchasePayment_payment_method_id_fkey" FOREIGN KEY ("payment_method_id") REFERENCES "PaymentMethod"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchasePayment" ADD CONSTRAINT "PurchasePayment_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseReturnPayment" ADD CONSTRAINT "PurchaseReturnPayment_return_id_fkey" FOREIGN KEY ("return_id") REFERENCES "PurchaseReturn"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseReturnPayment" ADD CONSTRAINT "PurchaseReturnPayment_payment_method_id_fkey" FOREIGN KEY ("payment_method_id") REFERENCES "PaymentMethod"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseReturnPayment" ADD CONSTRAINT "PurchaseReturnPayment_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentRecord" ADD CONSTRAINT "PaymentRecord_payment_method_id_fkey" FOREIGN KEY ("payment_method_id") REFERENCES "PaymentMethod"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesReturnPayment" ADD CONSTRAINT "SalesReturnPayment_return_id_fkey" FOREIGN KEY ("return_id") REFERENCES "SalesReturn"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesReturnPayment" ADD CONSTRAINT "SalesReturnPayment_payment_method_id_fkey" FOREIGN KEY ("payment_method_id") REFERENCES "PaymentMethod"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesReturnPayment" ADD CONSTRAINT "SalesReturnPayment_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

