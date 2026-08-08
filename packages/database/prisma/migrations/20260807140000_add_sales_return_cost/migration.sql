-- Cost snapshot on returned goods.
--
-- A sales return reduced revenue but left COGS untouched, so every refund
-- overstated gross profit by the whole cost of the goods coming back. This
-- records what the returned units cost, taken from the original sale line where
-- there is one and from the weighted-average pool otherwise.
--
-- Nullable, and left null for existing rows: a return recorded before this
-- column existed has no cost on file, and backfilling it with zero would claim
-- those goods were free. `backfill:product-costs` fills what it can from the
-- parent sale lines, after it has restated those lines.

ALTER TABLE "SalesReturnItem"
  ADD COLUMN IF NOT EXISTS "unit_cost_at_return" DECIMAL(12, 2);
