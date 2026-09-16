-- Recording stock found over the book, alongside stock written off.
--
-- Until now the only way to put a surplus back was a full stock take: a counter
-- who found three extra cartons in the back had to open a counting session for
-- the whole warehouse, or — as actually happened — leave the book wrong. This
-- gives InventoryShrinkage a direction so the same document records both sides
-- of a miscount.
--
-- `direction` defaults to 'LOSS', which is what every existing row is: the
-- table has only ever held write-offs. No backfill is needed and no existing
-- report changes, because every reader is scoped to LOSS.
--
-- `notes` is deliberately NOT made NOT NULL. A note is now required on a *new*
-- entry (enforced in CreateInventoryShrinkageDto), but the rows written before
-- that rule exist without one, and the only way to satisfy a NOT NULL here
-- would be to invent text for documents nobody can go back and ask about.
--
-- Production reconciles with `prisma db push` rather than running migrations
-- (see apps/backend/Dockerfile), so this file is the record; `IF NOT EXISTS`
-- keeps it a no-op on a database `db push` has already reached.
ALTER TABLE "InventoryShrinkage" ADD COLUMN IF NOT EXISTS "direction" TEXT NOT NULL DEFAULT 'LOSS';

CREATE INDEX IF NOT EXISTS "InventoryShrinkage_tenant_id_direction_created_at_idx"
    ON "InventoryShrinkage"("tenant_id", "direction", "created_at");

-- Seed the FOUND reason catalogue for every tenant that already exists.
--
-- Without this the feature ships unusable for them: the entry screen filters
-- reasons by type, a tenant with no FOUND reasons gets an empty picker, and the
-- service refuses an entry whose reason is not an active FOUND reason. Only the
-- seed runs for new tenants, and no tenant re-runs it.
--
-- `is_system` marks these as the platform's own, which is what stops the
-- settings screen offering to delete them. ON CONFLICT covers the tenants a
-- re-run would otherwise duplicate — the unique key is (tenant_id, type, code).
INSERT INTO "InventoryReason" ("id", "tenant_id", "type", "code", "label", "is_system", "is_active", "display_order", "created_at", "updated_at")
SELECT
    gen_random_uuid()::text,
    t."id",
    'FOUND',
    defaults."code",
    defaults."label",
    true,
    true,
    defaults."display_order",
    NOW(),
    NOW()
FROM "Tenant" AS t
CROSS JOIN (
    VALUES
        ('MISCOUNT', 'Miscount', 0),
        ('UNRECORDED_RETURN', 'Unrecorded Customer Return', 1),
        ('UNRECORDED_RECEIPT', 'Unrecorded Supplier Receipt', 2),
        ('UNKNOWN', 'Unknown Surplus', 3)
) AS defaults ("code", "label", "display_order")
ON CONFLICT ("tenant_id", "type", "code") DO NOTHING;
