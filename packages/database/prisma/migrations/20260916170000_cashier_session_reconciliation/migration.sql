-- Make a cashier session the thing a shift is actually recorded against.
--
-- Before this, CashierSession was a bookkeeping row the selling path never
-- read: a sale carried counter_id and created_by but nothing said which shift
-- rang it, so a till could not be reconciled and the "expected cash" shown at
-- close was opening + manual cash movements, silently omitting every cash sale.
--
-- Everything here is additive, nullable or defaulted, so it applies to a live
-- workspace with no backfill and no data loss — which matters because
-- production reconciles its schema with `prisma db push`, not this file.

-- ── The link ───────────────────────────────────────────────────────────────
-- Nullable by design and permanently so: a back-office invoice, an imported
-- sale and every sale rung before today belong to no shift.
ALTER TABLE "Sale" ADD COLUMN IF NOT EXISTS "session_id" TEXT;

CREATE INDEX IF NOT EXISTS "Sale_tenant_id_session_id_idx" ON "Sale"("tenant_id", "session_id");

DO $$
BEGIN
  ALTER TABLE "Sale"
    ADD CONSTRAINT "Sale_session_id_fkey"
    FOREIGN KEY ("session_id") REFERENCES "CashierSession"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- ── Reconciliation ─────────────────────────────────────────────────────────
-- Frozen on close rather than re-derived on read: a later backdated sale must
-- not rewrite the count a cashier signed off on. NULL on every session closed
-- before today — those were never reconciled and must not be made to look as
-- though they balanced.
ALTER TABLE "CashierSession" ADD COLUMN IF NOT EXISTS "expected_cash" DECIMAL(12,2);
ALTER TABLE "CashierSession" ADD COLUMN IF NOT EXISTS "variance" DECIMAL(12,2);

-- ── The two open-session locks, enforced by the database ───────────────────
-- Both were check-then-create in the service, which two cashiers tapping Open
-- in the same second both pass. The honest index is partial —
-- UNIQUE (counter_id) WHERE status = 'OPEN' — which the Prisma schema cannot
-- express, and production applies the schema rather than this file. So the
-- condition is carried in the column instead: it mirrors the id while the
-- session is OPEN and is NULL once it closes, and Postgres treats NULLs as
-- distinct, so closed sessions never collide.
--
-- Sessions already open when this ships keep NULL in both columns and stay
-- unguarded until they close and reopen. Backfilling them would be the
-- friendlier move and is deliberately not done: if a tenant already has two
-- open sessions on one till, the backfill is what would fail, in the boot
-- chain, on their production database.
ALTER TABLE "CashierSession" ADD COLUMN IF NOT EXISTS "open_counter_key" TEXT;
ALTER TABLE "CashierSession" ADD COLUMN IF NOT EXISTS "open_user_key" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "CashierSession_tenant_id_open_counter_key_key"
  ON "CashierSession"("tenant_id", "open_counter_key");
CREATE UNIQUE INDEX IF NOT EXISTS "CashierSession_tenant_id_open_user_key_key"
  ON "CashierSession"("tenant_id", "open_user_key");

-- ── The gate ───────────────────────────────────────────────────────────────
-- Off by default: an upgrade must not stop a shop mid-sale for a workflow it
-- has never used.
ALTER TABLE "SalesSettings" ADD COLUMN IF NOT EXISTS "require_cashier_session" BOOLEAN NOT NULL DEFAULT false;

-- ── Refunds belong to the shift that paid them out ─────────────────────────
-- Not to the shift that made the original sale: the money leaves whichever
-- drawer is open when the customer is handed it back, often a different shift
-- on a different day.
ALTER TABLE "SalesReturn" ADD COLUMN IF NOT EXISTS "session_id" TEXT;

CREATE INDEX IF NOT EXISTS "SalesReturn_tenant_id_session_id_idx" ON "SalesReturn"("tenant_id", "session_id");

DO $$
BEGIN
  ALTER TABLE "SalesReturn"
    ADD CONSTRAINT "SalesReturn_session_id_fkey"
    FOREIGN KEY ("session_id") REFERENCES "CashierSession"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
