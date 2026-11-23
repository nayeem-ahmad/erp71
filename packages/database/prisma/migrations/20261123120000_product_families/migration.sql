-- Product families: storefront grouping of size/colour variants.
-- Each variant stays its own product; only the storefront reads the family.
-- Production applies schema via `prisma db push`; this file is the history.

CREATE TABLE "product_families" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "image_url" TEXT,
    "images_gallery" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "option_names" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "is_featured" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_families_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "product_families_tenant_id_idx" ON "product_families"("tenant_id");

ALTER TABLE "product_families" ADD CONSTRAINT "product_families_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Product" ADD COLUMN "family_id" TEXT;
ALTER TABLE "Product" ADD COLUMN "option_values" JSONB;

CREATE INDEX "Product_family_id_idx" ON "Product"("family_id");

ALTER TABLE "Product" ADD CONSTRAINT "Product_family_id_fkey" FOREIGN KEY ("family_id") REFERENCES "product_families"("id") ON DELETE SET NULL ON UPDATE CASCADE;
