-- Soft-delete support for referees with ledger history
ALTER TABLE "Referee" ADD COLUMN "deleted_at" TIMESTAMP(3);

CREATE INDEX "Referee_deleted_at_idx" ON "Referee"("deleted_at");