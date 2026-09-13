-- An LC acceptance: the moment the bank takes over the supplier's invoice.
-- Until this ran, `settle` debited "LC Acceptance Payable" — an account nothing
-- had ever credited — while the supplier's own payable stayed open forever.
ALTER TABLE "ImportShipment" ADD COLUMN "accepted_at" TIMESTAMP(3);
ALTER TABLE "ImportShipment" ADD COLUMN "acceptance_due_date" TIMESTAMP(3);

CREATE INDEX "ImportShipment_tenant_id_acceptance_due_date_idx"
    ON "ImportShipment"("tenant_id", "acceptance_due_date");

-- Paying a charge that was accrued writes a second voucher. Before this, an
-- accrued charge never posted at all: it reached the landed cost and the
-- receipt then credited Goods in Transit for a debit nobody had made.
ALTER TABLE "ImportCost" ADD COLUMN "payment_voucher_id" TEXT;

-- Two new posting events. Both post through postMultiLeg and have no
-- PostingRule, like the three import_* values already in this enum.
ALTER TYPE "PostingRuleEventType" ADD VALUE IF NOT EXISTS 'import_acceptance';
ALTER TYPE "PostingRuleEventType" ADD VALUE IF NOT EXISTS 'import_write_off';
