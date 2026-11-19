-- Employee.user_id: one employee per login per workspace, not across every
-- workspace. The old index refused to link a person who is staff in two
-- workspaces, and surfaced as a 500 because the service only checked within
-- the current one. Every existing row already satisfies the new index — it is
-- strictly weaker than the old one.
-- Production applies schema via `prisma db push`; this file is the history.

DROP INDEX "Employee_user_id_key";
CREATE UNIQUE INDEX "Employee_tenant_id_user_id_key" ON "Employee"("tenant_id", "user_id");

-- Stamp each existing hour log with the employee its login is linked to.
-- Production runs the same statement as `sync:time-entry-employee`
-- (prisma/sync-time-entry-employee.ts) — keep the two in step.
UPDATE "project_time_entries" AS te
SET "employee_id" = e."id"
FROM "Employee" AS e
WHERE te."employee_id" IS NULL
  AND te."user_id" IS NOT NULL
  AND e."tenant_id" = te."tenant_id"
  AND e."user_id" = te."user_id"
  AND e."deleted_at" IS NULL;
