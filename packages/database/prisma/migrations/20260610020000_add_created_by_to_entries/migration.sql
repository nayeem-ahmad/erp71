-- AlterTable: add created_by to all entry models

ALTER TABLE "Sale" ADD COLUMN "created_by" TEXT;

ALTER TABLE "Purchase" ADD COLUMN "created_by" TEXT;

ALTER TABLE "PurchaseReturn" ADD COLUMN "created_by" TEXT;

ALTER TABLE "SalesReturn" ADD COLUMN "created_by" TEXT;

ALTER TABLE "SalesOrder" ADD COLUMN "created_by" TEXT;

ALTER TABLE "PurchaseOrder" ADD COLUMN "created_by" TEXT;
