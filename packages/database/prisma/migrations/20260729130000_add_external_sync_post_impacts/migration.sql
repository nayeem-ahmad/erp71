-- Opt-in switch for making imported documents behave like natively entered
-- ones (stock, due balances, ledger postings).
--
-- Defaults to false so every existing connection keeps importing inert
-- documents. Enabling it on a tenant that already has opening balances for the
-- imported period double-counts, which is why this is a deliberate per-tenant
-- decision rather than a global behaviour change.

ALTER TABLE "ExternalSyncConnection" ADD COLUMN "post_impacts" BOOLEAN NOT NULL DEFAULT false;
