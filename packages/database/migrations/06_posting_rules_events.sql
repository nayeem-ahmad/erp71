DROP TABLE IF EXISTS posting_events;
DROP TABLE IF EXISTS posting_rules;

DROP TYPE IF EXISTS "PostingEventStatus";
DROP TYPE IF EXISTS "PostingRuleConditionKey";
DROP TYPE IF EXISTS "PostingRuleEventType";

CREATE TYPE "PostingRuleEventType" AS ENUM (
    'sale',
    'sale_return',
    'purchase',
    'purchase_return',
    'inventory_adjustment',
    'fund_movement',
    'expense',
    'loan_disbursement',
    'loan_repayment',
    'customer_payment'
);

CREATE TYPE "PostingRuleConditionKey" AS ENUM (
    'payment_mode',
    'reason_type',
    'transfer_scope',
    'loan_direction',
    'payment_direction',
    'none'
);

CREATE TYPE "PostingEventStatus" AS ENUM (
    'pending',
    'posted',
    'failed',
    'skipped'
);

CREATE TABLE IF NOT EXISTS posting_rules (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL REFERENCES "Tenant"(id) ON DELETE CASCADE,
    event_type "PostingRuleEventType" NOT NULL,
    condition_key "PostingRuleConditionKey" NOT NULL DEFAULT 'none',
    condition_value TEXT,
    debit_account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
    credit_account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
    priority INTEGER NOT NULL DEFAULT 100,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_posting_rules_tenant_event_active ON posting_rules(tenant_id, event_type, is_active);
CREATE INDEX IF NOT EXISTS idx_posting_rules_tenant_condition ON posting_rules(tenant_id, condition_key, condition_value);
CREATE INDEX IF NOT EXISTS idx_posting_rules_tenant_debit ON posting_rules(tenant_id, debit_account_id);
CREATE INDEX IF NOT EXISTS idx_posting_rules_tenant_credit ON posting_rules(tenant_id, credit_account_id);

CREATE UNIQUE INDEX IF NOT EXISTS posting_rules_active_unique_idx
    ON posting_rules(tenant_id, event_type, condition_key, COALESCE(condition_value, ''))
    WHERE is_active = TRUE;

ALTER TABLE vouchers
    ADD COLUMN IF NOT EXISTS source_module TEXT,
    ADD COLUMN IF NOT EXISTS source_type TEXT,
    ADD COLUMN IF NOT EXISTS source_id TEXT,
    ADD COLUMN IF NOT EXISTS idempotency_key TEXT;

CREATE INDEX IF NOT EXISTS idx_vouchers_tenant_source ON vouchers(tenant_id, source_module, source_type, source_id);

CREATE TABLE IF NOT EXISTS posting_events (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL REFERENCES "Tenant"(id) ON DELETE CASCADE,
    event_type "PostingRuleEventType" NOT NULL,
    source_module TEXT NOT NULL,
    source_type TEXT NOT NULL,
    source_id TEXT NOT NULL,
    idempotency_key TEXT NOT NULL,
    status "PostingEventStatus" NOT NULL DEFAULT 'pending',
    voucher_id TEXT REFERENCES vouchers(id) ON DELETE SET NULL,
    attempt_count INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,
    last_attempt_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (tenant_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_posting_events_tenant_status_updated ON posting_events(tenant_id, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_posting_events_tenant_source ON posting_events(tenant_id, source_module, source_type, source_id);
