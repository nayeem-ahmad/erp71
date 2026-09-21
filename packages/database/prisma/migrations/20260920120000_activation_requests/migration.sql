-- Manual activation: the state and the paper trail for a workspace that is paid
-- for by hand, before the SSL Wireless gateway is live.

-- Signup provisions a workspace at PAST_DUE with a zero-length period and
-- nothing charged, and a paying tenant that misses a fee lands at PAST_DUE too.
-- The two need opposite treatment — one has never been a customer, the other is
-- in dunning — and the status cannot tell them apart. This records the crossing:
-- null means the workspace is still awaiting its first activation.
--
-- Backfilled from the ledger rather than defaulted: every subscription that is
-- already ACTIVE, or that carries a provider reference or a collected setup fee,
-- has been through an activation, and must not start showing its owner a
-- "your workspace is being activated" screen on deploy. `created_at` is the
-- closest honest stamp available for a crossing nothing recorded at the time.
ALTER TABLE "TenantSubscription" ADD COLUMN IF NOT EXISTS "activated_at" TIMESTAMP(3);

UPDATE "TenantSubscription"
SET "activated_at" = COALESCE("setup_fee_paid_at", "current_period_start")
WHERE "activated_at" IS NULL
  AND (
    "status" IN ('ACTIVE', 'TRIALING', 'CANCELLED')
    OR "provider_subscription_ref" IS NOT NULL
    OR "setup_fee_paid_at" IS NOT NULL
  );

-- A PAST_DUE workspace that has ever been charged a subscription fee was
-- activated at some point, whatever its provider columns say.
UPDATE "TenantSubscription" s
SET "activated_at" = "current_period_start"
WHERE s."activated_at" IS NULL
  AND EXISTS (
    SELECT 1 FROM "BillingEvent" e
    WHERE e."tenant_id" = s."tenant_id"
      AND e."event_type" IN ('subscription_fee', 'manual_payment', 'CALLBACK_SUCCESS', 'IPN')
  );

-- The tenant's claim that they sent money, pending an admin checking it against
-- the bKash/Nagad merchant app. Deliberately not a BillingEvent: an unverified
-- claim must never be mistaken for a collection, and approving one is what posts
-- to the ledger.
CREATE TABLE IF NOT EXISTS "ActivationRequest" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "submitted_by" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "transaction_id" TEXT NOT NULL,
    "sender_number" TEXT,
    "amount" DECIMAL(12,2) NOT NULL,
    "note" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "plan_code" TEXT NOT NULL,
    "billing_cycle" TEXT NOT NULL DEFAULT 'MONTHLY',
    "reviewed_by" TEXT,
    "reviewed_at" TIMESTAMP(3),
    "review_note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ActivationRequest_pkey" PRIMARY KEY ("id")
);

-- One receipt, one claim: the same TrxID cannot be submitted twice, nor
-- borrowed by a second workspace.
CREATE UNIQUE INDEX IF NOT EXISTS "ActivationRequest_method_transaction_id_key"
    ON "ActivationRequest"("method", "transaction_id");
CREATE INDEX IF NOT EXISTS "ActivationRequest_status_created_at_idx"
    ON "ActivationRequest"("status", "created_at");
CREATE INDEX IF NOT EXISTS "ActivationRequest_tenant_id_created_at_idx"
    ON "ActivationRequest"("tenant_id", "created_at");

ALTER TABLE "ActivationRequest"
    ADD CONSTRAINT "ActivationRequest_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
