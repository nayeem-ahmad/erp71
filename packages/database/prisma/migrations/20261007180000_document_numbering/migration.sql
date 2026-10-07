-- Tenant-configurable document numbering, starting with sales invoices.

-- Branch codes, printed inside a number when a tenant's format uses {STORE}.
-- Every existing branch gets S1, S2, … in the order it was created, so a
-- per-branch format works the moment it is saved; the owner can rename them.
ALTER TABLE "Store" ADD COLUMN "code" TEXT;

-- Same statement as prisma/sync-store-code.ts, which is what fills these in
-- production (it runs `db push`, not migrations).
WITH taken AS (
    SELECT "tenant_id", MAX(CAST(SUBSTRING("code" FROM 2) AS INTEGER)) AS base
    FROM "Store"
    WHERE "code" ~ '^S[0-9]{1,5}$'
    GROUP BY "tenant_id"
),
ranked AS (
    SELECT "id", "tenant_id",
           ROW_NUMBER() OVER (PARTITION BY "tenant_id" ORDER BY "created_at", "id") AS rn
    FROM "Store"
    WHERE "code" IS NULL
)
UPDATE "Store" AS s
SET "code" = 'S' || (COALESCE(t.base, 0) + r.rn)
FROM ranked AS r
LEFT JOIN taken AS t ON t."tenant_id" = r."tenant_id"
WHERE s."id" = r."id";

CREATE UNIQUE INDEX "Store_tenant_id_code_key" ON "Store"("tenant_id", "code");

-- A counter per branch or per POS counter, alongside the existing per-period
-- ones. Existing rows are business-wide series, which is what '' means.
ALTER TABLE "document_sequences" ADD COLUMN "scope_key" TEXT NOT NULL DEFAULT '';

DROP INDEX "document_sequences_tenant_id_doc_type_period_key_key";
CREATE UNIQUE INDEX "document_sequences_tenant_id_doc_type_period_key_scope_key_key"
    ON "document_sequences"("tenant_id", "doc_type", "period_key", "scope_key");

-- The tenant's chosen format per document type. No row = the built-in default.
CREATE TABLE "document_numbering" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "doc_type" TEXT NOT NULL,
    "template" TEXT NOT NULL,
    "reset_policy" TEXT NOT NULL DEFAULT 'FISCAL_YEAR',
    "scope" TEXT NOT NULL DEFAULT 'TENANT',
    "seq_width" INTEGER NOT NULL DEFAULT 5,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "document_numbering_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "document_numbering_tenant_id_doc_type_key" ON "document_numbering"("tenant_id", "doc_type");

ALTER TABLE "document_numbering"
    ADD CONSTRAINT "document_numbering_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
