-- CreateEnum
CREATE TYPE "ProductType" AS ENUM ('GOODS', 'SERVICE');

-- AlterTable: distinguish physical goods (stock-tracked) from services (printing,
-- binding, transport, ...) that can be bought/sold without ever holding inventory.
ALTER TABLE "Product" ADD COLUMN "type" "ProductType" NOT NULL DEFAULT 'GOODS';
