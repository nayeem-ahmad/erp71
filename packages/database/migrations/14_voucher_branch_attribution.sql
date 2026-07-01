-- Voucher branch attribution for multi-branch accounting reports

ALTER TABLE vouchers
    ADD COLUMN IF NOT EXISTS store_id TEXT REFERENCES "Store"(id),
    ADD COLUMN IF NOT EXISTS attribution TEXT NOT NULL DEFAULT 'BRANCH',
    ADD COLUMN IF NOT EXISTS counterparty_store_id TEXT REFERENCES "Store"(id);

CREATE INDEX IF NOT EXISTS idx_vouchers_tenant_store ON vouchers(tenant_id, store_id);
CREATE INDEX IF NOT EXISTS idx_vouchers_tenant_attribution ON vouchers(tenant_id, attribution);