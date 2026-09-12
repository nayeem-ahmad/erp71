-- Per-tenant password complexity, editable by a tenant admin at
-- Settings › Password Policy.
--
-- Every column carries a default and every existing row takes it, so nothing a
-- workspace already has changes on the day this lands: eight characters is what
-- the product enforced before, and the character-class rules all start off.
--
-- `password_block_common` is the one default that is not simply the status quo.
-- It rejects the passwords that top every credential-stuffing list, and it only
-- applies when somebody *chooses* a password — no existing password stops
-- working, and no one is signed out. A workspace that would rather not can turn
-- it off on the settings page.
--
-- `password_min_length` is a floor of 8 in the application
-- (`PASSWORD_MIN_LENGTH_FLOOR` in shared-types clamps both reads and writes), so
-- the guarantee holds even against a row written by hand.
--
-- Production reconciles with `prisma db push` rather than running migrations
-- (see apps/backend/Dockerfile), so this file is the record; `IF NOT EXISTS`
-- keeps it a no-op on a database `db push` has already reached.
ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "password_min_length" INTEGER NOT NULL DEFAULT 8;
ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "password_require_uppercase" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "password_require_lowercase" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "password_require_number" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "password_require_symbol" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "password_block_common" BOOLEAN NOT NULL DEFAULT true;
