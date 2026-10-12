-- Record history: before/after snapshots of business records for platform admins.
-- Production runs `db push`, which creates the table from schema.prisma; this file
-- keeps migrate-based environments in step.

-- CreateTable
CREATE TABLE "RecordHistory" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "entity_label" TEXT,
    "action" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "changes" JSONB,
    "change_count" INTEGER NOT NULL DEFAULT 0,
    "user_id" TEXT,
    "ip_address" TEXT,
    "user_agent" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RecordHistory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RecordHistory_tenant_id_created_at_idx" ON "RecordHistory"("tenant_id", "created_at");

-- CreateIndex
CREATE INDEX "RecordHistory_entity_type_created_at_idx" ON "RecordHistory"("entity_type", "created_at");

-- CreateIndex
CREATE INDEX "RecordHistory_entity_type_entity_id_created_at_idx" ON "RecordHistory"("entity_type", "entity_id", "created_at");

-- CreateIndex
CREATE INDEX "RecordHistory_created_at_idx" ON "RecordHistory"("created_at");

-- AddForeignKey
ALTER TABLE "RecordHistory" ADD CONSTRAINT "RecordHistory_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecordHistory" ADD CONSTRAINT "RecordHistory_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

