-- CreateEnum
CREATE TYPE "PriceListDiscountType" AS ENUM ('PERCENTAGE', 'FIXED_AMOUNT');

-- CreateTable
CREATE TABLE "PriceList" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "overall_discount_type" "PriceListDiscountType",
    "overall_discount_value" DECIMAL(12,2),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PriceList_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PriceListItem" (
    "id" TEXT NOT NULL,
    "price_list_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "selling_price" DECIMAL(12,2),
    "discount_type" "PriceListDiscountType",
    "discount_value" DECIMAL(12,2),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PriceListItem_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "CustomerGroup" ADD COLUMN "price_list_id" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "PriceList_tenant_id_name_key" ON "PriceList"("tenant_id", "name");

-- CreateIndex
CREATE INDEX "PriceList_tenant_id_is_default_idx" ON "PriceList"("tenant_id", "is_default");

-- CreateIndex
CREATE UNIQUE INDEX "PriceListItem_price_list_id_product_id_key" ON "PriceListItem"("price_list_id", "product_id");

-- CreateIndex
CREATE INDEX "PriceListItem_price_list_id_idx" ON "PriceListItem"("price_list_id");

-- CreateIndex
CREATE INDEX "CustomerGroup_price_list_id_idx" ON "CustomerGroup"("price_list_id");

-- AddForeignKey
ALTER TABLE "CustomerGroup" ADD CONSTRAINT "CustomerGroup_price_list_id_fkey" FOREIGN KEY ("price_list_id") REFERENCES "PriceList"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriceList" ADD CONSTRAINT "PriceList_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriceListItem" ADD CONSTRAINT "PriceListItem_price_list_id_fkey" FOREIGN KEY ("price_list_id") REFERENCES "PriceList"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriceListItem" ADD CONSTRAINT "PriceListItem_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;