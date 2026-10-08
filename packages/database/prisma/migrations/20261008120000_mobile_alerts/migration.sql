-- Smart alerts for the mobile app: delivery bookkeeping on notifications, the
-- shop-wide alert lines, per-person push preferences, and the scanner's
-- cursor. Every column is nullable or defaulted, so nothing to backfill.
ALTER TABLE "Notification" ADD COLUMN "dedupe_key" TEXT;
ALTER TABLE "Notification" ADD COLUMN "pushed_at" TIMESTAMP(3);
ALTER TABLE "Notification" ADD COLUMN "push_held" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX "Notification_user_id_type_dedupe_key_created_at_idx" ON "Notification"("user_id", "type", "dedupe_key", "created_at");
CREATE INDEX "Notification_push_held_idx" ON "Notification"("push_held");

CREATE TABLE "AlertSettings" (
    "tenant_id" TEXT NOT NULL,
    "large_sale_amount" DECIMAL(12,2) NOT NULL DEFAULT 50000,
    "large_refund_amount" DECIMAL(12,2) NOT NULL DEFAULT 10000,
    "till_shortfall_amount" DECIMAL(12,2) NOT NULL DEFAULT 500,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AlertSettings_pkey" PRIMARY KEY ("tenant_id")
);

CREATE TABLE "UserAlertPreference" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "muted_types" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "quiet_enabled" BOOLEAN NOT NULL DEFAULT true,
    "quiet_from" INTEGER NOT NULL DEFAULT 1320,
    "quiet_to" INTEGER NOT NULL DEFAULT 480,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserAlertPreference_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "UserAlertPreference_user_id_tenant_id_key" ON "UserAlertPreference"("user_id", "tenant_id");

CREATE TABLE "AlertScanCursor" (
    "name" TEXT NOT NULL,
    "scanned_to" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AlertScanCursor_pkey" PRIMARY KEY ("name")
);

ALTER TABLE "AlertSettings" ADD CONSTRAINT "AlertSettings_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UserAlertPreference" ADD CONSTRAINT "UserAlertPreference_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UserAlertPreference" ADD CONSTRAINT "UserAlertPreference_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
