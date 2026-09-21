-- Tasks had no number, so a task had no name anyone could say out loud and no
-- URL worth pasting. This numbers them per project, 1-based, the way user
-- stories are already numbered (ProjectUserStory.reference).
--
-- Backfilled in `created_at` order so the oldest task in each project is 1,
-- which is the numbering somebody reading the project would expect. Ties on
-- created_at — a bulk import writes many rows in the same millisecond — break
-- on id, so the result is deterministic rather than whatever order the planner
-- happened to produce.
--
-- Unique index last, after the backfill: before it, the second row fails.
--
-- project_code_history is created empty, and fills as codes are edited. A task
-- key is composed from its project's code, so without it changing PRJ-0002 to
-- ERP would invalidate every PRJ-0002-14 ever pasted anywhere.

ALTER TABLE "project_tasks" ADD COLUMN IF NOT EXISTS "reference" INTEGER;

WITH numbered AS (
    SELECT id, ROW_NUMBER() OVER (PARTITION BY project_id ORDER BY created_at, id) AS n
    FROM "project_tasks"
)
UPDATE "project_tasks" t
SET "reference" = numbered.n
FROM numbered
WHERE t.id = numbered.id AND t."reference" IS NULL;

ALTER TABLE "project_tasks" ALTER COLUMN "reference" SET NOT NULL;

CREATE TABLE IF NOT EXISTS "project_code_history" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "project_code_history_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "project_tasks_project_id_reference_key" ON "project_tasks"("project_id", "reference");
CREATE UNIQUE INDEX IF NOT EXISTS "project_code_history_tenant_id_code_key" ON "project_code_history"("tenant_id", "code");
CREATE INDEX IF NOT EXISTS "project_code_history_project_id_idx" ON "project_code_history"("project_id");

ALTER TABLE "project_code_history"
    ADD CONSTRAINT "project_code_history_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "project_code_history"
    ADD CONSTRAINT "project_code_history_project_id_fkey"
    FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
