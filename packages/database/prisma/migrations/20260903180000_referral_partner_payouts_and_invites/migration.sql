-- Referral partner experience: self-service payouts, and an invite that is a real
-- invite rather than a password reset wearing one's clothes.
--
-- Three independent changes, kept in one migration because they land together:
--
-- 1. `PasswordResetToken.purpose`. The referee invite reused the reset table and
--    therefore inherited its one-hour expiry. A reset is issued to someone sitting
--    at the login screen; an invite is cold outreach read that evening. Recording
--    why the token exists is what lets the two differ in TTL, in delivery channel
--    (an invite also goes by SMS) and in what an expired link offers to do next.
--    Existing rows are all resets, which is exactly what the default says.
--
-- 2. Payout destination on `Referee`. `RefereePayment.method` is free text an
--    admin types after the fact: it records what happened but cannot tell anyone
--    where to send the next one. These columns are owned by the partner.
--
-- 3. `RefereePayoutRequest`. A partner asking for the balance the ledger already
--    says they are owed. Deliberately not a ledger entry — no commission changes
--    status here. It becomes money only when an admin records a real
--    `RefereePayment` against it, which is the path payouts have always taken.

-- ── 1. Invite tokens are distinguishable from password resets ────────────────
CREATE TYPE "PasswordResetPurpose" AS ENUM ('PASSWORD_RESET', 'REFEREE_INVITE');

ALTER TABLE "PasswordResetToken"
    ADD COLUMN "purpose" "PasswordResetPurpose" NOT NULL DEFAULT 'PASSWORD_RESET';

-- ── 2. Where a partner is actually paid ──────────────────────────────────────
CREATE TYPE "RefereePayoutMethod" AS ENUM ('BKASH', 'NAGAD', 'ROCKET', 'BANK');

ALTER TABLE "Referee"
    ADD COLUMN "payout_method" "RefereePayoutMethod",
    ADD COLUMN "payout_account_name" TEXT,
    ADD COLUMN "payout_account_number" TEXT,
    ADD COLUMN "payout_bank_name" TEXT,
    ADD COLUMN "payout_branch" TEXT,
    ADD COLUMN "payout_updated_at" TIMESTAMP(3);

-- ── 3. Payout requests ───────────────────────────────────────────────────────
CREATE TYPE "RefereePayoutRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'PAID', 'CANCELLED');

CREATE TABLE "RefereePayoutRequest" (
    "id" TEXT NOT NULL,
    "referee_id" TEXT NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "status" "RefereePayoutRequestStatus" NOT NULL DEFAULT 'PENDING',
    "method" "RefereePayoutMethod" NOT NULL,
    "account_name" TEXT,
    "account_number" TEXT NOT NULL,
    "bank_name" TEXT,
    "branch" TEXT,
    "note" TEXT,
    "decision_note" TEXT,
    "requested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewed_at" TIMESTAMP(3),
    "reviewed_by" TEXT,
    "payment_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RefereePayoutRequest_pkey" PRIMARY KEY ("id")
);

-- One request per payment: a payout settles the request it was raised against,
-- never two of them.
CREATE UNIQUE INDEX "RefereePayoutRequest_payment_id_key" ON "RefereePayoutRequest"("payment_id");
CREATE INDEX "RefereePayoutRequest_referee_id_status_idx" ON "RefereePayoutRequest"("referee_id", "status");
CREATE INDEX "RefereePayoutRequest_status_idx" ON "RefereePayoutRequest"("status");

ALTER TABLE "RefereePayoutRequest"
    ADD CONSTRAINT "RefereePayoutRequest_referee_id_fkey"
    FOREIGN KEY ("referee_id") REFERENCES "Referee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "RefereePayoutRequest"
    ADD CONSTRAINT "RefereePayoutRequest_payment_id_fkey"
    FOREIGN KEY ("payment_id") REFERENCES "RefereePayment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
