-- Customers, suppliers, their credit rows and storefront orders belong to a
-- branch. Production runs `db push`, not this file: there the same placement
-- happens in prisma/sync-party-branch.ts BEFORE the push (see its header and
-- docs/superpowers/specs/2026-10-10-branch-attached-parties-design.md). This
-- migration keeps `migrate dev` databases in step with the same rules.

ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "online_store_id" TEXT;
ALTER TABLE "Supplier" ADD COLUMN IF NOT EXISTS "store_id" TEXT;
ALTER TABLE "CustomerCreditTransaction" ADD COLUMN IF NOT EXISTS "store_id" TEXT;
ALTER TABLE "SupplierCreditTransaction" ADD COLUMN IF NOT EXISTS "store_id" TEXT;
ALTER TABLE "storefront_orders" ADD COLUMN IF NOT EXISTS "store_id" TEXT;

-- The online branch, for tenants with storefront customers (and no sale to
-- place them by) or storefront orders.
DO $$
DECLARE
    t RECORD;
    new_id TEXT;
    new_name TEXT;
    n INT;
BEGIN
    FOR t IN
        SELECT tn.id FROM "Tenant" tn
        WHERE tn.online_store_id IS NULL
          AND EXISTS (SELECT 1 FROM "Store" s WHERE s.tenant_id = tn.id)
          AND (
            EXISTS (SELECT 1 FROM "Customer" c WHERE c.tenant_id = tn.id AND c.store_id IS NULL AND c.user_id IS NOT NULL
                    AND NOT EXISTS (SELECT 1 FROM "Sale" sa WHERE sa.customer_id = c.id AND sa.status <> 'CANCELLED'))
            OR EXISTS (SELECT 1 FROM "storefront_orders" o WHERE o."tenantId" = tn.id AND o.store_id IS NULL)
          )
    LOOP
        new_id := gen_random_uuid()::text;
        new_name := 'Online Store';
        n := 1;
        WHILE EXISTS (SELECT 1 FROM "Store" WHERE tenant_id = t.id AND lower(name) = lower(new_name)) LOOP
            n := n + 1;
            new_name := 'Online Store ' || n;
        END LOOP;
        INSERT INTO "Store" (id, tenant_id, name, created_at) VALUES (new_id, t.id, new_name, NOW());
        INSERT INTO "UserStoreAccess" (id, user_id, store_id, tenant_id, access_level, created_at)
            SELECT gen_random_uuid()::text, tu.user_id, new_id, t.id, 'MULTI_STORE_CAPABLE', NOW()
            FROM "TenantUser" tu WHERE tu.tenant_id = t.id AND tu.role = 'OWNER'
            ON CONFLICT (user_id, store_id) DO NOTHING;
        UPDATE "Tenant" SET online_store_id = new_id WHERE id = t.id;
    END LOOP;
END $$;

-- Customers: most non-cancelled sales (ties: latest), storefront accounts to
-- the online branch, everyone else to the main (oldest physical) branch.
WITH counts AS (
    SELECT sa.customer_id, sa.store_id, COUNT(*) AS n, MAX(sa.created_at) AS latest
    FROM "Sale" sa JOIN "Customer" c ON c.id = sa.customer_id
    WHERE c.store_id IS NULL AND sa.status <> 'CANCELLED' AND sa.tenant_id = c.tenant_id
    GROUP BY sa.customer_id, sa.store_id
), ranked AS (
    SELECT customer_id, store_id, ROW_NUMBER() OVER (PARTITION BY customer_id ORDER BY n DESC, latest DESC, store_id) AS rn
    FROM counts
)
UPDATE "Customer" c SET store_id = r.store_id FROM ranked r
WHERE r.customer_id = c.id AND r.rn = 1 AND c.store_id IS NULL;

UPDATE "Customer" c SET store_id = t.online_store_id FROM "Tenant" t
WHERE t.id = c.tenant_id AND t.online_store_id IS NOT NULL AND c.store_id IS NULL AND c.user_id IS NOT NULL;

UPDATE "Customer" c SET store_id = m.id
FROM (SELECT DISTINCT ON (s.tenant_id) s.tenant_id, s.id FROM "Store" s JOIN "Tenant" t ON t.id = s.tenant_id
      WHERE s.id IS DISTINCT FROM t.online_store_id ORDER BY s.tenant_id, s.created_at, s.id) m
WHERE m.tenant_id = c.tenant_id AND c.store_id IS NULL;

-- Suppliers: most non-cancelled purchases (ties: latest), else the main branch.
WITH counts AS (
    SELECT p.supplier_id, p.store_id, COUNT(*) AS n, MAX(p.created_at) AS latest
    FROM "Purchase" p JOIN "Supplier" su ON su.id = p.supplier_id
    WHERE su.store_id IS NULL AND p.status <> 'CANCELLED' AND p.tenant_id = su.tenant_id
    GROUP BY p.supplier_id, p.store_id
), ranked AS (
    SELECT supplier_id, store_id, ROW_NUMBER() OVER (PARTITION BY supplier_id ORDER BY n DESC, latest DESC, store_id) AS rn
    FROM counts
)
UPDATE "Supplier" su SET store_id = r.store_id FROM ranked r
WHERE r.supplier_id = su.id AND r.rn = 1 AND su.store_id IS NULL;

UPDATE "Supplier" su SET store_id = m.id
FROM (SELECT DISTINCT ON (s.tenant_id) s.tenant_id, s.id FROM "Store" s JOIN "Tenant" t ON t.id = s.tenant_id
      WHERE s.id IS DISTINCT FROM t.online_store_id ORDER BY s.tenant_id, s.created_at, s.id) m
WHERE m.tenant_id = su.tenant_id AND su.store_id IS NULL;

-- Credit rows follow their party; storefront orders go online.
UPDATE "CustomerCreditTransaction" x SET store_id = c.store_id FROM "Customer" c
WHERE c.id = x.customer_id AND x.store_id IS NULL;
UPDATE "SupplierCreditTransaction" x SET store_id = su.store_id FROM "Supplier" su
WHERE su.id = x.supplier_id AND x.store_id IS NULL;
UPDATE "storefront_orders" o SET store_id = t.online_store_id FROM "Tenant" t
WHERE t.id = o."tenantId" AND o.store_id IS NULL;

ALTER TABLE "Customer" ALTER COLUMN "store_id" SET NOT NULL;
ALTER TABLE "Supplier" ALTER COLUMN "store_id" SET NOT NULL;
ALTER TABLE "CustomerCreditTransaction" ALTER COLUMN "store_id" SET NOT NULL;
ALTER TABLE "SupplierCreditTransaction" ALTER COLUMN "store_id" SET NOT NULL;
ALTER TABLE "storefront_orders" ALTER COLUMN "store_id" SET NOT NULL;

ALTER TABLE "Customer" DROP CONSTRAINT IF EXISTS "Customer_store_id_fkey";
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Supplier" ADD CONSTRAINT "Supplier_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CustomerCreditTransaction" ADD CONSTRAINT "CustomerCreditTransaction_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SupplierCreditTransaction" ADD CONSTRAINT "SupplierCreditTransaction_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "storefront_orders" ADD CONSTRAINT "storefront_orders_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE UNIQUE INDEX IF NOT EXISTS "Tenant_online_store_id_key" ON "Tenant"("online_store_id");
CREATE INDEX IF NOT EXISTS "Supplier_tenant_id_store_id_idx" ON "Supplier"("tenant_id", "store_id");
CREATE INDEX IF NOT EXISTS "CustomerCreditTransaction_tenant_id_store_id_idx" ON "CustomerCreditTransaction"("tenant_id", "store_id");
CREATE INDEX IF NOT EXISTS "SupplierCreditTransaction_tenant_id_store_id_idx" ON "SupplierCreditTransaction"("tenant_id", "store_id");
CREATE INDEX IF NOT EXISTS "storefront_orders_store_id_idx" ON "storefront_orders"("store_id");
