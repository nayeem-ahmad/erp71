-- Per-member invoice layout: padding, when the customer's balance prints,
-- table style and the optional invoice extras. Held on the membership rather
-- than the workspace, so each member keeps their own answers on any till.

-- AlterTable
-- Nullable with no default: NULL is "the built-in layout", which is how every
-- existing member's invoices already print, so there is nothing to backfill.
ALTER TABLE "TenantUser" ADD COLUMN IF NOT EXISTS "invoice_print_prefs" JSONB;
