-- Messaging credits: WhatsApp and email join SMS as prepaid, metered balances,
-- and top-ups move from "click Buy and the credits appear" to a bKash payment
-- a platform admin verifies before anything is granted.

ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "whatsapp_credits" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "email_credits" INTEGER NOT NULL DEFAULT 0;

-- Packages and the ledger carry the channel they belong to. Every existing row
-- is an SMS one, which is what the default says.
ALTER TABLE "SmsPackage" ADD COLUMN IF NOT EXISTS "channel" TEXT NOT NULL DEFAULT 'SMS';
CREATE INDEX IF NOT EXISTS "SmsPackage_channel_is_active_sort_order_idx"
    ON "SmsPackage"("channel", "is_active", "sort_order");

ALTER TABLE "SmsTransaction" ADD COLUMN IF NOT EXISTS "channel" TEXT NOT NULL DEFAULT 'SMS';
CREATE INDEX IF NOT EXISTS "SmsTransaction_tenant_id_channel_created_at_idx"
    ON "SmsTransaction"("tenant_id", "channel", "created_at");

-- The tenant's claim that they paid for a package. Deliberately not a
-- BillingEvent and not a ledger entry: an unverified claim must never be
-- mistaken for a collection, and approving one is what grants the credits.
CREATE TABLE IF NOT EXISTS "CreditTopupRequest" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "submitted_by" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "package_id" TEXT,
    "package_name" TEXT NOT NULL,
    "credits" INTEGER NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'BDT',
    "method" TEXT NOT NULL DEFAULT 'BKASH',
    "transaction_id" TEXT NOT NULL,
    "sender_number" TEXT,
    "note" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "support_thread_id" TEXT,
    "reviewed_by" TEXT,
    "reviewed_at" TIMESTAMP(3),
    "review_note" TEXT,
    "credits_granted" INTEGER,
    "amount_received" DECIMAL(12,2),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CreditTopupRequest_pkey" PRIMARY KEY ("id")
);

-- One receipt, one package: the same TrxID cannot be submitted twice, nor
-- borrowed by a second workspace.
CREATE UNIQUE INDEX IF NOT EXISTS "CreditTopupRequest_method_transaction_id_key"
    ON "CreditTopupRequest"("method", "transaction_id");
CREATE UNIQUE INDEX IF NOT EXISTS "CreditTopupRequest_support_thread_id_key"
    ON "CreditTopupRequest"("support_thread_id");
CREATE INDEX IF NOT EXISTS "CreditTopupRequest_status_created_at_idx"
    ON "CreditTopupRequest"("status", "created_at");
CREATE INDEX IF NOT EXISTS "CreditTopupRequest_tenant_id_created_at_idx"
    ON "CreditTopupRequest"("tenant_id", "created_at");

DO $$ BEGIN
    ALTER TABLE "CreditTopupRequest"
        ADD CONSTRAINT "CreditTopupRequest_tenant_id_fkey"
        FOREIGN KEY ("tenant_id") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "CreditTopupRequest"
        ADD CONSTRAINT "CreditTopupRequest_support_thread_id_fkey"
        FOREIGN KEY ("support_thread_id") REFERENCES "support_threads"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
