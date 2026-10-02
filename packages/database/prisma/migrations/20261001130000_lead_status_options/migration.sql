-- Tenant-managed lead pipeline stages. Additive only: Lead.status (the
-- lifecycle enum) is untouched. status_id is backfilled by sync-lead-taxonomy.
-- AlterTable
ALTER TABLE "Lead" ADD COLUMN     "status_id" TEXT;

-- CreateTable
CREATE TABLE "LeadStatusOption" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "lifecycle" "LeadStatus" NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_system" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeadStatusOption_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LeadStatusOption_tenant_id_is_active_sort_order_idx" ON "LeadStatusOption"("tenant_id", "is_active", "sort_order");

-- CreateIndex
CREATE UNIQUE INDEX "LeadStatusOption_tenant_id_code_key" ON "LeadStatusOption"("tenant_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "LeadStatusOption_tenant_id_name_key" ON "LeadStatusOption"("tenant_id", "name");

-- CreateIndex
CREATE INDEX "Lead_tenant_id_status_id_idx" ON "Lead"("tenant_id", "status_id");

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_status_id_fkey" FOREIGN KEY ("status_id") REFERENCES "LeadStatusOption"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadStatusOption" ADD CONSTRAINT "LeadStatusOption_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

