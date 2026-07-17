-- CreateTable
CREATE TABLE "demo_data_batches" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "batch_number" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "phase" TEXT,
    "processed" INTEGER NOT NULL DEFAULT 0,
    "total" INTEGER NOT NULL DEFAULT 0,
    "counts" JSONB,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMP(3),
    "error" TEXT,

    CONSTRAINT "demo_data_batches_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "demo_data_batches_tenant_id_idx" ON "demo_data_batches"("tenant_id");
