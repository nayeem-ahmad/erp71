-- Recurring subscription billing + non-payment suspension.
--
-- Before this, nothing advanced `current_period_end`, so the fee-posting cron
-- reused the same idempotency key every day and posted exactly one fee per
-- subscription, ever. These columns carry the state the renewal, reminder and
-- suspension passes need between runs.

-- How long each period runs, and which of the plan's prices renewal charges.
ALTER TABLE "TenantSubscription"
    ADD COLUMN "billing_cycle" TEXT NOT NULL DEFAULT 'MONTHLY';

-- The clock the 30-day suspension is measured against; survives the renewals
-- that keep moving current_period_end forward.
ALTER TABLE "TenantSubscription"
    ADD COLUMN "past_due_since" TIMESTAMP(3);

-- Cadence marker for the recurring overdue reminder.
ALTER TABLE "TenantSubscription"
    ADD COLUMN "last_reminder_at" TIMESTAMP(3);

-- Workspace freeze for non-payment: reads stay open, writes are rejected.
ALTER TABLE "Tenant"
    ADD COLUMN "billing_suspended_at" TIMESTAMP(3);
ALTER TABLE "Tenant"
    ADD COLUMN "billing_suspension_reason" TEXT;

-- Backfill: existing PAST_DUE subscriptions have been overdue since their
-- (frozen) period end. Without this their suspension clock would start at zero
-- on deploy, granting a fresh 30 days to tenants already months behind.
UPDATE "TenantSubscription"
SET "past_due_since" = "current_period_end"
WHERE "status" = 'PAST_DUE';

-- The suspension sweep scans by status and clock; the reminder pass by status.
CREATE INDEX "TenantSubscription_status_past_due_since_idx"
    ON "TenantSubscription" ("status", "past_due_since");

-- The write guard reads this per request, so keep the lookup of frozen tenants cheap.
CREATE INDEX "Tenant_billing_suspended_at_idx"
    ON "Tenant" ("billing_suspended_at");
