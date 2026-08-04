-- Referral commission reversal (clawback on refund / chargeback).
--
-- Before: `processRefund` recorded the refund and downgraded the tenant to FREE
-- but never touched `referral_signups`, so a pay -> EARNED -> refund sequence
-- left a payable commission standing against money the platform had given back.
--
-- Additive only. Production reconciles its schema with `prisma db push` on
-- container start and never runs this directory (see docs/crm/lead-taxonomy-rollout.md
-- for the same constraint), so this file exists to keep the migration history
-- honest rather than because it is the mechanism that ships the change. Both
-- statements below are what `db push` emits for this schema diff: one enum value
-- and three nullable/defaulted columns, no DROP and no ALTER COLUMN.

ALTER TYPE "ReferralCommissionStatus" ADD VALUE IF NOT EXISTS 'REVERSED';

ALTER TABLE "ReferralSignup" ADD COLUMN IF NOT EXISTS "reversed_at" TIMESTAMP(3);
ALTER TABLE "ReferralSignup" ADD COLUMN IF NOT EXISTS "reversal_reason" TEXT;
ALTER TABLE "ReferralSignup" ADD COLUMN IF NOT EXISTS "reversed_after_paid" BOOLEAN NOT NULL DEFAULT false;
