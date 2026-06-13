-- CreateTable
CREATE TABLE "JobRun" (
    "id" TEXT NOT NULL,
    "job_name" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMP(3),
    "duration_ms" INTEGER,
    "error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JobRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "JobRun_job_name_started_at_idx" ON "JobRun"("job_name", "started_at");

-- CreateIndex
CREATE INDEX "JobRun_job_name_status_finished_at_idx" ON "JobRun"("job_name", "status", "finished_at");
