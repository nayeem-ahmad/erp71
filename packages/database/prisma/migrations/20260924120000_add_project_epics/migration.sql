-- Epics: the parent of user stories (epic -> story -> task). A new table and a
-- nullable story column, so nothing existing needs a backfill.

-- CreateEnum
CREATE TYPE "ProjectEpicStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'DONE', 'CANCELLED');

-- AlterTable
ALTER TABLE "project_user_stories" ADD COLUMN     "epic_id" TEXT;

-- CreateTable
CREATE TABLE "project_epics" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "reference" INTEGER NOT NULL,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" "ProjectEpicStatus" NOT NULL DEFAULT 'OPEN',
    "priority" "ProjectPriority" NOT NULL DEFAULT 'MEDIUM',
    "color" "ProjectLabelColor" NOT NULL DEFAULT 'BLUE',
    "start_date" DATE,
    "target_date" DATE,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "project_epics_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "project_epics_tenant_id_project_id_sort_order_idx" ON "project_epics"("tenant_id", "project_id", "sort_order");

-- CreateIndex
CREATE UNIQUE INDEX "project_epics_project_id_reference_key" ON "project_epics"("project_id", "reference");

-- CreateIndex
CREATE UNIQUE INDEX "project_epics_project_id_code_key" ON "project_epics"("project_id", "code");

-- CreateIndex
CREATE INDEX "project_user_stories_tenant_id_epic_id_idx" ON "project_user_stories"("tenant_id", "epic_id");

-- AddForeignKey
ALTER TABLE "project_epics" ADD CONSTRAINT "project_epics_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_epics" ADD CONSTRAINT "project_epics_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_epics" ADD CONSTRAINT "project_epics_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_user_stories" ADD CONSTRAINT "project_user_stories_epic_id_fkey" FOREIGN KEY ("epic_id") REFERENCES "project_epics"("id") ON DELETE SET NULL ON UPDATE CASCADE;

