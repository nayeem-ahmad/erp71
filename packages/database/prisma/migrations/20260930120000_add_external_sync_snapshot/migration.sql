-- Durable extract of a provider pull. Manual imports write from the file so
-- the live ERP does not have to stay reachable after extract.

CREATE TABLE "ExternalSyncSnapshot" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "connection_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'EXTRACTING',
    "window_from" TIMESTAMP(3) NOT NULL,
    "window_to" TIMESTAMP(3) NOT NULL,
    "counts" JSONB,
    "byte_size" INTEGER,
    "sha256" TEXT,
    "error_message" TEXT,
    "phase" TEXT,
    "progress" JSONB,
    "cancel_requested" BOOLEAN NOT NULL DEFAULT false,
    "extracted_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMP(3),

    CONSTRAINT "ExternalSyncSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ExternalSyncSnapshot_tenant_id_created_at_idx" ON "ExternalSyncSnapshot"("tenant_id", "created_at");
CREATE INDEX "ExternalSyncSnapshot_connection_id_created_at_idx" ON "ExternalSyncSnapshot"("connection_id", "created_at");

ALTER TABLE "ExternalSyncSnapshot"
    ADD CONSTRAINT "ExternalSyncSnapshot_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ExternalSyncSnapshot"
    ADD CONSTRAINT "ExternalSyncSnapshot_connection_id_fkey"
    FOREIGN KEY ("connection_id") REFERENCES "ExternalSyncConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ExternalSyncRun" ADD COLUMN "snapshot_id" TEXT;
ALTER TABLE "ExternalSyncRun"
    ADD CONSTRAINT "ExternalSyncRun_snapshot_id_fkey"
    FOREIGN KEY ("snapshot_id") REFERENCES "ExternalSyncSnapshot"("id") ON DELETE SET NULL ON UPDATE CASCADE;
