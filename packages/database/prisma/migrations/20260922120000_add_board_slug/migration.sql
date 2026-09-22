-- A board is one of the two things people in this app send each other, and it
-- was addressed by a raw UUID. This gives it a readable key.
--
-- The column is added nullable, backfilled, and only then made NOT NULL with a
-- unique index: a unique index created before the backfill fails on the second
-- row, because every existing board has no slug at all.
--
-- Slugs are derived the way the application derives them (lowercase,
-- non-alphanumerics to hyphens, collapsed, trimmed, capped at 60), with a
-- counter appended inside a tenant when two names collide. The character class
-- keeps the Bengali block as well as ASCII, matching `slugify` in
-- apps/backend/src/projects/url-keys/board-slug.ts — a board named in Bengali
-- must not backfill to an empty slug. The expression was checked against all
-- seven production board names on 2026-09-22: otb, otb-tahsin, board-1, erp71,
-- jobxprss, kraftize, mlb, with no collisions.
--
-- board_slug_history is created empty. It fills as boards are renamed, and its
-- unique spans history so a slug freed by a rename cannot be handed to another
-- board and silently steal the first one's links.

ALTER TABLE "boards" ADD COLUMN IF NOT EXISTS "slug" TEXT;

WITH slugged AS (
    SELECT
        id,
        tenant_id,
        NULLIF(
            TRIM(BOTH '-' FROM REGEXP_REPLACE(LOWER(name), '[^a-z0-9ঀ-৿]+', '-', 'g')),
            ''
        ) AS base
    FROM "boards"
),
resolved AS (
    SELECT
        id,
        COALESCE(base, 'board-' || SUBSTRING(id::text, 1, 8)) AS base,
        ROW_NUMBER() OVER (
            PARTITION BY tenant_id, COALESCE(base, 'board-' || SUBSTRING(id::text, 1, 8))
            ORDER BY id
        ) AS n
    FROM slugged
)
UPDATE "boards" b
SET "slug" = CASE WHEN r.n = 1 THEN LEFT(r.base, 60) ELSE LEFT(r.base, 57) || '-' || r.n END
FROM resolved r
WHERE b.id = r.id AND b."slug" IS NULL;

ALTER TABLE "boards" ALTER COLUMN "slug" SET NOT NULL;

CREATE TABLE IF NOT EXISTS "board_slug_history" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "board_id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "board_slug_history_pkey" PRIMARY KEY ("id")
);

-- Unique indexes last, per the note above.
CREATE UNIQUE INDEX IF NOT EXISTS "boards_tenant_id_slug_key" ON "boards"("tenant_id", "slug");
CREATE UNIQUE INDEX IF NOT EXISTS "board_slug_history_tenant_id_slug_key" ON "board_slug_history"("tenant_id", "slug");
CREATE INDEX IF NOT EXISTS "board_slug_history_board_id_idx" ON "board_slug_history"("board_id");

ALTER TABLE "board_slug_history"
    ADD CONSTRAINT "board_slug_history_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "board_slug_history"
    ADD CONSTRAINT "board_slug_history_board_id_fkey"
    FOREIGN KEY ("board_id") REFERENCES "boards"("id") ON DELETE CASCADE ON UPDATE CASCADE;
