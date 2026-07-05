-- AlterTable: admin-driven automation pipeline state on Feedback
-- (propose plan -> admin approve -> implement -> PR -> merge -> rollback)
ALTER TABLE "feedbacks" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'NEW';
ALTER TABLE "feedbacks" ADD COLUMN "adminInstruction" TEXT;
ALTER TABLE "feedbacks" ADD COLUMN "prNumber" INTEGER;
ALTER TABLE "feedbacks" ADD COLUMN "prUrl" TEXT;
ALTER TABLE "feedbacks" ADD COLUMN "mergeCommitSha" TEXT;
ALTER TABLE "feedbacks" ADD COLUMN "backupSnapshotId" TEXT;
ALTER TABLE "feedbacks" ADD COLUMN "deployedAt" TIMESTAMP(3);
ALTER TABLE "feedbacks" ADD COLUMN "lastError" TEXT;
ALTER TABLE "feedbacks" ADD COLUMN "rollbackPrNumber" INTEGER;
ALTER TABLE "feedbacks" ADD COLUMN "rollbackPrUrl" TEXT;
ALTER TABLE "feedbacks" ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateTable: versioned agent-proposed implementation plans, reviewed by a
-- platform admin before any code is written
CREATE TABLE "feedback_plans" (
    "id" TEXT NOT NULL,
    "feedbackId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "planText" TEXT NOT NULL,
    "hasMigration" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'PROPOSED',
    "adminComment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" TIMESTAMP(3),
    "reviewedBy" TEXT,

    CONSTRAINT "feedback_plans_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "feedback_plans_feedbackId_version_idx" ON "feedback_plans"("feedbackId", "version");

-- AddForeignKey
ALTER TABLE "feedback_plans" ADD CONSTRAINT "feedback_plans_feedbackId_fkey" FOREIGN KEY ("feedbackId") REFERENCES "feedbacks"("id") ON DELETE CASCADE ON UPDATE CASCADE;
