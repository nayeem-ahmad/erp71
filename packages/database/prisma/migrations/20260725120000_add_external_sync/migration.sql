-- Platform-admin managed pull-sync from third-party ERPs (first provider:
-- Express Retail Pro). Three tables: the per-tenant connection, an id map that
-- makes re-imports idempotent, and a run log.

CREATE TABLE "ExternalSyncConnection" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "base_url" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "password_encrypted" TEXT NOT NULL,
    "external_org_id" TEXT,
    "store_id" TEXT NOT NULL,
    "document_prefix" TEXT NOT NULL DEFAULT 'XR-',
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "window_days" INTEGER NOT NULL DEFAULT 90,
    "history_start_date" TIMESTAMP(3),
    "last_run_at" TIMESTAMP(3),
    "last_success_at" TIMESTAMP(3),
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExternalSyncConnection_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ExternalSyncMapping" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "connection_id" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "external_id" TEXT NOT NULL,
    "internal_id" TEXT NOT NULL,
    "external_updated_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExternalSyncMapping_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ExternalSyncRun" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "connection_id" TEXT NOT NULL,
    "trigger" TEXT NOT NULL DEFAULT 'MANUAL',
    "status" TEXT NOT NULL DEFAULT 'RUNNING',
    "window_from" TIMESTAMP(3) NOT NULL,
    "window_to" TIMESTAMP(3) NOT NULL,
    "dry_run" BOOLEAN NOT NULL DEFAULT false,
    "stats" JSONB,
    "warnings" JSONB,
    "error_message" TEXT,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMP(3),
    "triggered_by" TEXT,

    CONSTRAINT "ExternalSyncRun_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ExternalSyncConnection_tenant_id_provider_key" ON "ExternalSyncConnection"("tenant_id", "provider");
CREATE INDEX "ExternalSyncConnection_enabled_idx" ON "ExternalSyncConnection"("enabled");

CREATE UNIQUE INDEX "ExternalSyncMapping_connection_id_entity_type_external_id_key" ON "ExternalSyncMapping"("connection_id", "entity_type", "external_id");
CREATE INDEX "ExternalSyncMapping_tenant_id_entity_type_idx" ON "ExternalSyncMapping"("tenant_id", "entity_type");
CREATE INDEX "ExternalSyncMapping_connection_id_entity_type_internal_id_idx" ON "ExternalSyncMapping"("connection_id", "entity_type", "internal_id");

CREATE INDEX "ExternalSyncRun_tenant_id_started_at_idx" ON "ExternalSyncRun"("tenant_id", "started_at");
CREATE INDEX "ExternalSyncRun_connection_id_started_at_idx" ON "ExternalSyncRun"("connection_id", "started_at");

ALTER TABLE "ExternalSyncConnection" ADD CONSTRAINT "ExternalSyncConnection_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ExternalSyncConnection" ADD CONSTRAINT "ExternalSyncConnection_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ExternalSyncMapping" ADD CONSTRAINT "ExternalSyncMapping_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ExternalSyncMapping" ADD CONSTRAINT "ExternalSyncMapping_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "ExternalSyncConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ExternalSyncRun" ADD CONSTRAINT "ExternalSyncRun_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ExternalSyncRun" ADD CONSTRAINT "ExternalSyncRun_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "ExternalSyncConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;
