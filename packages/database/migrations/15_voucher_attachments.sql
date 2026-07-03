-- Voucher file attachments (receipts, invoices, supporting documents)

CREATE TABLE IF NOT EXISTS voucher_attachments (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL REFERENCES "Tenant"(id) ON DELETE CASCADE,
    voucher_id TEXT NOT NULL REFERENCES vouchers(id) ON DELETE CASCADE,
    file_url TEXT NOT NULL,
    file_name TEXT NOT NULL,
    mime_type TEXT,
    file_size INTEGER,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_voucher_attachments_voucher_id ON voucher_attachments(voucher_id);
CREATE INDEX IF NOT EXISTS idx_voucher_attachments_tenant_id ON voucher_attachments(tenant_id);