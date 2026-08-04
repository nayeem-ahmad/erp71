-- Project Management, Phase 3L — board columns belong to a project.
-- Scope: docs/projects/project-management-phase-3.md
--
-- THIS ONE MOVES DATA. Every other migration in this phase was additive.
--
-- Before: `project_task_statuses` was tenant-wide and every project's board
-- rendered the same columns. After: each project owns its columns, and the
-- tenant-level rows survive as a *template* (project_id IS NULL) that Project
-- Setup edits and new projects are seeded from.
--
-- The backfill gives every existing project a copy of the template and repoints
-- its tasks at the copy, so nothing appears to move on the day this ships. It
-- matches copies to originals by name, which is safe because the pre-migration
-- unique index made (tenant_id, name) unique.

ALTER TABLE "project_task_statuses" ADD COLUMN "project_id" TEXT;
ALTER TABLE "project_task_statuses" ADD COLUMN "wip_limit" INTEGER;

ALTER TABLE "project_task_statuses"
    ADD CONSTRAINT "project_task_statuses_project_id_fkey"
    FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 1. Copy the tenant template onto every project that has one.
--    `gen_random_uuid()` needs pgcrypto on older servers; Postgres 13+ has it
--    built in, and this schema already relies on 13+ elsewhere.
INSERT INTO "project_task_statuses"
    ("id", "tenant_id", "project_id", "name", "category", "sort_order", "is_active", "is_default", "wip_limit", "created_at", "updated_at")
SELECT
    gen_random_uuid()::text,
    s."tenant_id",
    p."id",
    s."name",
    s."category",
    s."sort_order",
    s."is_active",
    s."is_default",
    NULL,
    NOW(),
    NOW()
FROM "projects" p
JOIN "project_task_statuses" s ON s."tenant_id" = p."tenant_id" AND s."project_id" IS NULL;

-- 2. Repoint every task at its own project's copy, matched by name.
UPDATE "project_tasks" t
SET "status_id" = copy."id"
FROM "project_task_statuses" original
JOIN "project_task_statuses" copy
  ON copy."tenant_id" = original."tenant_id"
 AND copy."name" = original."name"
 AND copy."project_id" IS NOT NULL
WHERE t."status_id" = original."id"
  AND original."project_id" IS NULL
  AND copy."project_id" = t."project_id";

-- 3. Swap the uniqueness rule. Postgres treats NULLs as distinct, so this does
--    not constrain template rows — ProjectSettingsService checks those in code.
DROP INDEX IF EXISTS "project_task_statuses_tenant_id_name_key";
CREATE UNIQUE INDEX "project_task_statuses_tenant_id_project_id_name_key"
    ON "project_task_statuses"("tenant_id", "project_id", "name");
CREATE INDEX "project_task_statuses_tenant_id_project_id_sort_order_idx"
    ON "project_task_statuses"("tenant_id", "project_id", "sort_order");
