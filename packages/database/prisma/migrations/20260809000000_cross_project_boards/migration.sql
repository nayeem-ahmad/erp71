CREATE TABLE "boards" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),
    CONSTRAINT "boards_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "board_columns" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "board_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" "ProjectTaskStatusCategory" NOT NULL DEFAULT 'TODO',
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "wip_limit" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "board_columns_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "board_column_statuses" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "board_id" TEXT NOT NULL,
    "board_column_id" TEXT NOT NULL,
    "status_id" TEXT NOT NULL,
    CONSTRAINT "board_column_statuses_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "board_tasks" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "board_id" TEXT NOT NULL,
    "task_id" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "added_by" TEXT,
    "added_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "board_tasks_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "boards_tenant_id_deleted_at_idx" ON "boards"("tenant_id", "deleted_at");
CREATE UNIQUE INDEX "board_columns_board_id_name_key" ON "board_columns"("board_id", "name");
CREATE INDEX "board_columns_board_id_sort_order_idx" ON "board_columns"("board_id", "sort_order");
CREATE UNIQUE INDEX "board_column_statuses_board_id_status_id_key" ON "board_column_statuses"("board_id", "status_id");
CREATE INDEX "board_column_statuses_board_column_id_idx" ON "board_column_statuses"("board_column_id");
CREATE UNIQUE INDEX "board_tasks_board_id_task_id_key" ON "board_tasks"("board_id", "task_id");
CREATE INDEX "board_tasks_board_id_sort_order_idx" ON "board_tasks"("board_id", "sort_order");

ALTER TABLE "boards" ADD CONSTRAINT "boards_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "boards" ADD CONSTRAINT "boards_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "board_columns" ADD CONSTRAINT "board_columns_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "board_columns" ADD CONSTRAINT "board_columns_board_id_fkey" FOREIGN KEY ("board_id") REFERENCES "boards"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "board_column_statuses" ADD CONSTRAINT "board_column_statuses_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "board_column_statuses" ADD CONSTRAINT "board_column_statuses_board_column_id_fkey" FOREIGN KEY ("board_column_id") REFERENCES "board_columns"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "board_column_statuses" ADD CONSTRAINT "board_column_statuses_status_id_fkey" FOREIGN KEY ("status_id") REFERENCES "project_task_statuses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "board_tasks" ADD CONSTRAINT "board_tasks_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "board_tasks" ADD CONSTRAINT "board_tasks_board_id_fkey" FOREIGN KEY ("board_id") REFERENCES "boards"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "board_tasks" ADD CONSTRAINT "board_tasks_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "project_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "board_tasks" ADD CONSTRAINT "board_tasks_added_by_fkey" FOREIGN KEY ("added_by") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
