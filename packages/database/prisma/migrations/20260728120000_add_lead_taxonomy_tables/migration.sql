-- AlterTable
ALTER TABLE "Lead" ADD COLUMN     "category_id" TEXT,
ADD COLUMN     "source_id" TEXT;

-- CreateTable
CREATE TABLE "LeadSourceOption" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "score_weight" INTEGER NOT NULL DEFAULT 5,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_system" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeadSourceOption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeadCategoryOption" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_system" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeadCategoryOption_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LeadSourceOption_tenant_id_is_active_sort_order_idx" ON "LeadSourceOption"("tenant_id", "is_active", "sort_order");

-- CreateIndex
CREATE UNIQUE INDEX "LeadSourceOption_tenant_id_code_key" ON "LeadSourceOption"("tenant_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "LeadSourceOption_tenant_id_name_key" ON "LeadSourceOption"("tenant_id", "name");

-- CreateIndex
CREATE INDEX "LeadCategoryOption_tenant_id_is_active_sort_order_idx" ON "LeadCategoryOption"("tenant_id", "is_active", "sort_order");

-- CreateIndex
CREATE UNIQUE INDEX "LeadCategoryOption_tenant_id_code_key" ON "LeadCategoryOption"("tenant_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "LeadCategoryOption_tenant_id_name_key" ON "LeadCategoryOption"("tenant_id", "name");

-- CreateIndex
CREATE INDEX "Lead_tenant_id_source_id_idx" ON "Lead"("tenant_id", "source_id");

-- CreateIndex
CREATE INDEX "Lead_tenant_id_category_id_idx" ON "Lead"("tenant_id", "category_id");

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "LeadSourceOption"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "LeadCategoryOption"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadSourceOption" ADD CONSTRAINT "LeadSourceOption_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadCategoryOption" ADD CONSTRAINT "LeadCategoryOption_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

