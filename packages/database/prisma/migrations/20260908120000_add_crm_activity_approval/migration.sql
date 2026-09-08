-- Reviewer sign-off on planned CRM activities.
--
-- Advisory, not a lock: nothing in the API refuses to complete an unapproved
-- activity. The flag records what a reviewer has signed off so the team can work
-- the approved list, and so a manager can see what a cron raised overnight
-- before anyone starts dialling.

-- AlterTable
ALTER TABLE "CrmActivity" ADD COLUMN "is_approved" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "CrmActivity" ADD COLUMN "approved_by" TEXT;
ALTER TABLE "CrmActivity" ADD COLUMN "approved_at" TIMESTAMP(3);

-- Backfill. Only a PLANNED row is reviewable: a DONE row records a call that
-- already happened and a CANCELLED one is never going to be made, so neither is
-- a question a reviewer can still answer. Leaving them false would park the
-- whole back catalogue in the "awaiting approval" filter on the day this ships.
--
-- Existing PLANNED rows are deliberately left unapproved — that open backlog IS
-- the review queue this feature exists to create.
--
-- `approved_by` stays NULL on these: nobody actually approved them, and naming a
-- reviewer who did not look is worse than naming none.
UPDATE "CrmActivity" SET "is_approved" = true WHERE "status" <> 'PLANNED';

-- AddForeignKey
ALTER TABLE "CrmActivity" ADD CONSTRAINT "CrmActivity_approved_by_fkey" FOREIGN KEY ("approved_by") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateIndex
-- Serves the approval filter, which the Activities page nearly always combines
-- with the status filter it defaults to.
CREATE INDEX "CrmActivity_tenant_id_is_approved_status_due_at_idx" ON "CrmActivity"("tenant_id", "is_approved", "status", "due_at");
