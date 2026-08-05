-- Short links and public quotation share tokens.
--
-- Sharing a quotation was blocked by there being nothing public to share, not
-- by link length: every quotation route is authenticated. `share_token` is the
-- authority for the public view and the short code is only an alias, so
-- clearing the token revokes every link ever sent for that quotation.
--
-- `tenant_id` is nullable because platform staff mint links while belonging to
-- no tenant.
--
-- Additive only. Production reconciles its schema with `prisma db push` on
-- container start and never runs this directory, so this file keeps the history
-- honest rather than being the mechanism that ships the change.

DO $$ BEGIN
    CREATE TYPE "ShortLinkKind" AS ENUM ('ENTITY', 'MANUAL');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE "ShortLinkEntity" AS ENUM ('QUOTATION', 'STOREFRONT_PRODUCT');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "ShortLink" (
    "id"            TEXT NOT NULL,
    "tenant_id"     TEXT,
    "code"          TEXT NOT NULL,
    "target_url"    TEXT NOT NULL,
    "label"         TEXT,
    "kind"          "ShortLinkKind" NOT NULL,
    "entity_type"   "ShortLinkEntity",
    "entity_id"     TEXT,
    "click_count"   INTEGER NOT NULL DEFAULT 0,
    "last_click_at" TIMESTAMP(3),
    "created_by"    TEXT,
    "created_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at"    TIMESTAMP(3),

    CONSTRAINT "ShortLink_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ShortLink_code_key" ON "ShortLink"("code");
CREATE INDEX IF NOT EXISTS "ShortLink_tenant_id_created_at_idx" ON "ShortLink"("tenant_id", "created_at");
CREATE INDEX IF NOT EXISTS "ShortLink_entity_type_entity_id_idx" ON "ShortLink"("entity_type", "entity_id");

DO $$ BEGIN
    ALTER TABLE "ShortLink"
        ADD CONSTRAINT "ShortLink_tenant_id_fkey"
        FOREIGN KEY ("tenant_id") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE "Quotation" ADD COLUMN IF NOT EXISTS "share_token" TEXT;
ALTER TABLE "Quotation" ADD COLUMN IF NOT EXISTS "share_token_at" TIMESTAMP(3);

CREATE UNIQUE INDEX IF NOT EXISTS "Quotation_share_token_key" ON "Quotation"("share_token");
