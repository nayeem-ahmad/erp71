-- AlterTable: admin-granted subscription discount applied to future subscription fees.
-- discount_type: 'PERCENTAGE' (value = percent off) | 'FIXED' (value = amount off in BDT).
ALTER TABLE "TenantSubscription" ADD COLUMN "discount_type" TEXT;
ALTER TABLE "TenantSubscription" ADD COLUMN "discount_value" DECIMAL(12,2);
