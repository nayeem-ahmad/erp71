-- AlterTable: prepaid SMS credit balance on each tenant
ALTER TABLE "Tenant" ADD COLUMN "sms_credits" INTEGER NOT NULL DEFAULT 0;

-- CreateTable: purchasable SMS top-up packages
CREATE TABLE "SmsPackage" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "credits" INTEGER NOT NULL,
    "price" DECIMAL(12,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'BDT',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SmsPackage_pkey" PRIMARY KEY ("id")
);

-- CreateTable: ledger of SMS credit changes
CREATE TABLE "SmsTransaction" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "credits" INTEGER NOT NULL,
    "balance_after" INTEGER NOT NULL,
    "description" TEXT,
    "recipient" TEXT,
    "reference" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SmsTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SmsPackage_is_active_sort_order_idx" ON "SmsPackage"("is_active", "sort_order");

-- CreateIndex
CREATE INDEX "SmsTransaction_tenant_id_created_at_idx" ON "SmsTransaction"("tenant_id", "created_at");

-- AddForeignKey
ALTER TABLE "SmsTransaction" ADD CONSTRAINT "SmsTransaction_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
