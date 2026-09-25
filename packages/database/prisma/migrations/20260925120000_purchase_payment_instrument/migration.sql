-- Instrument details on a purchase payment: the bank, the account, the cheque
-- number and the date written on it — the purchase-side twin of
-- 20260917120000_sale_payment_instrument.
--
-- A sale could put those columns on the PaymentRecord rows it already had. A
-- purchase had nowhere to put them: what was handed over at the counter was
-- stored only as the `paid_amount` total (plus, when there was a supplier, one
-- combined PAYMENT line on the supplier's ledger), so a bill paid half by
-- cheque and half by bKash kept no trace of either instrument. This table is
-- one row per tender, carrying the same five nullable instrument columns as
-- PaymentRecord. `paid_amount` stays the figure every balance reads.
--
-- New table only, so nothing existing needs a backfill: bills recorded before
-- this simply have no rows.
--
-- Additive only. Production reconciles its schema with `prisma db push` on
-- container start and never runs this directory, so this file keeps the history
-- honest rather than being the mechanism that ships the change; the guards keep
-- it a no-op on a database `db push` has already reached.

CREATE TABLE IF NOT EXISTS "PurchasePayment" (
    "id"                  TEXT NOT NULL,
    "purchase_id"         TEXT NOT NULL,
    "payment_method"      TEXT NOT NULL,
    "amount"              DECIMAL(12,2) NOT NULL,
    "bank_name"           TEXT,
    "bank_branch"         TEXT,
    "bank_account_number" TEXT,
    "reference_no"        TEXT,
    "instrument_date"     DATE,
    "created_at"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PurchasePayment_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "PurchasePayment_purchase_id_idx" ON "PurchasePayment"("purchase_id");

DO $$ BEGIN
    ALTER TABLE "PurchasePayment"
        ADD CONSTRAINT "PurchasePayment_purchase_id_fkey"
        FOREIGN KEY ("purchase_id") REFERENCES "Purchase"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
