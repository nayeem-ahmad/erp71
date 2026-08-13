-- Per-click analytics for the URL shortener.
--
-- `ShortLink.click_count` only ever answered "how many". This table keeps the
-- context of each click — referrer, campaign tags, device, geo — because none of
-- it can be reconstructed from a counter after the fact.
--
-- Derived columns (`referrer_host`, `channel`, `browser`, `os`, `device_type`)
-- sit next to the raw values they came from on purpose: reports group by the
-- derived ones, and the raw ones stay so parsing can be improved and re-run.
--
-- Additive only. Production reconciles its schema with `prisma db push` on
-- container start and never runs this directory, so this file keeps the history
-- honest rather than being the mechanism that ships the change.

CREATE TABLE IF NOT EXISTS "ShortLinkClick" (
    "id"            TEXT NOT NULL,
    "short_link_id" TEXT NOT NULL,
    "tenant_id"     TEXT,
    "code"          TEXT NOT NULL,
    "occurred_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    "referrer"      TEXT,
    "referrer_host" TEXT,
    "channel"       TEXT,

    "utm_source"    TEXT,
    "utm_medium"    TEXT,
    "utm_campaign"  TEXT,
    "utm_term"      TEXT,
    "utm_content"   TEXT,
    "query"         TEXT,

    "user_agent"    TEXT,
    "browser"       TEXT,
    "os"            TEXT,
    "device_type"   TEXT,
    "is_bot"        BOOLEAN NOT NULL DEFAULT false,

    "ip_address"    TEXT,
    "country"       TEXT,
    "city"          TEXT,
    "language"      TEXT,

    CONSTRAINT "ShortLinkClick_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ShortLinkClick_short_link_id_occurred_at_idx"
    ON "ShortLinkClick"("short_link_id", "occurred_at");
CREATE INDEX IF NOT EXISTS "ShortLinkClick_tenant_id_occurred_at_idx"
    ON "ShortLinkClick"("tenant_id", "occurred_at");
CREATE INDEX IF NOT EXISTS "ShortLinkClick_code_occurred_at_idx"
    ON "ShortLinkClick"("code", "occurred_at");

DO $$ BEGIN
    ALTER TABLE "ShortLinkClick"
        ADD CONSTRAINT "ShortLinkClick_short_link_id_fkey"
        FOREIGN KEY ("short_link_id") REFERENCES "ShortLink"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
