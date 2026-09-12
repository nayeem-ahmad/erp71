-- Platform accounting: ERP71's own books.
--
-- The ledger itself is the accounting module already in the product, kept
-- against the internal platform workspace tenant, so no accounting table
-- changes here. What this migration adds is the two things that had nowhere to
-- live: the platform's own spend, and the two posting-event kinds the
-- projection writes.
--
-- Both enum values are additive. No PostingRule will ever carry them —
-- platform postings go through `postMultiLeg` with fixed accounts, the same
-- route the three `import_*` events take — so nothing that reads posting rules
-- changes behaviour.
--
-- Production reconciles with `prisma db push` rather than running migrations
-- (see apps/backend/Dockerfile), so this file is the record; the guards keep it
-- a no-op on a database `db push` has already reached.
ALTER TYPE "PostingRuleEventType" ADD VALUE IF NOT EXISTS 'platform_billing';
ALTER TYPE "PostingRuleEventType" ADD VALUE IF NOT EXISTS 'platform_expense';

CREATE TABLE IF NOT EXISTS "platform_expense_categories" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "account_name" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "platform_expense_categories_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "platform_expense_categories_code_key"
    ON "platform_expense_categories"("code");
CREATE INDEX IF NOT EXISTS "platform_expense_categories_is_active_sort_order_idx"
    ON "platform_expense_categories"("is_active", "sort_order");

CREATE TABLE IF NOT EXISTS "platform_expenses" (
    "id" TEXT NOT NULL,
    "category_id" TEXT NOT NULL,
    "expense_date" DATE NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "paid_from" TEXT NOT NULL DEFAULT 'BANK',
    "vendor" TEXT,
    "description" TEXT,
    "reference" TEXT,
    "voucher_id" TEXT,
    "posting_status" TEXT NOT NULL DEFAULT 'pending',
    "recorded_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "platform_expenses_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "platform_expenses_expense_date_idx"
    ON "platform_expenses"("expense_date");
CREATE INDEX IF NOT EXISTS "platform_expenses_category_id_expense_date_idx"
    ON "platform_expenses"("category_id", "expense_date");

DO $$
BEGIN
    ALTER TABLE "platform_expenses"
        ADD CONSTRAINT "platform_expenses_category_id_fkey"
        FOREIGN KEY ("category_id") REFERENCES "platform_expense_categories"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;
