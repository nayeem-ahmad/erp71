-- AlterTable
ALTER TABLE "support_threads" ADD COLUMN "createdById" TEXT;

-- Backfill: the thread opener is the sender of its earliest message. Every
-- thread is created together with its first owner message, so this attributes
-- all existing rows; a thread with no messages stays NULL.
UPDATE "support_threads" t
SET "createdById" = m."senderId"
FROM (
    SELECT DISTINCT ON ("threadId") "threadId", "senderId"
    FROM "support_messages"
    ORDER BY "threadId", "createdAt" ASC, "id" ASC
) m
WHERE m."threadId" = t."id";

-- CreateIndex
CREATE INDEX "support_threads_createdById_idx" ON "support_threads"("createdById");

-- AddForeignKey
ALTER TABLE "support_threads" ADD CONSTRAINT "support_threads_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
