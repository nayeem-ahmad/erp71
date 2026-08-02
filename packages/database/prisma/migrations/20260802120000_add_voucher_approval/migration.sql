-- Voucher approval (maker-checker).
--
-- New store permission gating who may sign a voucher off.

ALTER TYPE "StorePermission" ADD VALUE IF NOT EXISTS 'APPROVE_VOUCHER';

--
-- Existing rows default to APPROVED so enabling the feature never
-- retroactively pulls historical vouchers out of the ledger.

ALTER TABLE "vouchers"
  ADD COLUMN IF NOT EXISTS "approval_status" TEXT NOT NULL DEFAULT 'APPROVED',
  ADD COLUMN IF NOT EXISTS "approved_by" TEXT,
  ADD COLUMN IF NOT EXISTS "approved_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "rejection_reason" TEXT;

CREATE INDEX IF NOT EXISTS "vouchers_tenant_id_approval_status_idx"
  ON "vouchers"("tenant_id", "approval_status");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'vouchers_approved_by_fkey'
  ) THEN
    ALTER TABLE "vouchers"
      ADD CONSTRAINT "vouchers_approved_by_fkey"
      FOREIGN KEY ("approved_by") REFERENCES "User"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "accounting_settings" (
  "id" TEXT NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "require_voucher_approval" BOOLEAN NOT NULL DEFAULT false,
  "auto_approve_system_vouchers" BOOLEAN NOT NULL DEFAULT true,
  "reports_approved_only" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "accounting_settings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "accounting_settings_tenant_id_key"
  ON "accounting_settings"("tenant_id");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'accounting_settings_tenant_id_fkey'
  ) THEN
    ALTER TABLE "accounting_settings"
      ADD CONSTRAINT "accounting_settings_tenant_id_fkey"
      FOREIGN KEY ("tenant_id") REFERENCES "Tenant"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
