-- A user story gets an ID people can see, say and edit — `OTB-3` — rather than
-- the fixed `US-3` composed from its per-project reference.
--
-- Backfilled from the project's current code and the story's existing
-- reference, so every story keeps the number it already had. Nullable first,
-- then backfilled, then NOT NULL; unique index last, after the backfill.
--
-- Production runs `db push`, not this migration — `prisma/sync-story-code.ts`
-- does the same backfill ahead of it.

ALTER TABLE "project_user_stories" ADD COLUMN IF NOT EXISTS "code" TEXT;

UPDATE "project_user_stories" s
SET "code" = p."code" || '-' || s."reference"
FROM "projects" p
WHERE s."project_id" = p."id" AND s."code" IS NULL;

ALTER TABLE "project_user_stories" ALTER COLUMN "code" SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "project_user_stories_project_id_code_key"
    ON "project_user_stories"("project_id", "code");
