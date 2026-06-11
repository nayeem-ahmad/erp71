-- AlterEnum: add EDIT_BRANDS to StorePermission
ALTER TYPE "StorePermission" ADD VALUE IF NOT EXISTS 'EDIT_BRANDS';

-- CreateTable: Brand model for product brand management

CREATE TABLE "Brand" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "logo_url" TEXT,
    "website_url" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "Brand_pkey" PRIMARY KEY ("id")
);

-- AddColumn: brand_id to Product
ALTER TABLE "Product" ADD COLUMN "brand_id" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Brand_tenant_id_name_key" ON "Brand"("tenant_id", "name");
CREATE INDEX "Brand_tenant_id_deleted_at_idx" ON "Brand"("tenant_id", "deleted_at");
CREATE INDEX "Product_tenant_id_brand_id_idx" ON "Product"("tenant_id", "brand_id");

-- AddForeignKey
ALTER TABLE "Brand" ADD CONSTRAINT "Brand_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Product" ADD CONSTRAINT "Product_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "Brand"("id") ON DELETE SET NULL ON UPDATE CASCADE;
