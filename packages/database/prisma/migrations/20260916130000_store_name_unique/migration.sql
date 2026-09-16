-- A tenant may not hold two branches of the same name, and no branch may be
-- nameless. The sibling of 20260916120000_warehouse_name_unique, and found
-- while writing it.
--
-- `Store.name` was guarded by `@MinLength(1)` with no trim, so `"   "` is three
-- characters and passed; `StoresService.create` then trimmed it to `''` and
-- wrote a branch that shows as blank in the branch switcher, in every store
-- picker and in the Branch column of the warehouses list. `rename` had no check
-- at all — neither blank nor duplicate — so a branch could also be renamed onto
-- another branch's name, and the switcher shows the name and nothing else.
--
-- Scoped to the tenant, unlike the warehouse rule: a branch is the top of that
-- hierarchy and has nothing above it to be unique within.
--
-- This runs BEFORE the warehouse repair, not after. A blank branch name is what
-- 20260916120000 falls back to "Branch Warehouse" for, so repairing branches
-- first means a warehouse that needs a name gets a real one.
--
-- The column is already populated and neither rule was enforced before, so the
-- offending rows have to be repaired first or CREATE UNIQUE INDEX fails.
-- Production never runs this file — it applies schema with `prisma db push` —
-- which is why the same repair is done by prisma/sync-store-name-unique.ts,
-- wired ahead of db push in apps/backend/Dockerfile. This file keeps a
-- developer's own database in step with what that script does on the server.
--
-- Nothing is deleted and no branch is merged: only the `name` text changes.

-- 1. A nameless branch is named after its own creation order, which is the only
--    thing distinguishing it from another nameless one.
UPDATE "Store" AS s
SET "name" = 'Branch ' || (
    SELECT COUNT(*) FROM "Store" AS k
    WHERE k."tenant_id" = s."tenant_id" AND k."created_at" <= s."created_at"
)
WHERE s."name" IS NULL OR btrim(s."name") = '';

-- 2. Surrounding whitespace is stripped, so " Gulshan " and "Gulshan" stop being
--    two different names the moment before uniqueness starts being enforced.
UPDATE "Store"
SET "name" = btrim("name")
WHERE "name" <> btrim("name");

-- 3. Within a tenant, one branch keeps each name — the oldest — and every other
--    is suffixed with its row id, which cannot repeat. There is no second
--    identifier on a branch to use the way a warehouse has its code. The
--    subquery reads the table as it stood when the statement began, so the
--    keeper is chosen once and consistently.
UPDATE "Store" AS s
SET "name" = s."name" || ' (' || s."id" || ')'
WHERE s."id" <> (
    SELECT k."id" FROM "Store" AS k
    WHERE k."tenant_id" = s."tenant_id"
      AND lower(k."name") = lower(s."name")
    ORDER BY k."created_at", k."id"
    LIMIT 1
);

-- Case-sensitive, because that is all `@@unique([tenant_id, name])` can express
-- and `db push` drops any index the schema does not describe. The
-- case-insensitive half of the rule lives in StoresService, which rejects a name
-- that differs from an existing one only by case; this index is the backstop
-- that two concurrent requests cannot slip past.
CREATE UNIQUE INDEX "Store_tenant_id_name_key" ON "Store"("tenant_id", "name");
