-- Board backgrounds: a colour from the fixed palette in shared-types, or an
-- uploaded image. A property of the board rather than of the viewer, so every
-- member of a workspace sees the same board.

-- AlterTable
-- Nullable with no default: NULL is "the plain board", which is what every
-- existing row already looks like, so there is nothing to backfill.
ALTER TABLE "boards" ADD COLUMN IF NOT EXISTS "background_color" TEXT;
ALTER TABLE "boards" ADD COLUMN IF NOT EXISTS "background_image_url" TEXT;
-- The Cloudinary public_id behind the URL above. Kept because a secure_url
-- cannot be turned back into one, and without it a replaced background is
-- stranded on the CDN and billed forever.
ALTER TABLE "boards" ADD COLUMN IF NOT EXISTS "background_image_key" TEXT;
