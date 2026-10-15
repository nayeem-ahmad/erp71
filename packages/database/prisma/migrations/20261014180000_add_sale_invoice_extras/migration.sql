-- Transport, labour and the free-form adjustment, kept apart from the line
-- total so an edit puts each one back in the box it was typed in. Older rows
-- stay at zero; their unexplained gap still reopens as the adjustment.

ALTER TABLE "Sale" ADD COLUMN "transport_cost" DECIMAL(12,2) NOT NULL DEFAULT 0;
ALTER TABLE "Sale" ADD COLUMN "labor_cost" DECIMAL(12,2) NOT NULL DEFAULT 0;
ALTER TABLE "Sale" ADD COLUMN "rounding" DECIMAL(12,2) NOT NULL DEFAULT 0;
