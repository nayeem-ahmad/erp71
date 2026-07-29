-- A run previously wrote its stats only when it finished, so a long import was
-- opaque while it ran and lost its counters entirely if it crashed. These
-- columns are rewritten as the run proceeds.
--
-- `steps` records which parts of the import were requested, so a run can cover
-- just sales, or just payments, instead of always doing everything.

ALTER TABLE "ExternalSyncRun" ADD COLUMN "phase" TEXT;
ALTER TABLE "ExternalSyncRun" ADD COLUMN "progress" JSONB;
ALTER TABLE "ExternalSyncRun" ADD COLUMN "steps" JSONB;
ALTER TABLE "ExternalSyncRun" ADD COLUMN "cancel_requested" BOOLEAN NOT NULL DEFAULT false;
