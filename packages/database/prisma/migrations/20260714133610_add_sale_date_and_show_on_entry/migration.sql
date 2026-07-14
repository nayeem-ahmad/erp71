-- AlterTable
ALTER TABLE "Sale" ADD COLUMN     "sale_date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "PaymentMethod" ADD COLUMN     "show_on_entry" BOOLEAN NOT NULL DEFAULT true;

-- CreateIndex
CREATE INDEX "Sale_tenant_id_sale_date_idx" ON "Sale"("tenant_id", "sale_date");

-- Backfill: keep historical sales on their real date instead of the migration run time
UPDATE "Sale" SET "sale_date" = "created_at";
