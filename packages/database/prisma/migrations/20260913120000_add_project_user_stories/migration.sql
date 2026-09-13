-- User stories: the requirement a project is being asked for, with the tasks
-- that deliver it hanging off it. A second axis beside subtasks and milestones —
-- see the ProjectUserStory doc comment in schema.prisma for why it is not
-- `parent_task_id`.

-- CreateEnum
DO $$ BEGIN
    CREATE TYPE "ProjectUserStoryStatus" AS ENUM ('BACKLOG', 'READY', 'IN_PROGRESS', 'DONE');
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- CreateTable
CREATE TABLE IF NOT EXISTS "project_user_stories" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "reference" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "as_a" TEXT,
    "i_want" TEXT,
    "so_that" TEXT,
    "acceptance_criteria" TEXT,
    "status" "ProjectUserStoryStatus" NOT NULL DEFAULT 'BACKLOG',
    "priority" "ProjectPriority" NOT NULL DEFAULT 'MEDIUM',
    "story_points" INTEGER,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "project_user_stories_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
-- `US-3` is only unique within its project, which is the only place it is shown.
CREATE UNIQUE INDEX IF NOT EXISTS "project_user_stories_project_id_reference_key"
    ON "project_user_stories"("project_id", "reference");

-- CreateIndex
-- The backlog list: every story of one project, in board order.
CREATE INDEX IF NOT EXISTS "project_user_stories_tenant_id_project_id_sort_order_idx"
    ON "project_user_stories"("tenant_id", "project_id", "sort_order");

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "project_user_stories"
        ADD CONSTRAINT "project_user_stories_tenant_id_fkey"
        FOREIGN KEY ("tenant_id") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    ALTER TABLE "project_user_stories"
        ADD CONSTRAINT "project_user_stories_project_id_fkey"
        FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    ALTER TABLE "project_user_stories"
        ADD CONSTRAINT "project_user_stories_created_by_fkey"
        FOREIGN KEY ("created_by") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- AlterTable
-- NULL on every existing task: nothing had a story before this column, and a
-- task without one is a perfectly ordinary task.
ALTER TABLE "project_tasks" ADD COLUMN IF NOT EXISTS "user_story_id" TEXT;

-- AddForeignKey
-- ON DELETE SET NULL rather than CASCADE: deleting a story must never take the
-- work with it. `ProjectStoriesService.remove` detaches the tasks explicitly for
-- the same reason `removeMilestone` does; this is the backstop.
DO $$ BEGIN
    ALTER TABLE "project_tasks"
        ADD CONSTRAINT "project_tasks_user_story_id_fkey"
        FOREIGN KEY ("user_story_id") REFERENCES "project_user_stories"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- CreateIndex
-- Postgres does not index a foreign key for you, and "the tasks under this
-- story" is the one query the column exists to answer.
CREATE INDEX IF NOT EXISTS "project_tasks_tenant_id_user_story_id_idx"
    ON "project_tasks"("tenant_id", "user_story_id");
