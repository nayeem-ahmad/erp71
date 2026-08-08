-- CreateTable
CREATE TABLE "social_media_posts" (
    "id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "title" TEXT,
    "content" TEXT NOT NULL,
    "link_url" TEXT,
    "image_url" TEXT,
    "networks" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "scheduled_for" TIMESTAMP(3),
    "published_at" TIMESTAMP(3),
    "author_user_id" TEXT,
    "author_name" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "social_media_posts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "social_media_post_pushes" (
    "id" TEXT NOT NULL,
    "post_id" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'buffer',
    "channel_id" TEXT NOT NULL,
    "channel_service" TEXT,
    "channel_name" TEXT,
    "mode" TEXT NOT NULL DEFAULT 'addToQueue',
    "due_at" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'SENT',
    "external_post_id" TEXT,
    "error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,

    CONSTRAINT "social_media_post_pushes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "social_media_posts_status_scheduled_for_idx" ON "social_media_posts"("status", "scheduled_for");

-- CreateIndex
CREATE INDEX "social_media_posts_deleted_at_idx" ON "social_media_posts"("deleted_at");

-- CreateIndex
CREATE INDEX "social_media_post_pushes_post_id_idx" ON "social_media_post_pushes"("post_id");

-- AddForeignKey
ALTER TABLE "social_media_posts" ADD CONSTRAINT "social_media_posts_author_user_id_fkey" FOREIGN KEY ("author_user_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "social_media_post_pushes" ADD CONSTRAINT "social_media_post_pushes_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "social_media_posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
