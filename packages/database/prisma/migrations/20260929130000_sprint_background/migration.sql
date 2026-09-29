-- Sprint backgrounds: the same colour-or-image background a board has, for the
-- sprint's card view. A property of the sprint rather than of the viewer, so
-- every member of a workspace sees the same sprint.

-- AlterTable
-- Nullable with no default: NULL is "the plain sprint", which is what every
-- existing row already looks like, so there is nothing to backfill.
ALTER TABLE "sprints" ADD COLUMN IF NOT EXISTS "background_color" TEXT;
ALTER TABLE "sprints" ADD COLUMN IF NOT EXISTS "background_image_url" TEXT;
-- The Cloudinary public_id behind the URL above, kept so a replaced background
-- can be deleted rather than stranded on the CDN.
ALTER TABLE "sprints" ADD COLUMN IF NOT EXISTS "background_image_key" TEXT;
