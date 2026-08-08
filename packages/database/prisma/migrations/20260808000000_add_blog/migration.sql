-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "StorePermission" ADD VALUE 'VIEW_BLOG';
ALTER TYPE "StorePermission" ADD VALUE 'MANAGE_BLOG';
ALTER TYPE "StorePermission" ADD VALUE 'PUBLISH_BLOG';

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "blog_last_seen_at" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "blog_posts" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "audience" TEXT NOT NULL DEFAULT 'BOTH',
    "category_id" TEXT,
    "cover_image_url" TEXT,
    "cover_storage_key" TEXT,
    "cover_alt" TEXT,
    "author_user_id" TEXT,
    "author_name" TEXT,
    "author_title" TEXT,
    "published_at" TIMESTAMP(3),
    "scheduled_for" TIMESTAMP(3),
    "edited_at" TIMESTAMP(3),
    "reading_minutes" INTEGER NOT NULL DEFAULT 0,
    "view_count" INTEGER NOT NULL DEFAULT 0,
    "featured" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "blog_posts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "blog_post_translations" (
    "id" TEXT NOT NULL,
    "post_id" TEXT NOT NULL,
    "locale" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "excerpt" TEXT,
    "body_md" TEXT NOT NULL,
    "seo_title" TEXT,
    "seo_description" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "blog_post_translations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "blog_categories" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name_en" TEXT NOT NULL,
    "name_bn" TEXT,
    "name_ms" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "blog_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "blog_post_slugs" (
    "id" TEXT NOT NULL,
    "post_id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "blog_post_slugs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant_blog_posts" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "category_id" TEXT,
    "title" TEXT NOT NULL,
    "excerpt" TEXT,
    "body_md" TEXT NOT NULL,
    "seo_title" TEXT,
    "seo_description" TEXT,
    "cover_image_url" TEXT,
    "cover_storage_key" TEXT,
    "cover_alt" TEXT,
    "author_user_id" TEXT,
    "author_name" TEXT,
    "published_at" TIMESTAMP(3),
    "scheduled_for" TIMESTAMP(3),
    "edited_at" TIMESTAMP(3),
    "reading_minutes" INTEGER NOT NULL DEFAULT 0,
    "view_count" INTEGER NOT NULL DEFAULT 0,
    "featured" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "tenant_blog_posts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant_blog_categories" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "tenant_blog_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant_blog_post_slugs" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "post_id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tenant_blog_post_slugs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant_blog_settings" (
    "tenant_id" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "title" TEXT,
    "tagline" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "updated_by" TEXT,

    CONSTRAINT "tenant_blog_settings_pkey" PRIMARY KEY ("tenant_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "blog_posts_slug_key" ON "blog_posts"("slug");

-- CreateIndex
CREATE INDEX "blog_posts_status_published_at_idx" ON "blog_posts"("status", "published_at");

-- CreateIndex
CREATE INDEX "blog_posts_category_id_status_published_at_idx" ON "blog_posts"("category_id", "status", "published_at");

-- CreateIndex
CREATE INDEX "blog_posts_deleted_at_idx" ON "blog_posts"("deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "blog_post_translations_post_id_locale_key" ON "blog_post_translations"("post_id", "locale");

-- CreateIndex
CREATE UNIQUE INDEX "blog_categories_slug_key" ON "blog_categories"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "blog_post_slugs_slug_key" ON "blog_post_slugs"("slug");

-- CreateIndex
CREATE INDEX "blog_post_slugs_post_id_idx" ON "blog_post_slugs"("post_id");

-- CreateIndex
CREATE INDEX "tenant_blog_posts_tenant_id_status_published_at_idx" ON "tenant_blog_posts"("tenant_id", "status", "published_at");

-- CreateIndex
CREATE INDEX "tenant_blog_posts_tenant_id_category_id_status_idx" ON "tenant_blog_posts"("tenant_id", "category_id", "status");

-- CreateIndex
CREATE INDEX "tenant_blog_posts_deleted_at_idx" ON "tenant_blog_posts"("deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "tenant_blog_posts_tenant_id_slug_key" ON "tenant_blog_posts"("tenant_id", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "tenant_blog_categories_tenant_id_slug_key" ON "tenant_blog_categories"("tenant_id", "slug");

-- CreateIndex
CREATE INDEX "tenant_blog_post_slugs_post_id_idx" ON "tenant_blog_post_slugs"("post_id");

-- CreateIndex
CREATE UNIQUE INDEX "tenant_blog_post_slugs_tenant_id_slug_key" ON "tenant_blog_post_slugs"("tenant_id", "slug");

-- AddForeignKey
ALTER TABLE "blog_posts" ADD CONSTRAINT "blog_posts_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "blog_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "blog_posts" ADD CONSTRAINT "blog_posts_author_user_id_fkey" FOREIGN KEY ("author_user_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "blog_post_translations" ADD CONSTRAINT "blog_post_translations_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "blog_posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "blog_post_slugs" ADD CONSTRAINT "blog_post_slugs_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "blog_posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_blog_posts" ADD CONSTRAINT "tenant_blog_posts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_blog_posts" ADD CONSTRAINT "tenant_blog_posts_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "tenant_blog_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_blog_posts" ADD CONSTRAINT "tenant_blog_posts_author_user_id_fkey" FOREIGN KEY ("author_user_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_blog_categories" ADD CONSTRAINT "tenant_blog_categories_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_blog_post_slugs" ADD CONSTRAINT "tenant_blog_post_slugs_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "tenant_blog_posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_blog_settings" ADD CONSTRAINT "tenant_blog_settings_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

