-- Project Management, Phase 3F + 3H — task labels and a start date.
-- Scope: docs/projects/project-management-phase-3.md
--
-- Purely additive: one nullable column and two new tables. Nothing existing
-- changes shape, so this deploys ahead of the application without breaking the
-- running one.

CREATE TYPE "ProjectLabelColor" AS ENUM ('GRAY', 'BLUE', 'EMERALD', 'AMBER', 'RED', 'PURPLE');

ALTER TABLE "project_tasks" ADD COLUMN "start_date" DATE;

CREATE TABLE "project_labels" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" "ProjectLabelColor" NOT NULL DEFAULT 'GRAY',
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "project_labels_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "project_labels_tenant_id_name_key" ON "project_labels"("tenant_id", "name");
CREATE INDEX "project_labels_tenant_id_sort_order_idx" ON "project_labels"("tenant_id", "sort_order");

ALTER TABLE "project_labels"
    ADD CONSTRAINT "project_labels_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "project_task_labels" (
    "tenant_id" TEXT NOT NULL,
    "task_id" TEXT NOT NULL,
    "label_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "project_task_labels_pkey" PRIMARY KEY ("task_id", "label_id")
);

CREATE INDEX "project_task_labels_tenant_id_label_id_idx" ON "project_task_labels"("tenant_id", "label_id");

ALTER TABLE "project_task_labels"
    ADD CONSTRAINT "project_task_labels_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "project_task_labels"
    ADD CONSTRAINT "project_task_labels_task_id_fkey"
    FOREIGN KEY ("task_id") REFERENCES "project_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "project_task_labels"
    ADD CONSTRAINT "project_task_labels_label_id_fkey"
    FOREIGN KEY ("label_id") REFERENCES "project_labels"("id") ON DELETE CASCADE ON UPDATE CASCADE;
