-- Instrument details on a sale payment: the bank, the account, the cheque
-- number and the date written on it.
--
-- Until now a PaymentRecord held only "Bank — 15,000", which is enough to post
-- the ledger and useless for everything after it: a shop that took a cheque had
-- no place to record which bank it was drawn on or what number was on it, so
-- chasing a bounced one, or matching a deposit against a bank statement, meant
-- going back to the paper. Post-dated cheques make it worse — the date that
-- matters is the one on the cheque, not the sale's.
--
-- One nullable set covers every non-cash tender; the entry form only changes
-- the labels. Cash fills none of them, and every existing row keeps NULLs,
-- so nothing needs a backfill and no reader changes behaviour.
--
-- Production reconciles with `prisma db push` rather than running migrations
-- (see apps/backend/Dockerfile), so this file is the record; `IF NOT EXISTS`
-- keeps it a no-op on a database `db push` has already reached.
ALTER TABLE "PaymentRecord" ADD COLUMN IF NOT EXISTS "bank_name" TEXT;
ALTER TABLE "PaymentRecord" ADD COLUMN IF NOT EXISTS "bank_branch" TEXT;
ALTER TABLE "PaymentRecord" ADD COLUMN IF NOT EXISTS "bank_account_number" TEXT;
ALTER TABLE "PaymentRecord" ADD COLUMN IF NOT EXISTS "reference_no" TEXT;
ALTER TABLE "PaymentRecord" ADD COLUMN IF NOT EXISTS "instrument_date" DATE;
