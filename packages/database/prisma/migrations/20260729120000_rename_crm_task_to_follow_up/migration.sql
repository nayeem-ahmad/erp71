-- DropForeignKey
ALTER TABLE "CrmTask" DROP CONSTRAINT "CrmTask_tenant_id_fkey";

-- DropForeignKey
ALTER TABLE "CrmTask" DROP CONSTRAINT "CrmTask_customer_id_fkey";

-- DropForeignKey
ALTER TABLE "CrmTask" DROP CONSTRAINT "CrmTask_lead_id_fkey";

-- DropForeignKey
ALTER TABLE "CrmTask" DROP CONSTRAINT "CrmTask_assigned_to_fkey";

-- DropForeignKey
ALTER TABLE "CrmTask" DROP CONSTRAINT "CrmTask_created_by_fkey";

-- DropTable
DROP TABLE "CrmTask";

-- CreateTable
CREATE TABLE "CrmFollowUp" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "store_id" TEXT,
    "customer_id" TEXT,
    "lead_id" TEXT,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "due_at" TIMESTAMP(3) NOT NULL,
    "completed_at" TIMESTAMP(3),
    "assigned_to" TEXT,
    "created_by" TEXT,
    "notes" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CrmFollowUp_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CrmFollowUp_tenant_id_status_due_at_idx" ON "CrmFollowUp"("tenant_id", "status", "due_at");

-- CreateIndex
CREATE INDEX "CrmFollowUp_tenant_id_customer_id_idx" ON "CrmFollowUp"("tenant_id", "customer_id");

-- CreateIndex
CREATE INDEX "CrmFollowUp_tenant_id_lead_id_idx" ON "CrmFollowUp"("tenant_id", "lead_id");

-- AddForeignKey
ALTER TABLE "CrmFollowUp" ADD CONSTRAINT "CrmFollowUp_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmFollowUp" ADD CONSTRAINT "CrmFollowUp_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmFollowUp" ADD CONSTRAINT "CrmFollowUp_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmFollowUp" ADD CONSTRAINT "CrmFollowUp_assigned_to_fkey" FOREIGN KEY ("assigned_to") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmFollowUp" ADD CONSTRAINT "CrmFollowUp_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

