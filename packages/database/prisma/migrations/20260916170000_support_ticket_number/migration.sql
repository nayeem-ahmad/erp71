-- Human-facing ticket numbers for support/feedback threads.
--
-- SERIAL rather than a backfill + counter table: adding a SERIAL column to a
-- populated table makes Postgres number the existing rows and leave the
-- sequence positioned past them, so every thread that already exists gets a
-- number and the next one created continues the series. That matters because
-- production applies schema with `prisma db push`, which carries the column but
-- never runs this file — `db push` generates the same statement, so there is
-- nothing here for a sync script to finish (contrast
-- prisma/sync-support-thread-creators.ts, where the backfill lived in SQL).

-- AlterTable
ALTER TABLE "support_threads" ADD COLUMN     "ticketNumber" SERIAL NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "support_threads_ticketNumber_key" ON "support_threads"("ticketNumber");
