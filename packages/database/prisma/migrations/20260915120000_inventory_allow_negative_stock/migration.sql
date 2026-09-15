-- Per-tenant opt-in to selling stock the books do not show yet.
--
-- Until now every stock issue was refused when the warehouse balance was
-- short, which is right for a transfer or a stock take but wrong at a counter:
-- the goods are going out of the door whether or not the purchase that brought
-- them in has been entered, and refusing the sale loses the sale. Tenants that
-- turn this on get a negative balance instead of a rejection, readable as
-- "owed to stock" until the receipt catches up.
--
-- Defaults to false so no existing tenant's behaviour changes.
ALTER TABLE "InventorySettings"
    ADD COLUMN IF NOT EXISTS "allow_negative_stock" BOOLEAN NOT NULL DEFAULT false;
