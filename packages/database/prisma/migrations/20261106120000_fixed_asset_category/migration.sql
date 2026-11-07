-- A fixed asset may carry a free-text category (Furniture, Vehicles, IT
-- equipment) so the asset register can be filtered by it.
-- Production applies this with `db push`. The column is nullable and has no
-- backfill: every existing asset stays uncategorised until someone sets one.

-- AlterTable
ALTER TABLE "fixed_assets" ADD COLUMN "category" TEXT;

-- CreateIndex
CREATE INDEX "fixed_assets_tenant_id_category_idx" ON "fixed_assets"("tenant_id", "category");
