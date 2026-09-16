/**
 * Repairs blank and repeated `Warehouse.name` values so the unique index on
 * (tenant_id, store_id, name) can be created.
 *
 * Why this exists, and why it runs BEFORE `db push`
 * ------------------------------------------------
 * Production does not run `prisma migrate deploy`. The container boots with
 * `prisma db push` (see apps/backend/Dockerfile), which syncs the *shape* of the
 * schema — including creating the unique index that migration
 * `20260916120000_warehouse_name_unique` adds.
 *
 * That index is built on a column which is **already populated**, and until now
 * nothing stopped a warehouse being saved with a blank name or with the name of
 * one that already existed: the API validated it as `@IsString()`, which an
 * empty string satisfies, and no constraint stood behind the column. If two
 * warehouses in one branch still share a name, Postgres refuses to build the
 * index, `db push` exits non-zero, and because it sits at the head of the
 * container's `&&` chain **the backend never boots** — an untidy name becomes a
 * total outage.
 *
 * So, like `sync-user-mobile-unique.ts` and unlike every other `sync:*` script,
 * this one runs *ahead* of `db push` rather than after it. By the time the index
 * is built there is nothing left for it to trip over.
 *
 * What it does to a collision
 * ---------------------------
 * Nothing is ever deleted and no stock moves — only the `name` text changes:
 *
 *   1. A **blank** name (or one that is only whitespace) is replaced with the
 *      branch's own name plus " Warehouse", matching how `ensureDefaultWarehouse`
 *      names the warehouse it creates.
 *   2. Surrounding whitespace is stripped everywhere, so " Main " and "Main"
 *      stop being two names the moment before uniqueness starts being enforced.
 *   3. Within a branch, one warehouse keeps each name — the branch default, else
 *      the oldest — and each of the others is suffixed with its **code**, which
 *      is already unique per tenant. Should that still collide (a branch that
 *      already held a warehouse literally called "Main (WH-2)"), the row id is
 *      used instead, which cannot repeat.
 *
 * Names are compared case-insensitively, matching the check InventoryService
 * applies to new and renamed warehouses. The index itself is case-sensitive —
 * that is all `@@unique` can express, and `db push` drops any index the schema
 * does not describe — so this is the stricter of the two and leaves nothing for
 * the index to reject.
 *
 * It runs on every container start, so it must be idempotent. It is: once every
 * name is present and unique within its branch, the query returns nothing and
 * the script is a no-op.
 *
 * Everything here is raw SQL rather than the typed client, deliberately. The
 * script runs before the schema has been synced, so the generated client may
 * describe columns the database does not have yet; naming the handful it
 * actually needs keeps it working across that gap. It also tolerates the table
 * being absent altogether, which is the fresh-database case — a first boot has
 * nothing to repair and must not fail here.
 *
 * Usage:
 *   npx tsx prisma/sync-warehouse-name-unique.ts --dry-run   # report only
 *   npx tsx prisma/sync-warehouse-name-unique.ts             # report and fix
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

interface Row {
    id: string;
    tenant_id: string;
    store_id: string;
    store_name: string | null;
    name: string | null;
    code: string;
}

/**
 * Is there a `Warehouse` table to work on? A database that has never had
 * `db push` run against it has none, and this script sits ahead of the step
 * that would create it.
 */
async function warehouseTableExists(): Promise<boolean> {
    const rows = await prisma.$queryRaw<Array<{ count: bigint }>>`
        SELECT COUNT(*)::bigint AS count
        FROM information_schema.columns
        WHERE table_name = 'Warehouse' AND column_name = 'name'
    `;
    return Number(rows[0]?.count ?? 0) > 0;
}

/**
 * Every warehouse whose name is blank, carries stray whitespace, or is shared
 * with another warehouse of the same branch. Ordered so the keeper of each
 * shared name comes first: the branch default ahead of the rest, then oldest.
 */
async function loadOffenders(): Promise<Row[]> {
    return prisma.$queryRaw<Row[]>`
        SELECT w.id, w.tenant_id, w.store_id, s.name AS store_name, w.name, w.code
        FROM "Warehouse" AS w
        LEFT JOIN "Store" AS s ON s.id = w.store_id
        WHERE w.name IS NULL
           OR w.name <> btrim(w.name)
           OR btrim(w.name) = ''
           OR EXISTS (
               SELECT 1 FROM "Warehouse" AS o
               WHERE o.id <> w.id
                 AND o.tenant_id = w.tenant_id
                 AND o.store_id = w.store_id
                 AND lower(btrim(COALESCE(o.name, ''))) = lower(btrim(COALESCE(w.name, '')))
           )
        ORDER BY w.tenant_id, w.store_id, lower(btrim(COALESCE(w.name, ''))),
                 w.is_default DESC, w.created_at, w.id
    `;
}

/**
 * The branch a name has to be unique within — the same scope the unique index
 * uses. Keyed on the tenant as well as the store so the two can never be
 * conflated, whatever a database happens to hold.
 */
const branchOf = (row: { tenant_id: string; store_id: string }) => `${row.tenant_id}:${row.store_id}`;

/**
 * The names held by warehouses this run will not touch, per branch. A repair
 * must not walk into one of these, and they are gathered separately from the
 * offenders so that an offender is never blocked by its own current name.
 */
async function loadUntouchedNames(offenderIds: Set<string>): Promise<Map<string, Set<string>>> {
    const rows = await prisma.$queryRaw<
        Array<{ id: string; tenant_id: string; store_id: string; name: string | null }>
    >`
        SELECT id, tenant_id, store_id, name FROM "Warehouse"
    `;
    const taken = new Map<string, Set<string>>();
    for (const row of rows) {
        if (offenderIds.has(row.id)) continue;
        const key = (row.name ?? '').trim().toLowerCase();
        if (!key) continue;
        const branch = branchOf(row);
        const names = taken.get(branch);
        if (names) names.add(key);
        else taken.set(branch, new Set([key]));
    }
    return taken;
}

function blankReplacement(row: Row): string {
    const branch = (row.store_name ?? '').trim();
    return `${branch || 'Branch'} Warehouse`;
}

async function main() {
    const dryRun = process.argv.includes('--dry-run');

    if (!(await warehouseTableExists())) {
        console.log('[sync-warehouse-name-unique] No Warehouse table yet — fresh database, nothing to do.');
        return;
    }

    const rows = await loadOffenders();
    if (rows.length === 0) {
        console.log('[sync-warehouse-name-unique] Every warehouse name is present and unique within its branch. Nothing to do.');
        return;
    }

    const taken = await loadUntouchedNames(new Set(rows.map((row) => row.id)));
    /** store_id -> the names this run has already handed out. */
    const claimed = new Map<string, Set<string>>();

    const isFree = (branch: string, name: string) => {
        const key = name.trim().toLowerCase();
        return !taken.get(branch)?.has(key) && !claimed.get(branch)?.has(key);
    };
    const claim = (branch: string, name: string) => {
        const key = name.trim().toLowerCase();
        const names = claimed.get(branch);
        if (names) names.add(key);
        else claimed.set(branch, new Set([key]));
    };

    const fixes: Array<{ row: Row; from: string; to: string }> = [];

    for (const row of rows) {
        const current = row.name ?? '';
        const base = current.trim() || blankReplacement(row);
        const branch = branchOf(row);

        // The first row of each (branch, name) group keeps the name outright:
        // loadOffenders ordered them so the keeper comes first, and claiming it
        // turns every later row of the group into a collision that has to be
        // renamed. `taken` holds only the names of warehouses this run leaves
        // alone, so a row is never blocked by the name it already carries.
        let next = base;
        if (!isFree(branch, next)) {
            next = `${base} (${row.code})`;
        }
        if (!isFree(branch, next)) {
            next = `${base} (${row.id})`;
        }

        claim(branch, next);
        // A row whose only problem was stray whitespace still needs the write.
        if (next !== current) fixes.push({ row, from: current, to: next });
    }

    if (fixes.length === 0) {
        console.log('[sync-warehouse-name-unique] Nothing to change.');
        return;
    }

    console.log(`[sync-warehouse-name-unique] ${fixes.length} warehouse name(s) to repair:`);
    for (const fix of fixes) {
        console.log(`  ${fix.row.id}  ${JSON.stringify(fix.from)} -> ${JSON.stringify(fix.to)}`);
    }

    if (dryRun) {
        console.log(`[sync-warehouse-name-unique] --dry-run: would rename ${fixes.length} warehouse(s). No changes made.`);
        return;
    }

    for (const fix of fixes) {
        await prisma.$executeRaw`UPDATE "Warehouse" SET name = ${fix.to} WHERE id = ${fix.row.id}`;
    }

    console.log(`[sync-warehouse-name-unique] Renamed ${fixes.length} warehouse(s).`);
}

main()
    .catch((error) => {
        console.error('[sync-warehouse-name-unique] Failed:', error);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
