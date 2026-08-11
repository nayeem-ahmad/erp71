-- Optional profile photo for leads and contacts.
-- photo_storage_key holds Cloudinary's public_id: photo_url is a secure_url and
-- cannot be turned back into one, so without it a replaced photo is unreclaimable.
ALTER TABLE "Lead" ADD COLUMN "photo_url" TEXT;
ALTER TABLE "Lead" ADD COLUMN "photo_storage_key" TEXT;

ALTER TABLE "CrmContact" ADD COLUMN "photo_url" TEXT;
ALTER TABLE "CrmContact" ADD COLUMN "photo_storage_key" TEXT;
