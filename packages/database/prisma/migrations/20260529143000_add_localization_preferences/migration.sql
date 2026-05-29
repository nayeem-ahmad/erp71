-- AlterTable
ALTER TABLE "User"
    ADD COLUMN IF NOT EXISTS "preferred_locale" TEXT NOT NULL DEFAULT 'en';

-- AlterTable
ALTER TABLE "Tenant"
    ADD COLUMN IF NOT EXISTS "default_locale" TEXT NOT NULL DEFAULT 'en';