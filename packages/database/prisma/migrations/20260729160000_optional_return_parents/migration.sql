-- A return no longer requires the document it came from.
--
-- Goods can come back that were sold or bought before the business moved onto
-- this system, so insisting on a parent made those returns unrecordable. When a
-- parent IS given it is still validated: the lines must belong to it and stay
-- within what remains returnable.
--
-- The line-level ids relax with the headers — a return with no parent has no
-- parent line to point at, and identifies its goods by product_id instead.
--
-- Widening only: every existing row already satisfies these columns.

ALTER TABLE "SalesReturn" ALTER COLUMN "sale_id" DROP NOT NULL;
ALTER TABLE "SalesReturnItem" ALTER COLUMN "sale_item_id" DROP NOT NULL;

ALTER TABLE "PurchaseReturn" ALTER COLUMN "purchase_id" DROP NOT NULL;
ALTER TABLE "PurchaseReturnItem" ALTER COLUMN "purchase_item_id" DROP NOT NULL;
