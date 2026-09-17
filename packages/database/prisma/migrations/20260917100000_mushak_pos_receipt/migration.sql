-- Lets a VAT-registered workspace make the মূসক-৬.৩ tax invoice the POS
-- counter's default print, in place of the shop's ordinary receipt slip.
--
-- Additive and defaulted to false, so no live counter changes what it hands a
-- customer when this ships. It is a sub-option of `mushak_enabled`: a workspace
-- without a BIN must not print something that looks like a tax invoice, which
-- the settings form hides and `updateTaxSettings` enforces by clearing this
-- column whenever Mushak itself is switched off.
ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "mushak_pos_receipt" BOOLEAN NOT NULL DEFAULT false;
