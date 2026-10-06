-- How a shop's prices are entered: VAT-inclusive (the default, unchanged
-- behaviour) or before VAT with the tax added on top. Documents record the mode
-- they were entered in; every default is "prices include VAT".
ALTER TABLE "Tenant" ADD COLUMN "prices_include_vat" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Sale" ADD COLUMN "prices_include_vat" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Quotation" ADD COLUMN "prices_include_vat" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Quotation" ADD COLUMN "vat_amount" DECIMAL(12,2) NOT NULL DEFAULT 0;
ALTER TABLE "SalesOrder" ADD COLUMN "prices_include_vat" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "SalesOrder" ADD COLUMN "vat_amount" DECIMAL(12,2) NOT NULL DEFAULT 0;
