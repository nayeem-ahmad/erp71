-- Dual login (ERP owner/staff vs storefront customer) for the same identity.
--
-- 1. `Customer.user_id` was globally unique, so a User could be linked to at
--    most one Customer across the whole platform — the same person could not
--    register as a customer at a second storefront. Signup hit the constraint
--    and surfaced as a 500. Uniqueness belongs per tenant.
--
-- 2. `storefront_token_version` gives storefront sessions their own revocation
--    counter, so an ERP logout no longer invalidates the same person's
--    storefront customer sessions (both share the `User` row). A password
--    change bumps both.

-- DropIndex
DROP INDEX IF EXISTS "Customer_user_id_key";

-- CreateIndex
CREATE UNIQUE INDEX "Customer_tenant_id_user_id_key" ON "Customer"("tenant_id", "user_id");

-- AlterTable
ALTER TABLE "User" ADD COLUMN "storefront_token_version" INTEGER NOT NULL DEFAULT 0;
