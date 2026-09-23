-- Customer and supplier payments record how the money moved: the payment
-- method picked on the form ("Cash", "bKash", …) and, when it was not the
-- posting rule's default, the ledger account the cash leg posted to.
--
-- Additive and nullable: rows written before this have neither, and they
-- posted to the rule's default cash account, which is what null means.

ALTER TABLE "CustomerCreditTransaction" ADD COLUMN IF NOT EXISTS "payment_method" TEXT;
ALTER TABLE "CustomerCreditTransaction" ADD COLUMN IF NOT EXISTS "account_id" TEXT;

ALTER TABLE "SupplierCreditTransaction" ADD COLUMN IF NOT EXISTS "payment_method" TEXT;
ALTER TABLE "SupplierCreditTransaction" ADD COLUMN IF NOT EXISTS "account_id" TEXT;
