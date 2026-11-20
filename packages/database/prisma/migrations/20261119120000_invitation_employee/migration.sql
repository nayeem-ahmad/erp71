-- An invitation may name the employee card the invitee becomes on acceptance.
-- Additive and nullable. Production applies schema via `prisma db push`; this
-- file is the history.

ALTER TABLE "UserInvitation" ADD COLUMN "employee_id" TEXT;

ALTER TABLE "UserInvitation"
    ADD CONSTRAINT "UserInvitation_employee_id_fkey"
    FOREIGN KEY ("employee_id") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;
