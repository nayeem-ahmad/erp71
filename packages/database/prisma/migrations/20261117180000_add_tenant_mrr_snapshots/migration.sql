-- Platform KPIs, phase 2: one row per tenant per day with its MRR.
-- Production applies schema via `prisma db push`; this file is the history.

CREATE TABLE "tenant_mrr_snapshots" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "mrr" DECIMAL(12,2) NOT NULL,
    "plan_mrr" DECIMAL(12,2) NOT NULL,
    "addon_mrr" DECIMAL(12,2) NOT NULL,
    "plan_code" TEXT,
    "status" TEXT,
    "billing_cycle" TEXT,
    "source" TEXT NOT NULL DEFAULT 'daily',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenant_mrr_snapshots_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "tenant_mrr_snapshots_tenant_id_day_key" ON "tenant_mrr_snapshots"("tenant_id", "day");
CREATE INDEX "tenant_mrr_snapshots_day_idx" ON "tenant_mrr_snapshots"("day");
