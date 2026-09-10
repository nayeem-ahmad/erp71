-- Entry cancellation: a tenant admin voids a posted sale or purchase, with a
-- mandatory note, and every impact it recorded is reversed.
--
-- Cancelling is deliberately NOT a delete. A deleted document leaves the
-- reversing stock movements and the audit row pointing at nothing, and a tenant
-- asked later why their stock moved has no invoice to look at. The row stays,
-- carries the reason, and drops out of every money query.

-- AlterEnum
-- The tenant-admin grant. `UserStorePermission.permission` and
-- `TenantRolePermission.permission` are both this enum, so the value has to
-- exist in Postgres before the backfill script can write it. IF NOT EXISTS,
-- matching the other permission migrations: production reaches this value
-- through `db push`, so a developer's database may already carry it.
ALTER TYPE "StorePermission" ADD VALUE IF NOT EXISTS 'CANCEL_ENTRY';

-- AlterTable
-- Sale already has a lifecycle column, and 'CANCELLED' joins
-- DRAFT/COMPLETED/REFUNDED/PARTIAL_REFUND in it. Every sales report already
-- filters `status = 'COMPLETED'`, so a cancelled sale leaves the revenue
-- figures without a single query changing.
ALTER TABLE "Sale" ADD COLUMN "cancelled_at" TIMESTAMP(3);
ALTER TABLE "Sale" ADD COLUMN "cancelled_by" TEXT;
ALTER TABLE "Sale" ADD COLUMN "cancellation_note" TEXT;

-- AlterTable
-- Purchase had no lifecycle column at all: `payment_status` answers "is the
-- bill settled?", which a cancelled bill is not, so the two cannot share one.
-- Existing rows default to RECORDED, which is what every one of them is.
ALTER TABLE "Purchase" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'RECORDED';
ALTER TABLE "Purchase" ADD COLUMN "cancelled_at" TIMESTAMP(3);
ALTER TABLE "Purchase" ADD COLUMN "cancelled_by" TEXT;
ALTER TABLE "Purchase" ADD COLUMN "cancellation_note" TEXT;

-- CreateIndex
-- Every purchase money query now carries `status <> 'CANCELLED'` alongside the
-- tenant scope, the same shape as the payment_status index beside it.
CREATE INDEX IF NOT EXISTS "Purchase_tenant_id_status_idx" ON "Purchase"("tenant_id", "status");
