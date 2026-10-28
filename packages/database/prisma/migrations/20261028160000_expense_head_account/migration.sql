-- A head may charge its own expense account. Null means it uses the
-- category's account (and the posting rule when the category has none).
-- Production applies this with `db push`. The column is nullable and has
-- no backfill: every existing head keeps posting through its category.

ALTER TABLE "ExpenseHead" ADD COLUMN "account_id" TEXT;

CREATE INDEX "ExpenseHead_account_id_idx" ON "ExpenseHead"("account_id");

ALTER TABLE "ExpenseHead"
    ADD CONSTRAINT "ExpenseHead_account_id_fkey"
    FOREIGN KEY ("account_id") REFERENCES "accounts"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
