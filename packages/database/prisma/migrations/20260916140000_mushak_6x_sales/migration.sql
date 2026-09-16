-- NBR Mushak 6.x support for the sales module: the 6.3 tax invoice, the 6.2
-- sales book, the 6.7 credit note and the 6.10 large-supply statement.
--
-- Everything here is additive and defaulted, so it applies to a live workspace
-- without a backfill. What it does NOT do is restate history: sale lines
-- written before this migration carry vat_rate = NULL, and a tax invoice for
-- one of those falls back to the catalogue rate and prints a caveat rather
-- than pretending the figure was snapshotted at the time.

-- ── Issuer block: who the document is issued by, and from where ─────────────
-- A Mushak document names the registered premises and the person answerable
-- for it, neither of which is derivable from the branch that made the sale.
ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "mushak_enabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "mushak_issue_address" TEXT;
ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "mushak_officer_name" TEXT;
ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "mushak_officer_designation" TEXT;
ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "mushak_economic_activity" TEXT;

-- ── Buyer identity ─────────────────────────────────────────────────────────
-- ক্রেতার বিআইএন. Null is a meaningful answer: it is what makes a supply over
-- two lakh taka reportable on the 6.10.
ALTER TABLE "Customer" ADD COLUMN IF NOT EXISTS "bin" TEXT;

-- ── Supplementary duty is a property of the commodity ──────────────────────
-- Third Schedule goods only, so this is per-product with no workspace default
-- to inherit — unlike VAT, which has one.
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "sd_rate" DECIMAL(5,2);

-- ── The tax a posted invoice actually carried ──────────────────────────────
-- Rollups on the sale, snapshots on the line. total_amount stays tax-INCLUSIVE:
-- these are contained in it, never added to it, so no existing total moves and
-- no accounting entry changes. Defaulting to 0 is therefore honest for the
-- backfilled rows — a sale that recorded no VAT breakdown declared none.
ALTER TABLE "Sale" ADD COLUMN IF NOT EXISTS "vat_amount" DECIMAL(12,2) NOT NULL DEFAULT 0;
ALTER TABLE "Sale" ADD COLUMN IF NOT EXISTS "sd_amount" DECIMAL(12,2) NOT NULL DEFAULT 0;
ALTER TABLE "Sale" ADD COLUMN IF NOT EXISTS "mushak_destination" TEXT;
ALTER TABLE "Sale" ADD COLUMN IF NOT EXISTS "mushak_vehicle_no" TEXT;

ALTER TABLE "SaleItem" ADD COLUMN IF NOT EXISTS "vat_rate" DECIMAL(5,2);
ALTER TABLE "SaleItem" ADD COLUMN IF NOT EXISTS "sd_rate" DECIMAL(5,2);
ALTER TABLE "SaleItem" ADD COLUMN IF NOT EXISTS "vat_amount" DECIMAL(12,2) NOT NULL DEFAULT 0;
ALTER TABLE "SaleItem" ADD COLUMN IF NOT EXISTS "sd_amount" DECIMAL(12,2) NOT NULL DEFAULT 0;

-- The 6.2 sales book and the 6.10 statement are both "every sale in this tax
-- period, oldest first". Sale already carries (tenant_id, sale_date), which is
-- the index those scans want, so nothing new is needed here.
