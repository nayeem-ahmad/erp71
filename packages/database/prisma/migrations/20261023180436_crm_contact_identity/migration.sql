-- DropIndex
DROP INDEX "Lead_tenant_id_mobile_norm_key";

-- DropIndex
DROP INDEX "Lead_tenant_id_email_norm_key";

-- DropIndex
DROP INDEX "Lead_tenant_id_linkedin_norm_key";

-- AlterTable
ALTER TABLE "Lead" ADD COLUMN     "contact_id" TEXT,
ADD COLUMN     "organization_id" TEXT;

-- AlterTable
ALTER TABLE "CrmContact" ADD COLUMN     "customer_id" TEXT,
ADD COLUMN     "email_norm" TEXT,
ADD COLUMN     "linkedin_norm" TEXT,
ADD COLUMN     "mobile_norm" TEXT,
ADD COLUMN     "organization_id" TEXT;

-- CreateTable
CREATE TABLE "Organization" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "name_norm" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "address" TEXT,
    "website_url" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Organization_tenant_id_name_norm_key" ON "Organization"("tenant_id", "name_norm");

-- CreateIndex
CREATE INDEX "Lead_tenant_id_mobile_norm_idx" ON "Lead"("tenant_id", "mobile_norm");

-- CreateIndex
CREATE INDEX "Lead_tenant_id_email_norm_idx" ON "Lead"("tenant_id", "email_norm");

-- CreateIndex
CREATE INDEX "Lead_tenant_id_linkedin_norm_idx" ON "Lead"("tenant_id", "linkedin_norm");

-- CreateIndex
CREATE INDEX "CrmContact_tenant_id_email_norm_idx" ON "CrmContact"("tenant_id", "email_norm");

-- CreateIndex
CREATE UNIQUE INDEX "CrmContact_tenant_id_mobile_norm_key" ON "CrmContact"("tenant_id", "mobile_norm");

-- CreateIndex
CREATE UNIQUE INDEX "CrmContact_tenant_id_linkedin_norm_key" ON "CrmContact"("tenant_id", "linkedin_norm");

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "CrmContact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Organization" ADD CONSTRAINT "Organization_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmContact" ADD CONSTRAINT "CrmContact_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmContact" ADD CONSTRAINT "CrmContact_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

