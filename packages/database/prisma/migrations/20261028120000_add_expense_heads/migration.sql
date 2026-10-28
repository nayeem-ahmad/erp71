-- Expense heads sit under a category. An entry records a head; category_id
-- stays, copied from that head. Existing entries get one head per category,
-- named the same as the category.
--
-- head_id stays nullable. Production applies this shape with `db push`, which
-- cannot fill a new required column, and the previous app is still inserting
-- expenses while prepare runs. sync-expense-heads.ts fills the nulls.
-- The API refuses a new entry that has no head.

CREATE TABLE "ExpenseHead" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "category_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExpenseHead_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ExpenseHead_category_id_name_key" ON "ExpenseHead"("category_id", "name");

CREATE INDEX "ExpenseHead_tenant_id_idx" ON "ExpenseHead"("tenant_id");

INSERT INTO "ExpenseHead" ("id", "tenant_id", "category_id", "name", "created_at", "updated_at")
SELECT gen_random_uuid()::text, c."tenant_id", c."id", c."name", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "ExpenseCategory" c
WHERE EXISTS (
    SELECT 1 FROM "ExpenseEntry" e WHERE e."category_id" = c."id"
);

ALTER TABLE "ExpenseEntry" ADD COLUMN "head_id" TEXT;

UPDATE "ExpenseEntry" e
SET "head_id" = h."id"
FROM "ExpenseHead" h
INNER JOIN "ExpenseCategory" c ON c."id" = h."category_id" AND c."name" = h."name"
WHERE e."category_id" = c."id"
  AND e."head_id" IS NULL;

CREATE INDEX "ExpenseEntry_tenant_id_head_id_idx" ON "ExpenseEntry"("tenant_id", "head_id");

ALTER TABLE "ExpenseHead" ADD CONSTRAINT "ExpenseHead_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ExpenseHead" ADD CONSTRAINT "ExpenseHead_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "ExpenseCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ExpenseEntry" ADD CONSTRAINT "ExpenseEntry_head_id_fkey" FOREIGN KEY ("head_id") REFERENCES "ExpenseHead"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
