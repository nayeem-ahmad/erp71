-- CreateTable: extra raw-material consumption recorded on production job completion
CREATE TABLE "production_wastages" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "quantity" DECIMAL(12,4) NOT NULL,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "production_wastages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "production_wastages_tenantId_idx" ON "production_wastages"("tenantId");
CREATE INDEX "production_wastages_jobId_idx" ON "production_wastages"("jobId");

-- AddForeignKey
ALTER TABLE "production_wastages" ADD CONSTRAINT "production_wastages_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "production_wastages" ADD CONSTRAINT "production_wastages_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "production_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "production_wastages" ADD CONSTRAINT "production_wastages_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
