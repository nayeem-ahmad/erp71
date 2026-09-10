-- The shop's own logo in the storefront header, plus whether the store name is
-- printed beside it. The name is shown regardless when there is no logo.
ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "storefront_logo" TEXT;
ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "storefront_logo_show_name" BOOLEAN NOT NULL DEFAULT true;
