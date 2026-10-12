-- CreateEnum
CREATE TYPE "SprintTaskOutcome" AS ENUM ('DONE', 'CARRIED_OVER', 'RETURNED_TO_BACKLOG', 'REMOVED');

-- CreateEnum
CREATE TYPE "BurndownCause" AS ENUM ('STARTED', 'WORK_LOGGED', 'RE_ESTIMATED', 'TASK_ADDED', 'TASK_REMOVED', 'STATUS_CHANGED', 'COMPLETED', 'BACKFILLED');

-- CreateTable
CREATE TABLE "sprint_tasks" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "sprint_id" TEXT NOT NULL,
    "task_id" TEXT NOT NULL,
    "added_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "removed_at" TIMESTAMP(3),
    "outcome" "SprintTaskOutcome",
    "remaining_at_close" DECIMAL(8,2),
    "carried_to_sprint_id" TEXT,

    CONSTRAINT "sprint_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sprint_burndown_points" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "sprint_id" TEXT NOT NULL,
    "recorded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "remaining_hours" DECIMAL(10,2) NOT NULL,
    "committed_hours" DECIMAL(10,2) NOT NULL,
    "task_count" INTEGER NOT NULL,
    "done_task_count" INTEGER NOT NULL,
    "cause" "BurndownCause" NOT NULL,
    "task_id" TEXT,

    CONSTRAINT "sprint_burndown_points_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "sprint_tasks_tenant_id_sprint_id_idx" ON "sprint_tasks"("tenant_id", "sprint_id");

-- CreateIndex
CREATE INDEX "sprint_tasks_task_id_added_at_idx" ON "sprint_tasks"("task_id", "added_at");

-- CreateIndex
CREATE INDEX "sprint_burndown_points_sprint_id_recorded_at_idx" ON "sprint_burndown_points"("sprint_id", "recorded_at");

-- AddForeignKey
ALTER TABLE "sprint_tasks" ADD CONSTRAINT "sprint_tasks_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sprint_tasks" ADD CONSTRAINT "sprint_tasks_sprint_id_fkey" FOREIGN KEY ("sprint_id") REFERENCES "sprints"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sprint_tasks" ADD CONSTRAINT "sprint_tasks_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "project_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sprint_tasks" ADD CONSTRAINT "sprint_tasks_carried_to_sprint_id_fkey" FOREIGN KEY ("carried_to_sprint_id") REFERENCES "sprints"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sprint_burndown_points" ADD CONSTRAINT "sprint_burndown_points_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sprint_burndown_points" ADD CONSTRAINT "sprint_burndown_points_sprint_id_fkey" FOREIGN KEY ("sprint_id") REFERENCES "sprints"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sprint_burndown_points" ADD CONSTRAINT "sprint_burndown_points_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "project_tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- A task is in at most one open sprint at a time. Prisma cannot express a
-- partial unique index, so it lives here only; SprintMembershipService relies
-- on it to make a racing double-assign fail rather than fork the history.
CREATE UNIQUE INDEX "sprint_tasks_one_open" ON "sprint_tasks"("task_id") WHERE "removed_at" IS NULL;
