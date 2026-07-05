-- AlterTable: snapshot the rolled-up job cost at completion time so it does
-- not drift if product costs change later.
ALTER TABLE "production_jobs" ADD COLUMN "totalJobCost" DECIMAL(12,2);
ALTER TABLE "production_jobs" ADD COLUMN "costPerUnit" DECIMAL(12,4);

-- CreateTable: a cost line attached to a production job - either the raw
-- material cost rolled up automatically at completion, or a non-material job
-- cost (printing, binding, transport, labor, ...) added manually or allocated
-- from a PurchaseItem covering a bill that spans multiple jobs/titles.
CREATE TABLE "production_job_costs" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "costType" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "sourcePurchaseItemId" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "production_job_costs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "production_job_costs_tenantId_jobId_idx" ON "production_job_costs"("tenantId", "jobId");

-- AddForeignKey
ALTER TABLE "production_job_costs" ADD CONSTRAINT "production_job_costs_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_job_costs" ADD CONSTRAINT "production_job_costs_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "production_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_job_costs" ADD CONSTRAINT "production_job_costs_sourcePurchaseItemId_fkey" FOREIGN KEY ("sourcePurchaseItemId") REFERENCES "PurchaseItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;
