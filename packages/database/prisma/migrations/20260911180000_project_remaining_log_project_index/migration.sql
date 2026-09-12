-- The project-level burndown replays project_task_remaining_logs scoped by
-- project. The table indexes (tenant_id, sprint_id, changed_at) and
-- (task_id, changed_at); neither serves a project-scoped read, so without this
-- the burndown is a sequential scan of every remaining-hours row in the tenant.
--
-- CONCURRENTLY is deliberately NOT used: production applies the schema with
-- `prisma db push` rather than `migrate deploy` (see TODO.md), so this file is
-- the record of intent and `db push` is what actually creates the index.
CREATE INDEX IF NOT EXISTS "project_task_remaining_logs_tenant_id_project_id_changed_at_idx"
    ON "project_task_remaining_logs" ("tenant_id", "project_id", "changed_at");
