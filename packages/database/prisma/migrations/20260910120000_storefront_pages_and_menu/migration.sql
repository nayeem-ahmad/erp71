-- Storefront pages and menu links: the non-product, non-blog parts of a shop's
-- public site ("About us", "Delivery & returns") and the header menu that
-- reaches them.
--
-- Two tables and one permission enum value. Nothing here backfills or rewrites
-- an existing row, and no column is dropped or narrowed.
--
-- Additive only. Production reconciles its schema with `prisma db push` on
-- container start and never runs this directory (see
-- 20260804090000_add_referral_commission_reversal for the same note), so this
-- exists to keep the migration history honest rather than because it is the
-- mechanism that ships the change.
--
-- The permission reaches EXISTING tenants' roles and members via
-- `sync-role-permissions.ts` (group `storefront-pages`), which runs in the
-- container start chain — not from this file. A new tenant picks it up from
-- ROLE_DEFAULT_PERMISSIONS at signup.

-- Added to packages/shared-types first, which typechecks but does not teach
-- Postgres about it: UserStorePermission.permission is this enum, so a grant
-- cannot be written at all until the value exists.
ALTER TYPE "StorePermission" ADD VALUE IF NOT EXISTS 'MANAGE_STOREFRONT_PAGES';

-- CreateTable
CREATE TABLE "storefront_pages" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body_md" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "seo_title" TEXT,
    "seo_description" TEXT,
    "published_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "storefront_pages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "storefront_menu_links" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'PAGE',
    "page_id" TEXT,
    "url" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "visible" BOOLEAN NOT NULL DEFAULT true,
    "open_in_new_tab" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "storefront_menu_links_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "storefront_pages_tenant_id_status_idx" ON "storefront_pages"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "storefront_pages_deleted_at_idx" ON "storefront_pages"("deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "storefront_pages_tenant_id_slug_key" ON "storefront_pages"("tenant_id", "slug");

-- CreateIndex
CREATE INDEX "storefront_menu_links_tenant_id_sort_order_idx" ON "storefront_menu_links"("tenant_id", "sort_order");

-- CreateIndex
CREATE INDEX "storefront_menu_links_page_id_idx" ON "storefront_menu_links"("page_id");

-- AddForeignKey
ALTER TABLE "storefront_pages" ADD CONSTRAINT "storefront_pages_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "storefront_menu_links" ADD CONSTRAINT "storefront_menu_links_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "storefront_menu_links" ADD CONSTRAINT "storefront_menu_links_page_id_fkey" FOREIGN KEY ("page_id") REFERENCES "storefront_pages"("id") ON DELETE SET NULL ON UPDATE CASCADE;
