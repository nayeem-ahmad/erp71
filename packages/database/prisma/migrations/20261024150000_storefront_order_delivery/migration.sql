-- Delivery address on web orders, and the shop's opt-in for order-update texts.
ALTER TABLE "storefront_orders" ADD COLUMN IF NOT EXISTS "deliveryAddress" TEXT;
ALTER TABLE "storefront_orders" ADD COLUMN IF NOT EXISTS "deliveryArea" TEXT;
ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "storefront_order_sms" BOOLEAN NOT NULL DEFAULT false;
