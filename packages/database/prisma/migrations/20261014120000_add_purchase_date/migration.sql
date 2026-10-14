-- AlterTable
ALTER TABLE "Purchase" ADD COLUMN "purchase_date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateIndex
CREATE INDEX "Purchase_tenant_id_purchase_date_idx" ON "Purchase"("tenant_id", "purchase_date");

-- Backfill: a purchase recorded before this column existed happened when it was entered.
UPDATE "Purchase" SET "purchase_date" = "created_at";
