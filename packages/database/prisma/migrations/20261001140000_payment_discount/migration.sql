-- Discount settled alongside a customer receipt / supplier payment.
ALTER TABLE "CustomerCreditTransaction" ADD COLUMN "discount_amount" DECIMAL(12,2) NOT NULL DEFAULT 0;
ALTER TABLE "SupplierCreditTransaction" ADD COLUMN "discount_amount" DECIMAL(12,2) NOT NULL DEFAULT 0;
