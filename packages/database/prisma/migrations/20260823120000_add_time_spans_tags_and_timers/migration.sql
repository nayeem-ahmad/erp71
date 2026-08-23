-- AlterTable
ALTER TABLE "project_time_entries" ADD COLUMN     "ended_at" TIMESTAMP(3),
ADD COLUMN     "started_at" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "project_time_tags" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" "ProjectLabelColor" NOT NULL DEFAULT 'GRAY',
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "project_time_tags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_time_entry_tags" (
    "tenant_id" TEXT NOT NULL,
    "entry_id" TEXT NOT NULL,
    "tag_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "project_time_entry_tags_pkey" PRIMARY KEY ("entry_id","tag_id")
);

-- CreateTable
CREATE TABLE "project_timers" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "task_id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" TEXT,
    "tag_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "project_timers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "project_time_tags_tenant_id_sort_order_idx" ON "project_time_tags"("tenant_id", "sort_order");

-- CreateIndex
CREATE UNIQUE INDEX "project_time_tags_tenant_id_name_key" ON "project_time_tags"("tenant_id", "name");

-- CreateIndex
CREATE INDEX "project_time_entry_tags_tenant_id_tag_id_idx" ON "project_time_entry_tags"("tenant_id", "tag_id");

-- CreateIndex
CREATE INDEX "project_timers_tenant_id_task_id_idx" ON "project_timers"("tenant_id", "task_id");

-- CreateIndex
CREATE UNIQUE INDEX "project_timers_tenant_id_user_id_key" ON "project_timers"("tenant_id", "user_id");

-- CreateIndex
CREATE INDEX "project_time_entries_tenant_id_user_id_started_at_idx" ON "project_time_entries"("tenant_id", "user_id", "started_at");

-- AddForeignKey
ALTER TABLE "project_time_tags" ADD CONSTRAINT "project_time_tags_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_time_entry_tags" ADD CONSTRAINT "project_time_entry_tags_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_time_entry_tags" ADD CONSTRAINT "project_time_entry_tags_entry_id_fkey" FOREIGN KEY ("entry_id") REFERENCES "project_time_entries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_time_entry_tags" ADD CONSTRAINT "project_time_entry_tags_tag_id_fkey" FOREIGN KEY ("tag_id") REFERENCES "project_time_tags"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_timers" ADD CONSTRAINT "project_timers_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_timers" ADD CONSTRAINT "project_timers_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_timers" ADD CONSTRAINT "project_timers_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "project_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_timers" ADD CONSTRAINT "project_timers_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

