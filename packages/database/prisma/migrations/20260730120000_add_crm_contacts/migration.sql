-- CreateEnum
CREATE TYPE "CrmContactCaptureSource" AS ENUM ('MANUAL', 'BUSINESS_CARD', 'IMPORT');

-- CreateTable
CREATE TABLE "CrmContact" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "company" TEXT,
    "designation" TEXT,
    "mobile" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "address" TEXT,
    "website_url" TEXT,
    "linkedin_url" TEXT,
    "notes" TEXT,
    "capture_source" "CrmContactCaptureSource" NOT NULL DEFAULT 'MANUAL',
    "assigned_to" TEXT,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CrmContact_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CrmContact_tenant_id_name_idx" ON "CrmContact"("tenant_id", "name");

-- CreateIndex
CREATE INDEX "CrmContact_tenant_id_company_idx" ON "CrmContact"("tenant_id", "company");

-- CreateIndex
CREATE INDEX "CrmContact_tenant_id_assigned_to_idx" ON "CrmContact"("tenant_id", "assigned_to");

-- CreateIndex
CREATE INDEX "CrmContact_tenant_id_created_at_idx" ON "CrmContact"("tenant_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "CrmContact_tenant_id_mobile_key" ON "CrmContact"("tenant_id", "mobile");

-- AddForeignKey
ALTER TABLE "CrmContact" ADD CONSTRAINT "CrmContact_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmContact" ADD CONSTRAINT "CrmContact_assigned_to_fkey" FOREIGN KEY ("assigned_to") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmContact" ADD CONSTRAINT "CrmContact_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
</content>
</invoke>
