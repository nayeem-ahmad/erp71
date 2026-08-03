-- Project Management, Phase 3I — task activity feed and watchers.
-- Scope: docs/projects/project-management-phase-3.md
--
-- Additive: two new tables and one enum. `project_comments` already exists from
-- Phase 1 and is unchanged — it had a model and no API until now.

CREATE TYPE "ProjectTaskActivityType" AS ENUM (
    'CREATED',
    'RENAMED',
    'STATUS_CHANGED',
    'ASSIGNED',
    'PRIORITY_CHANGED',
    'DATES_CHANGED',
    'LABELS_CHANGED',
    'RE_ESTIMATED'
);

CREATE TABLE "project_task_activities" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "task_id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "type" "ProjectTaskActivityType" NOT NULL,
    "data" JSONB,
    "actor_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "project_task_activities_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "project_task_activities_task_id_created_at_idx"
    ON "project_task_activities"("task_id", "created_at");
CREATE INDEX "project_task_activities_tenant_id_project_id_created_at_idx"
    ON "project_task_activities"("tenant_id", "project_id", "created_at");

ALTER TABLE "project_task_activities"
    ADD CONSTRAINT "project_task_activities_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "project_task_activities"
    ADD CONSTRAINT "project_task_activities_task_id_fkey"
    FOREIGN KEY ("task_id") REFERENCES "project_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "project_task_activities"
    ADD CONSTRAINT "project_task_activities_project_id_fkey"
    FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "project_task_activities"
    ADD CONSTRAINT "project_task_activities_actor_id_fkey"
    FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "project_task_watchers" (
    "tenant_id" TEXT NOT NULL,
    "task_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "project_task_watchers_pkey" PRIMARY KEY ("task_id", "user_id")
);

CREATE INDEX "project_task_watchers_tenant_id_user_id_idx"
    ON "project_task_watchers"("tenant_id", "user_id");

ALTER TABLE "project_task_watchers"
    ADD CONSTRAINT "project_task_watchers_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "project_task_watchers"
    ADD CONSTRAINT "project_task_watchers_task_id_fkey"
    FOREIGN KEY ("task_id") REFERENCES "project_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "project_task_watchers"
    ADD CONSTRAINT "project_task_watchers_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
