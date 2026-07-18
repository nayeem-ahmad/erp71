-- Add the fund_transfer event type so inter-branch cash transfers post through
-- the rules engine (autoPostFromRules) instead of a hand-rolled tx.voucher.create.
--
-- The hand-rolled version posted correct, balanced vouchers but created no
-- PostingEvent, so it was invisible to POSTING_CONTRACT / the money-model guard
-- and to reconciliation. Distinct from fund_movement, which is warehouse stock
-- transfers and deliberately posts nothing under periodic inventory.
ALTER TYPE "PostingRuleEventType" ADD VALUE IF NOT EXISTS 'fund_transfer';
