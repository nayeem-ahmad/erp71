-- A branch may not hold two warehouses of the same name, and no warehouse may
-- be nameless.
--
-- Until now `name` was a free-text column with no constraint behind it, and the
-- API validated it as `@IsString()` — which an empty string satisfies. So a
-- warehouse could be saved with a blank name, or with the name of one that
-- already existed, and both then showed up in the warehouse pickers on every
-- entry screen: those render the name alone, so a blank or repeated one leaves
-- "which location holds this stock?" with no answer.
--
-- Scoped to (tenant, store) rather than the whole tenant: two branches each
-- calling a location "Godown" is normal, the pickers are filtered to one
-- branch, and the list page carries a Branch column. It also matches the
-- identity the CSV importer has always used to match rows to existing rows.
--
-- The column is already populated and neither rule was enforced before, so the
-- offending rows have to be repaired first or CREATE UNIQUE INDEX fails.
-- Production never runs this file — it applies schema with `prisma db push` —
-- which is why the same repair is done by prisma/sync-warehouse-name-unique.ts,
-- wired ahead of db push in apps/backend/Dockerfile. This file keeps a
-- developer's own database in step with what that script does on the server.
--
-- Nothing is deleted and no stock moves: only the `name` text changes.

-- 1. A nameless warehouse is named after the branch that holds it, matching how
--    ensureDefaultWarehouse names the one it creates.
UPDATE "Warehouse" AS w
SET "name" = COALESCE(NULLIF(btrim(s."name"), ''), 'Branch') || ' Warehouse'
FROM "Store" AS s
WHERE s."id" = w."store_id"
  AND (w."name" IS NULL OR btrim(w."name") = '');

-- 2. Surrounding whitespace is stripped, so " Main " and "Main" stop being two
--    different names the moment before uniqueness starts being enforced.
UPDATE "Warehouse"
SET "name" = btrim("name")
WHERE "name" <> btrim("name");

-- 3. Within a branch, one warehouse keeps each name — the branch default, else
--    the oldest — and every other is suffixed with its code, which is already
--    unique per tenant. The subquery reads the table as it stood when the
--    statement began, so the keeper is chosen once and consistently.
UPDATE "Warehouse" AS w
SET "name" = w."name" || ' (' || w."code" || ')'
WHERE w."id" <> (
    SELECT k."id" FROM "Warehouse" AS k
    WHERE k."tenant_id" = w."tenant_id"
      AND k."store_id" = w."store_id"
      AND lower(k."name") = lower(w."name")
    ORDER BY k."is_default" DESC, k."created_at", k."id"
    LIMIT 1
);

-- 4. Safety net for the case step 3 cannot settle: a branch that already held a
--    warehouse literally named "Main (WH-2)". The row id cannot repeat, so this
--    pass always terminates the collision.
UPDATE "Warehouse" AS w
SET "name" = w."name" || ' (' || w."id" || ')'
WHERE w."id" <> (
    SELECT k."id" FROM "Warehouse" AS k
    WHERE k."tenant_id" = w."tenant_id"
      AND k."store_id" = w."store_id"
      AND lower(k."name") = lower(w."name")
    ORDER BY k."is_default" DESC, k."created_at", k."id"
    LIMIT 1
);

-- Case-sensitive, because that is all `@@unique([tenant_id, store_id, name])`
-- can express and `db push` drops any index the schema does not describe. The
-- case-insensitive half of the rule lives in InventoryService, which rejects a
-- name that differs from an existing one only by case; this index is the
-- backstop that two concurrent requests cannot slip past.
CREATE UNIQUE INDEX "Warehouse_tenant_id_store_id_name_key" ON "Warehouse"("tenant_id", "store_id", "name");
