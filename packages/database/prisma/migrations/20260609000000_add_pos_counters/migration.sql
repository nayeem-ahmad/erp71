-- CreateTable
CREATE TABLE "PosCounter" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "store_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "counter_number" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PosCounter_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PosCounter_tenant_id_store_id_counter_number_key" ON "PosCounter"("tenant_id", "store_id", "counter_number");

-- CreateIndex
CREATE INDEX "PosCounter_tenant_id_store_id_idx" ON "PosCounter"("tenant_id", "store_id");

-- AddForeignKey
ALTER TABLE "PosCounter" ADD CONSTRAINT "PosCounter_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PosCounter" ADD CONSTRAINT "PosCounter_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable: add counter_id to CashierSession
ALTER TABLE "CashierSession" ADD COLUMN "counter_id" TEXT;

-- CreateIndex
CREATE INDEX "CashierSession_tenant_id_counter_id_idx" ON "CashierSession"("tenant_id", "counter_id");

-- AddForeignKey
ALTER TABLE "CashierSession" ADD CONSTRAINT "CashierSession_counter_id_fkey" FOREIGN KEY ("counter_id") REFERENCES "PosCounter"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AlterTable: add counter_id to Sale
ALTER TABLE "Sale" ADD COLUMN "counter_id" TEXT;

-- CreateIndex
CREATE INDEX "Sale_tenant_id_counter_id_idx" ON "Sale"("tenant_id", "counter_id");

-- AddForeignKey
ALTER TABLE "Sale" ADD CONSTRAINT "Sale_counter_id_fkey" FOREIGN KEY ("counter_id") REFERENCES "PosCounter"("id") ON DELETE SET NULL ON UPDATE CASCADE;
