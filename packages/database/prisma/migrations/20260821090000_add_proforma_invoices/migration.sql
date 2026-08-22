-- Proforma invoices.
--
-- A PI is a quotation with commercial terms attached, so it becomes a document
-- kind on Quotation rather than a table of its own. Every column added here is
-- nullable or defaulted, so existing rows become ordinary QUOTE documents with
-- no backfill.

ALTER TABLE "Quotation"
    ADD COLUMN "doc_kind" TEXT NOT NULL DEFAULT 'QUOTE',
    ADD COLUMN "currency" TEXT NOT NULL DEFAULT 'BDT',
    ADD COLUMN "exchange_rate" DECIMAL(12, 6),
    ADD COLUMN "incoterm" TEXT,
    ADD COLUMN "port_of_loading" TEXT,
    ADD COLUMN "port_of_discharge" TEXT,
    ADD COLUMN "payment_terms" TEXT,
    ADD COLUMN "advance_percent" DECIMAL(5, 2),
    ADD COLUMN "delivery_lead_time_days" INTEGER,
    ADD COLUMN "country_of_origin" TEXT;

-- The quotes list filters by kind on every load.
CREATE INDEX "Quotation_tenant_id_doc_kind_idx" ON "Quotation"("tenant_id", "doc_kind");

-- Beneficiary bank details for the PI footer, held once per tenant.
ALTER TABLE "SalesSettings"
    ADD COLUMN "bank_name" TEXT,
    ADD COLUMN "bank_branch" TEXT,
    ADD COLUMN "bank_account_name" TEXT,
    ADD COLUMN "bank_account_number" TEXT,
    ADD COLUMN "bank_routing_number" TEXT,
    ADD COLUMN "bank_swift_code" TEXT;

-- Lets link analytics separate "opened the PI" from "opened the quote"; both
-- still resolve to the same /q/<token> page.
ALTER TYPE "ShortLinkEntity" ADD VALUE 'PROFORMA_INVOICE';

-- Human-readable document numbers. See the model comment for why this is not
-- VoucherSequence and not a row count.
CREATE TABLE "document_sequences" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "doc_type" TEXT NOT NULL,
    "period_key" TEXT NOT NULL DEFAULT '',
    "prefix" TEXT NOT NULL,
    "next_number" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "document_sequences_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "document_sequences_tenant_id_doc_type_period_key_key"
    ON "document_sequences"("tenant_id", "doc_type", "period_key");
CREATE INDEX "document_sequences_tenant_id_idx" ON "document_sequences"("tenant_id");

ALTER TABLE "document_sequences"
    ADD CONSTRAINT "document_sequences_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
