-- Tools → Cheques (register and printing) and Tools → Documents (licence vault).
-- Production applies schema via `prisma db push`; this file is the history.

CREATE TABLE "cheques" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "store_id" TEXT,
    "direction" TEXT NOT NULL DEFAULT 'ISSUED',
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "bank_name" TEXT NOT NULL,
    "branch_name" TEXT,
    "account_number" TEXT,
    "cheque_number" TEXT NOT NULL,
    "party_name" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "cheque_date" DATE NOT NULL,
    "account_payee" BOOLEAN NOT NULL DEFAULT true,
    "memo" TEXT,
    "status_changed_at" TIMESTAMP(3),
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cheques_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "cheques_tenant_id_status_cheque_date_idx" ON "cheques"("tenant_id", "status", "cheque_date");
CREATE INDEX "cheques_tenant_id_direction_cheque_date_idx" ON "cheques"("tenant_id", "direction", "cheque_date");

ALTER TABLE "cheques" ADD CONSTRAINT "cheques_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "business_documents" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "doc_type" TEXT NOT NULL DEFAULT 'OTHER',
    "title" TEXT NOT NULL,
    "number" TEXT,
    "issuing_authority" TEXT,
    "issue_date" DATE,
    "expiry_date" DATE,
    "remind_days_before" INTEGER NOT NULL DEFAULT 30,
    "notes" TEXT,
    "file_url" TEXT,
    "file_name" TEXT,
    "mime_type" TEXT,
    "file_size" INTEGER,
    "storage_key" TEXT,
    "storage_type" TEXT,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "business_documents_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "business_documents_tenant_id_expiry_date_idx" ON "business_documents"("tenant_id", "expiry_date");

ALTER TABLE "business_documents" ADD CONSTRAINT "business_documents_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
