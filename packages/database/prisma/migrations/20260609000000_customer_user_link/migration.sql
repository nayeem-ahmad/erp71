-- AlterTable Customer: link to User for storefront authentication
ALTER TABLE "Customer" ADD COLUMN "user_id" TEXT;
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_user_id_key" UNIQUE ("user_id");
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AlterTable storefront_orders: track which authenticated user placed the order
ALTER TABLE "storefront_orders" ADD COLUMN "customerUserId" TEXT;
ALTER TABLE "storefront_orders" ADD CONSTRAINT "storefront_orders_customerUserId_fkey" FOREIGN KEY ("customerUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "storefront_orders_customerUserId_idx" ON "storefront_orders"("customerUserId");
