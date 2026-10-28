-- An expense category can charge a specific expense account. Null keeps the
-- posting rule (General Operating Expense). Production applies this with
-- `db push`; this file documents the shape. The column is nullable and has
-- no backfill: existing categories keep posting exactly as they do today
-- until someone picks an account.

ALTER TABLE "ExpenseCategory" ADD COLUMN "account_id" TEXT;

CREATE INDEX "ExpenseCategory_account_id_idx" ON "ExpenseCategory"("account_id");

ALTER TABLE "ExpenseCategory"
    ADD CONSTRAINT "ExpenseCategory_account_id_fkey"
    FOREIGN KEY ("account_id") REFERENCES "accounts"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
