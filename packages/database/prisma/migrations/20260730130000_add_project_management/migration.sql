-- Project Management, Phase 1.
-- Scope: docs/projects/project-management-phase-1.md

CREATE TYPE "ProjectStatus" AS ENUM ('DRAFT', 'ACTIVE', 'ON_HOLD', 'COMPLETED', 'CANCELLED');
CREATE TYPE "ProjectPriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'URGENT');
CREATE TYPE "ProjectMemberRole" AS ENUM ('MANAGER', 'MEMBER', 'VIEWER');
CREATE TYPE "ProjectTaskStatusCategory" AS ENUM ('TODO', 'IN_PROGRESS', 'DONE');
CREATE TYPE "SprintStatus" AS ENUM ('PLANNED', 'ACTIVE', 'COMPLETED');
CREATE TYPE "RemainingHoursSource" AS ENUM ('TASK_CREATED', 'TIME_LOGGED', 'RE_ESTIMATED', 'TASK_COMPLETED', 'TASK_REOPENED', 'TIME_ENTRY_DELETED');

CREATE TABLE "project_types" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "project_types_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "project_types_tenant_id_name_key" ON "project_types"("tenant_id", "name");
CREATE INDEX "project_types_tenant_id_is_active_idx" ON "project_types"("tenant_id", "is_active");

CREATE TABLE "projects" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "store_id" TEXT,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "customer_id" TEXT,
    "lead_id" TEXT,
    "project_type_id" TEXT,
    "status" "ProjectStatus" NOT NULL DEFAULT 'DRAFT',
    "priority" "ProjectPriority" NOT NULL DEFAULT 'MEDIUM',
    "manager_id" TEXT,
    "start_date" DATE,
    "target_end_date" DATE,
    "actual_end_date" DATE,
    "budget_amount" DECIMAL(14,2),
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),
    CONSTRAINT "projects_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "projects_tenant_id_code_key" ON "projects"("tenant_id", "code");
CREATE INDEX "projects_tenant_id_status_deleted_at_idx" ON "projects"("tenant_id", "status", "deleted_at");
CREATE INDEX "projects_tenant_id_customer_id_idx" ON "projects"("tenant_id", "customer_id");
CREATE INDEX "projects_tenant_id_manager_id_idx" ON "projects"("tenant_id", "manager_id");

CREATE TABLE "project_members" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "role" "ProjectMemberRole" NOT NULL DEFAULT 'MEMBER',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "project_members_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "project_members_project_id_user_id_key" ON "project_members"("project_id", "user_id");
CREATE INDEX "project_members_tenant_id_user_id_idx" ON "project_members"("tenant_id", "user_id");

CREATE TABLE "project_milestones" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "target_date" DATE,
    "completed_at" TIMESTAMP(3),
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "project_milestones_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "project_milestones_tenant_id_project_id_idx" ON "project_milestones"("tenant_id", "project_id");

CREATE TABLE "project_task_statuses" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" "ProjectTaskStatusCategory" NOT NULL DEFAULT 'TODO',
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "project_task_statuses_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "project_task_statuses_tenant_id_name_key" ON "project_task_statuses"("tenant_id", "name");
CREATE INDEX "project_task_statuses_tenant_id_is_active_sort_order_idx" ON "project_task_statuses"("tenant_id", "is_active", "sort_order");

CREATE TABLE "sprints" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "goal" TEXT,
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "status" "SprintStatus" NOT NULL DEFAULT 'PLANNED',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "sprints_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "sprints_tenant_id_project_id_status_idx" ON "sprints"("tenant_id", "project_id", "status");

CREATE TABLE "project_tasks" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "milestone_id" TEXT,
    "sprint_id" TEXT,
    "parent_task_id" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status_id" TEXT NOT NULL,
    "priority" "ProjectPriority" NOT NULL DEFAULT 'MEDIUM',
    "assignee_id" TEXT,
    "due_date" DATE,
    "estimate_hours" DECIMAL(8,2),
    "remaining_hours" DECIMAL(8,2),
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "completed_at" TIMESTAMP(3),
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),
    CONSTRAINT "project_tasks_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "project_tasks_tenant_id_project_id_deleted_at_idx" ON "project_tasks"("tenant_id", "project_id", "deleted_at");
CREATE INDEX "project_tasks_tenant_id_sprint_id_idx" ON "project_tasks"("tenant_id", "sprint_id");
CREATE INDEX "project_tasks_tenant_id_assignee_id_idx" ON "project_tasks"("tenant_id", "assignee_id");
CREATE INDEX "project_tasks_project_id_status_id_sort_order_idx" ON "project_tasks"("project_id", "status_id", "sort_order");

CREATE TABLE "project_task_remaining_logs" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "task_id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "sprint_id" TEXT,
    "previous_hours" DECIMAL(8,2),
    "new_hours" DECIMAL(8,2) NOT NULL,
    "delta" DECIMAL(8,2) NOT NULL,
    "source" "RemainingHoursSource" NOT NULL,
    "time_entry_id" TEXT,
    "note" TEXT,
    "changed_by" TEXT,
    "changed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "project_task_remaining_logs_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "project_task_remaining_logs_tenant_id_sprint_id_changed_at_idx" ON "project_task_remaining_logs"("tenant_id", "sprint_id", "changed_at");
CREATE INDEX "project_task_remaining_logs_task_id_changed_at_idx" ON "project_task_remaining_logs"("task_id", "changed_at");

CREATE TABLE "project_task_checklist_items" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "task_id" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "is_done" BOOLEAN NOT NULL DEFAULT false,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "project_task_checklist_items_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "project_task_checklist_items_task_id_sort_order_idx" ON "project_task_checklist_items"("task_id", "sort_order");

CREATE TABLE "project_time_entries" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "task_id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "user_id" TEXT,
    "employee_id" TEXT,
    "work_date" DATE NOT NULL,
    "hours" DECIMAL(8,2) NOT NULL,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "project_time_entries_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "project_time_entries_tenant_id_project_id_work_date_idx" ON "project_time_entries"("tenant_id", "project_id", "work_date");
CREATE INDEX "project_time_entries_task_id_work_date_idx" ON "project_time_entries"("task_id", "work_date");

CREATE TABLE "sprint_snapshots" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "sprint_id" TEXT NOT NULL,
    "snapshot_date" DATE NOT NULL,
    "remaining_hours" DECIMAL(10,2) NOT NULL,
    "committed_hours" DECIMAL(10,2) NOT NULL,
    "completed_hours" DECIMAL(10,2) NOT NULL,
    "task_count" INTEGER NOT NULL,
    "done_task_count" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "sprint_snapshots_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "sprint_snapshots_sprint_id_snapshot_date_key" ON "sprint_snapshots"("sprint_id", "snapshot_date");
CREATE INDEX "sprint_snapshots_tenant_id_sprint_id_snapshot_date_idx" ON "sprint_snapshots"("tenant_id", "sprint_id", "snapshot_date");

CREATE TABLE "project_comments" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "project_id" TEXT,
    "task_id" TEXT,
    "user_id" TEXT,
    "body" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "project_comments_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "project_comments_tenant_id_project_id_created_at_idx" ON "project_comments"("tenant_id", "project_id", "created_at");
CREATE INDEX "project_comments_tenant_id_task_id_created_at_idx" ON "project_comments"("tenant_id", "task_id", "created_at");

CREATE TABLE "project_attachments" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "project_id" TEXT,
    "task_id" TEXT,
    "file_url" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "mime_type" TEXT,
    "file_size" INTEGER,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "project_attachments_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "project_attachments_tenant_id_project_id_idx" ON "project_attachments"("tenant_id", "project_id");
CREATE INDEX "project_attachments_tenant_id_task_id_idx" ON "project_attachments"("tenant_id", "task_id");

ALTER TABLE "project_types" ADD CONSTRAINT "project_types_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "projects" ADD CONSTRAINT "projects_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "projects" ADD CONSTRAINT "projects_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "Store"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "projects" ADD CONSTRAINT "projects_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "projects" ADD CONSTRAINT "projects_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "Lead"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "projects" ADD CONSTRAINT "projects_project_type_id_fkey" FOREIGN KEY ("project_type_id") REFERENCES "project_types"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "projects" ADD CONSTRAINT "projects_manager_id_fkey" FOREIGN KEY ("manager_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "projects" ADD CONSTRAINT "projects_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "project_milestones" ADD CONSTRAINT "project_milestones_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "project_milestones" ADD CONSTRAINT "project_milestones_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "project_task_statuses" ADD CONSTRAINT "project_task_statuses_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "sprints" ADD CONSTRAINT "sprints_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "sprints" ADD CONSTRAINT "sprints_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "project_tasks" ADD CONSTRAINT "project_tasks_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "project_tasks" ADD CONSTRAINT "project_tasks_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "project_tasks" ADD CONSTRAINT "project_tasks_milestone_id_fkey" FOREIGN KEY ("milestone_id") REFERENCES "project_milestones"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "project_tasks" ADD CONSTRAINT "project_tasks_sprint_id_fkey" FOREIGN KEY ("sprint_id") REFERENCES "sprints"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "project_tasks" ADD CONSTRAINT "project_tasks_parent_task_id_fkey" FOREIGN KEY ("parent_task_id") REFERENCES "project_tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "project_tasks" ADD CONSTRAINT "project_tasks_status_id_fkey" FOREIGN KEY ("status_id") REFERENCES "project_task_statuses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "project_tasks" ADD CONSTRAINT "project_tasks_assignee_id_fkey" FOREIGN KEY ("assignee_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "project_tasks" ADD CONSTRAINT "project_tasks_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "project_task_remaining_logs" ADD CONSTRAINT "project_task_remaining_logs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "project_task_remaining_logs" ADD CONSTRAINT "project_task_remaining_logs_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "project_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "project_task_remaining_logs" ADD CONSTRAINT "project_task_remaining_logs_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "project_task_remaining_logs" ADD CONSTRAINT "project_task_remaining_logs_sprint_id_fkey" FOREIGN KEY ("sprint_id") REFERENCES "sprints"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "project_task_remaining_logs" ADD CONSTRAINT "project_task_remaining_logs_changed_by_fkey" FOREIGN KEY ("changed_by") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "project_task_checklist_items" ADD CONSTRAINT "project_task_checklist_items_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "project_task_checklist_items" ADD CONSTRAINT "project_task_checklist_items_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "project_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "project_time_entries" ADD CONSTRAINT "project_time_entries_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "project_time_entries" ADD CONSTRAINT "project_time_entries_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "project_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "project_time_entries" ADD CONSTRAINT "project_time_entries_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "project_time_entries" ADD CONSTRAINT "project_time_entries_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "project_time_entries" ADD CONSTRAINT "project_time_entries_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "sprint_snapshots" ADD CONSTRAINT "sprint_snapshots_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "sprint_snapshots" ADD CONSTRAINT "sprint_snapshots_sprint_id_fkey" FOREIGN KEY ("sprint_id") REFERENCES "sprints"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "project_comments" ADD CONSTRAINT "project_comments_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "project_comments" ADD CONSTRAINT "project_comments_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "project_comments" ADD CONSTRAINT "project_comments_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "project_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "project_comments" ADD CONSTRAINT "project_comments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "project_attachments" ADD CONSTRAINT "project_attachments_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "project_attachments" ADD CONSTRAINT "project_attachments_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "project_attachments" ADD CONSTRAINT "project_attachments_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "project_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Keep the DB-side permission enum in lockstep with packages/shared-types.
ALTER TYPE "StorePermission" ADD VALUE IF NOT EXISTS 'VIEW_PROJECTS';
ALTER TYPE "StorePermission" ADD VALUE IF NOT EXISTS 'MANAGE_PROJECTS';
ALTER TYPE "StorePermission" ADD VALUE IF NOT EXISTS 'MANAGE_PROJECT_TASKS';
ALTER TYPE "StorePermission" ADD VALUE IF NOT EXISTS 'LOG_PROJECT_TIME';
ALTER TYPE "StorePermission" ADD VALUE IF NOT EXISTS 'MANAGE_SPRINTS';
ALTER TYPE "StorePermission" ADD VALUE IF NOT EXISTS 'MANAGE_PROJECT_SETTINGS';
