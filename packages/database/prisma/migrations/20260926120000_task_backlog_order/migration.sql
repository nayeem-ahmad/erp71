-- A task's place in the Backlog tree, independent of its board-column order.
ALTER TABLE "project_tasks" ADD COLUMN "backlog_order" INTEGER NOT NULL DEFAULT 0;

-- Existing tasks keep the order the Backlog already showed them in.
UPDATE "project_tasks" SET "backlog_order" = "reference";
