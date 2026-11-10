-- Per-tenant customer segmentation thresholds. Absent row = platform defaults.
CREATE TABLE "customer_segment_settings" (
    "tenant_id" TEXT NOT NULL,
    "vip_spend_bdt" DECIMAL(12,2) NOT NULL DEFAULT 50000,
    "at_risk_days" INTEGER NOT NULL DEFAULT 30,
    "new_account_days" INTEGER NOT NULL DEFAULT 30,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customer_segment_settings_pkey" PRIMARY KEY ("tenant_id")
);

ALTER TABLE "customer_segment_settings"
    ADD CONSTRAINT "customer_segment_settings_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
