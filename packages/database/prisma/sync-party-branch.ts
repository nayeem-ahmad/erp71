/**
 * Gives every customer, supplier, customer/supplier credit row and storefront
 * order a branch (`store_id`), so `db push` can make those columns NOT NULL.
 *
 * Why this runs BEFORE `db push`
 * ------------------------------
 * Production does not run `prisma migrate deploy`; it boots with `prisma db
 * push` (apps/backend/scripts/db-prepare.sh). Migration
 * `20261010150000_party_branch` adds the columns nullable, backfills and then
 * sets NOT NULL, but that sequencing never runs here. `db push` would try to
 * add NOT NULL columns to tables that already have rows, Postgres would refuse,
 * and the backend would never boot. So this adds the columns itself (nullable,
 * `IF NOT EXISTS`) and fills them first; by the time `db push` runs, NOT NULL
 * and the foreign keys are a formality. Same shape as `sync-board-slug.ts`.
 *
 * Where each row goes (docs/superpowers/specs/2026-10-10-branch-attached-parties-design.md)
 * --------------------
 * - Customer: the branch it was added at if it has one; else the branch with
 *   most of its non-cancelled sales (ties: the latest sale's branch); else, for
 *   a storefront account (`user_id` set), the online branch; else the main
 *   branch.
 * - Supplier: the branch with most of its non-cancelled purchases (ties: the
 *   latest); else the main branch.
 * - Customer and supplier credit rows: their party's branch.
 * - Storefront orders: the online branch.
 *
 * The **main branch** is the tenant's oldest store by `created_at`, then `id`,
 * never the online branch. The **online branch** is the store
 * `Tenant.online_store_id` points at; this script creates it — named "Online
 * Store" (or "Online Store 2", … if a branch already has that name), with an
 * access row for every owner — for a tenant that has storefront customers or
 * orders and no online branch yet. Same rules as `OnlineBranchService`.
 *
 * Idempotent: every update is `WHERE store_id IS NULL`, so an assigned row is
 * never moved and a second run does nothing. Tolerates a fresh database (no
 * tables yet). A tenant with no store at all keeps its nulls and is reported,
 * and setting NOT NULL then fails and rolls everything back — loudly, which is
 * the point: provisioning always creates a store, so such a tenant is broken
 * data worth seeing before the deploy goes any further.
 *
 * Raw SQL rather than the typed client: the generated client describes the new
 * schema, which the database does not have yet when this runs.
 *
 * Usage:
 *   npx tsx prisma/sync-party-branch.ts --dry-run   # report only
 *   npx tsx prisma/sync-party-branch.ts             # report and fix
 */

import { randomUUID } from 'node:crypto';
import { Prisma, PrismaClient } from '@prisma/client';
import { nextOnlineStoreName } from './party-branch.utils';

const prisma = new PrismaClient();
const DRY_RUN = process.argv.includes('--dry-run');

/**
 * Everything runs in one transaction. A dry run does all of it for real —
 * so the counts it prints are exact, new columns included — and then rolls
 * back. The client is set once the transaction opens.
 */
let db: Prisma.TransactionClient;

class DryRunRollback extends Error {}

async function tableExists(table: string): Promise<boolean> {
    const rows = await prisma.$queryRawUnsafe<{ exists: boolean }[]>(
        `SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = $1) AS "exists"`,
        table,
    );
    return Boolean(rows[0]?.exists);
}

async function run(label: string, sql: string): Promise<number> {
    const count = await db.$executeRawUnsafe(sql);
    console.log(`  ${label}: ${count}`);
    return count;
}

/** The main branch per tenant: oldest store, never the online one. */
const MAIN_BRANCH = `
    SELECT DISTINCT ON (s.tenant_id) s.tenant_id, s.id
    FROM "Store" s
    JOIN "Tenant" t ON t.id = s.tenant_id
    WHERE s.id IS DISTINCT FROM t.online_store_id
    ORDER BY s.tenant_id, s.created_at, s.id
`;

async function ensureColumns(hasOrders: boolean): Promise<void> {
    const statements = [
        `ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "online_store_id" TEXT`,
        `ALTER TABLE "Supplier" ADD COLUMN IF NOT EXISTS "store_id" TEXT`,
        `ALTER TABLE "CustomerCreditTransaction" ADD COLUMN IF NOT EXISTS "store_id" TEXT`,
        `ALTER TABLE "SupplierCreditTransaction" ADD COLUMN IF NOT EXISTS "store_id" TEXT`,
        ...(hasOrders ? [`ALTER TABLE "storefront_orders" ADD COLUMN IF NOT EXISTS "store_id" TEXT`] : []),
    ];
    for (const sql of statements) {
        await db.$executeRawUnsafe(sql);
    }
}

/**
 * Creates the online branch for every tenant that has storefront customers
 * (with no sale to place them by) or storefront orders still without a branch.
 */
async function ensureOnlineBranches(hasOrders: boolean): Promise<void> {
    const needing = await db.$queryRawUnsafe<{ tenant_id: string }[]>(`
        SELECT t.id AS tenant_id
        FROM "Tenant" t
        WHERE t.online_store_id IS NULL
          AND EXISTS (SELECT 1 FROM "Store" s WHERE s.tenant_id = t.id)
          AND (
            EXISTS (
                SELECT 1 FROM "Customer" c
                WHERE c.tenant_id = t.id AND c.store_id IS NULL AND c.user_id IS NOT NULL
                  AND NOT EXISTS (
                      SELECT 1 FROM "Sale" sa
                      WHERE sa.customer_id = c.id AND sa.status <> 'CANCELLED'
                  )
            )
            ${hasOrders ? `OR EXISTS (SELECT 1 FROM "storefront_orders" o WHERE o."tenantId" = t.id AND o.store_id IS NULL)` : ''}
          )
    `);
    console.log(`  tenants given an online branch: ${needing.length}`);

    for (const { tenant_id } of needing) {
        await (async (tx: Prisma.TransactionClient) => {
            const names = await tx.$queryRawUnsafe<{ name: string }[]>(
                `SELECT name FROM "Store" WHERE tenant_id = $1`,
                tenant_id,
            );
            const storeId = randomUUID();
            await tx.$executeRawUnsafe(
                `INSERT INTO "Store" (id, tenant_id, name, created_at) VALUES ($1, $2, $3, NOW())`,
                storeId,
                tenant_id,
                nextOnlineStoreName(names.map((row) => row.name)),
            );
            // `/auth/me` lists a member's branches from these rows alone, so an
            // owner without one would never see the branch.
            const owners = await tx.$queryRawUnsafe<{ user_id: string }[]>(
                `SELECT user_id FROM "TenantUser" WHERE tenant_id = $1 AND role = 'OWNER'`,
                tenant_id,
            );
            for (const { user_id } of owners) {
                await tx.$executeRawUnsafe(
                    `INSERT INTO "UserStoreAccess" (id, user_id, store_id, tenant_id, access_level, created_at)
                     VALUES ($1, $2, $3, $4, 'MULTI_STORE_CAPABLE', NOW())
                     ON CONFLICT (user_id, store_id) DO NOTHING`,
                    randomUUID(),
                    user_id,
                    storeId,
                    tenant_id,
                );
            }
            await tx.$executeRawUnsafe(
                `UPDATE "Tenant" SET online_store_id = $1 WHERE id = $2 AND online_store_id IS NULL`,
                storeId,
                tenant_id,
            );
        })(db);
    }
}

async function placeCustomers(): Promise<void> {
    await run('customers → most-sales branch', `
        WITH counts AS (
            SELECT sa.customer_id, sa.store_id, COUNT(*) AS n, MAX(sa.created_at) AS latest
            FROM "Sale" sa
            JOIN "Customer" c ON c.id = sa.customer_id
            WHERE c.store_id IS NULL AND sa.status <> 'CANCELLED' AND sa.tenant_id = c.tenant_id
            GROUP BY sa.customer_id, sa.store_id
        ), ranked AS (
            SELECT customer_id, store_id,
                   ROW_NUMBER() OVER (PARTITION BY customer_id ORDER BY n DESC, latest DESC, store_id) AS rn
            FROM counts
        )
        UPDATE "Customer" c SET store_id = r.store_id
        FROM ranked r
        WHERE r.customer_id = c.id AND r.rn = 1 AND c.store_id IS NULL
    `);
    await run('storefront customers → online branch', `
        UPDATE "Customer" c SET store_id = t.online_store_id
        FROM "Tenant" t
        WHERE t.id = c.tenant_id AND t.online_store_id IS NOT NULL
          AND c.store_id IS NULL AND c.user_id IS NOT NULL
    `);
    await run('customers → main branch', `
        UPDATE "Customer" c SET store_id = m.id
        FROM (${MAIN_BRANCH}) m
        WHERE m.tenant_id = c.tenant_id AND c.store_id IS NULL
    `);
}

async function placeSuppliers(): Promise<void> {
    await run('suppliers → most-purchases branch', `
        WITH counts AS (
            SELECT p.supplier_id, p.store_id, COUNT(*) AS n, MAX(p.created_at) AS latest
            FROM "Purchase" p
            JOIN "Supplier" su ON su.id = p.supplier_id
            WHERE su.store_id IS NULL AND p.status <> 'CANCELLED' AND p.tenant_id = su.tenant_id
            GROUP BY p.supplier_id, p.store_id
        ), ranked AS (
            SELECT supplier_id, store_id,
                   ROW_NUMBER() OVER (PARTITION BY supplier_id ORDER BY n DESC, latest DESC, store_id) AS rn
            FROM counts
        )
        UPDATE "Supplier" su SET store_id = r.store_id
        FROM ranked r
        WHERE r.supplier_id = su.id AND r.rn = 1 AND su.store_id IS NULL
    `);
    await run('suppliers → main branch', `
        UPDATE "Supplier" su SET store_id = m.id
        FROM (${MAIN_BRANCH}) m
        WHERE m.tenant_id = su.tenant_id AND su.store_id IS NULL
    `);
}

async function placeCreditRows(): Promise<void> {
    await run('customer credit rows → customer branch', `
        UPDATE "CustomerCreditTransaction" x SET store_id = c.store_id
        FROM "Customer" c
        WHERE c.id = x.customer_id AND x.store_id IS NULL AND c.store_id IS NOT NULL
    `);
    await run('supplier credit rows → supplier branch', `
        UPDATE "SupplierCreditTransaction" x SET store_id = su.store_id
        FROM "Supplier" su
        WHERE su.id = x.supplier_id AND x.store_id IS NULL AND su.store_id IS NOT NULL
    `);
}

async function placeOrders(): Promise<void> {
    await run('storefront orders → online branch', `
        UPDATE "storefront_orders" o SET store_id = t.online_store_id
        FROM "Tenant" t
        WHERE t.id = o."tenantId" AND o.store_id IS NULL AND t.online_store_id IS NOT NULL
    `);
}

async function reportLeftovers(hasOrders: boolean): Promise<void> {
    const tables = [
        ['Customer', 'store_id'],
        ['Supplier', 'store_id'],
        ['CustomerCreditTransaction', 'store_id'],
        ['SupplierCreditTransaction', 'store_id'],
        ...(hasOrders ? [['storefront_orders', 'store_id']] : []),
    ];
    for (const [table, column] of tables) {
        const rows = await db.$queryRawUnsafe<{ n: bigint }[]>(
            `SELECT COUNT(*) AS n FROM "${table}" WHERE "${column}" IS NULL`,
        );
        const n = Number(rows[0]?.n ?? 0);
        if (n > 0) console.warn(`  WARNING: ${n} ${table} rows still have no branch (tenant without any store?)`);
    }
}

/**
 * NOT NULL is set here, in the transaction that filled the columns, not left
 * to `db push`: the old backend keeps serving while this prepare runs, and a
 * row it wrote between this commit and the push would arrive without a branch
 * and fail the push. With the constraint in place first, such a write fails
 * instead — for the few seconds until the swap — and `db push` finds the
 * columns already as the schema wants them. If a row could not be placed
 * (a tenant with no store), this throws and the whole transaction rolls back.
 */
async function requireBranches(hasOrders: boolean): Promise<void> {
    const tables = [
        'Customer',
        'Supplier',
        'CustomerCreditTransaction',
        'SupplierCreditTransaction',
        ...(hasOrders ? ['storefront_orders'] : []),
    ];
    for (const table of tables) {
        await db.$executeRawUnsafe(`ALTER TABLE "${table}" ALTER COLUMN "store_id" SET NOT NULL`);
    }
    console.log('  store_id is now required on every placed table.');
}

async function main(): Promise<void> {
    if (!(await tableExists('Store')) || !(await tableExists('Customer'))) {
        console.log('sync:party-branch — fresh database, nothing to place.');
        return;
    }
    const hasOrders = await tableExists('storefront_orders');
    console.log(`sync:party-branch${DRY_RUN ? ' (dry run)' : ''}`);

    try {
        await prisma.$transaction(async (tx) => {
            db = tx;
            await ensureColumns(hasOrders);
            await ensureOnlineBranches(hasOrders);
            await placeCustomers();
            await placeSuppliers();
            await placeCreditRows();
            if (hasOrders) await placeOrders();
            await reportLeftovers(hasOrders);
            await requireBranches(hasOrders);
            if (DRY_RUN) throw new DryRunRollback();
        }, { maxWait: 60_000, timeout: 30 * 60_000 });
    } catch (error) {
        if (error instanceof DryRunRollback) {
            console.log('  dry run: rolled back, nothing written.');
            return;
        }
        throw error;
    }
}

main()
    .catch((error) => {
        console.error('[sync-party-branch] Failed:', error);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
