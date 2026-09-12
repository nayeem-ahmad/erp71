-- Cross-branch warehouse transfer approval (Epic 40, Story 4).
--
-- `is_cross_branch`, `requires_approval`, `approved_by` and `approval_date`
-- already existed as dead columns: nothing ever wrote them and no endpoint read
-- them except the accounting attribution in `warehouse-transfers.service.ts`.
-- This migration adds the three columns a rejection needs so the approval step
-- can actually be recorded, and backfills the two branch columns for transfers
-- that predate it.
--
-- `approved_by`/`approval_date` keep meaning exactly what they say — they are
-- set only on an approval — so a row states which way the decision went without
-- anyone having to interpret `status`.
--
-- Production reconciles with `prisma db push` rather than running migrations
-- (see apps/backend/Dockerfile), so this file is the record; `IF NOT EXISTS`
-- keeps it a no-op on a database `db push` has already reached.
ALTER TABLE "WarehouseTransfer" ADD COLUMN IF NOT EXISTS "rejected_by" TEXT;
ALTER TABLE "WarehouseTransfer" ADD COLUMN IF NOT EXISTS "rejected_at" TIMESTAMP(3);
ALTER TABLE "WarehouseTransfer" ADD COLUMN IF NOT EXISTS "rejection_reason" TEXT;

-- Backfill the branch columns from the warehouses the transfer already names.
-- Only rows that never had them set are touched, and `is_cross_branch` is
-- recomputed from the same two warehouses `create` now compares — so a historic
-- transfer reports under the right branch and shows the right badge.
--
-- Deliberately NOT backfilled: `requires_approval`. It governs stock that has
-- not moved yet, and every one of these transfers has already been sent or
-- received. Setting it now would strand settled documents in a state their
-- stock has long left.
UPDATE "WarehouseTransfer" AS t
SET
    "source_store_id" = src."store_id",
    "destination_store_id" = dst."store_id",
    "is_cross_branch" = (src."store_id" <> dst."store_id")
FROM "Warehouse" AS src, "Warehouse" AS dst
WHERE src."id" = t."source_warehouse_id"
  AND dst."id" = t."destination_warehouse_id"
  AND t."source_store_id" IS NULL
  AND t."destination_store_id" IS NULL;
