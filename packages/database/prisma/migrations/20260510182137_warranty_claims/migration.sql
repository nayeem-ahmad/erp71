-- CreateTable
CREATE TABLE "WarrantyClaim" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "claim_number" TEXT NOT NULL,
    "serial_id" TEXT NOT NULL,
    "customer_name" TEXT NOT NULL,
    "customer_phone" TEXT,
    "issue_description" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "resolution_notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WarrantyClaim_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WarrantyClaim_tenant_id_claim_number_key" ON "WarrantyClaim"("tenant_id", "claim_number");

-- CreateIndex
CREATE INDEX "WarrantyClaim_tenant_id_status_idx" ON "WarrantyClaim"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "WarrantyClaim_tenant_id_serial_id_idx" ON "WarrantyClaim"("tenant_id", "serial_id");

-- CreateIndex
CREATE INDEX "WarrantyClaim_tenant_id_created_at_idx" ON "WarrantyClaim"("tenant_id", "created_at");

-- AddForeignKey
ALTER TABLE "WarrantyClaim" ADD CONSTRAINT "WarrantyClaim_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WarrantyClaim" ADD CONSTRAINT "WarrantyClaim_serial_id_fkey" FOREIGN KEY ("serial_id") REFERENCES "ProductSerial"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
