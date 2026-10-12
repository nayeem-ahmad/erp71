-- Supplier codes (SUP-00001), unique per tenant like a customer's code.
-- Production runs `db push`, not this file: there prisma/sync-supplier-code.ts
-- numbers the existing suppliers after the push adds the column.

ALTER TABLE "Supplier" ADD COLUMN IF NOT EXISTS "supplier_code" TEXT;

-- Same statement as prisma/sync-supplier-code.ts — keep the two in step.
WITH taken AS (
    SELECT "tenant_id", MAX(CAST(SUBSTRING("supplier_code" FROM '^SUP-([0-9]+)$') AS NUMERIC)) AS base
    FROM "Supplier"
    WHERE "supplier_code" ~ '^SUP-[0-9]+$'
    GROUP BY "tenant_id"
),
ranked AS (
    SELECT "id", "tenant_id",
           ROW_NUMBER() OVER (PARTITION BY "tenant_id" ORDER BY "created_at", "id") AS rn
    FROM "Supplier"
    WHERE "supplier_code" IS NULL
)
UPDATE "Supplier" AS s
SET "supplier_code" = 'SUP-' || LPAD((COALESCE(t.base, 0) + r.rn)::text, GREATEST(5, LENGTH((COALESCE(t.base, 0) + r.rn)::text)), '0')
FROM ranked AS r
LEFT JOIN taken AS t ON t."tenant_id" = r."tenant_id"
WHERE s."id" = r."id";

CREATE UNIQUE INDEX "Supplier_tenant_id_supplier_code_key" ON "Supplier"("tenant_id", "supplier_code");
