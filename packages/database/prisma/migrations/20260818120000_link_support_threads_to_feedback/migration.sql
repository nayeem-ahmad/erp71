-- AlterTable
ALTER TABLE "support_threads" ADD COLUMN "category" TEXT NOT NULL DEFAULT 'support';
ALTER TABLE "support_threads" ADD COLUMN "page" TEXT;
ALTER TABLE "support_threads" ADD COLUMN "feedbackId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "support_threads_feedbackId_key" ON "support_threads"("feedbackId");
CREATE INDEX "support_threads_tenantId_category_idx" ON "support_threads"("tenantId", "category");

-- AddForeignKey
ALTER TABLE "support_threads" ADD CONSTRAINT "support_threads_feedbackId_fkey" FOREIGN KEY ("feedbackId") REFERENCES "feedbacks"("id") ON DELETE SET NULL ON UPDATE CASCADE;
