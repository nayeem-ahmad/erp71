/**
 * Repairs blank and repeated `Store.name` values so the unique index on
 * (tenant_id, name) can be created.
 *
 * Why this exists, and why it runs BEFORE `db push`
 * ------------------------------------------------
 * Production does not run `prisma migrate deploy`. The container boots with
 * `prisma db push` (see apps/backend/Dockerfile), which syncs the *shape* of the
 * schema — including creating the unique index that migration
 * `20260916130000_store_name_unique` adds.
 *
 * That index is built on a column which is **already populated**, and until now
 * nothing stopped a branch being saved with a blank name or with the name of one
 * that already existed: `CreateStoreDto` guarded the name with `@MinLength(1)`
 * and no trim, so `"   "` passed and was written as `''`, and `rename` had no
 * check at all — neither blank nor duplicate. If two branches of one tenant
 * still share a name, Postgres refuses to build the index, `db push` exits
 * non-zero, and because it sits at the head of the container's `&&` chain **the
 * backend never boots** — an untidy name becomes a total outage.
 *
 * So, like `sync-user-mobile-unique.ts` and `sync-warehouse-name-unique.ts`,
 * this one runs *ahead* of `db push` rather than after it.
 *
 * **It must also run before `sync:warehouse-name-unique`.** A warehouse with no
 * name is renamed after the branch holding it, so a branch repaired first hands
 * the warehouse a real name instead of the "Branch Warehouse" fallback.
 *
 * What it does to a collision
 * ---------------------------
 * Nothing is ever deleted and no branch is merged — only the `name` text
 * changes, and no document, stock balance or permission moves with it:
 *
 *   1. A **blank** name (or one that is only whitespace) becomes "Branch N",
 *      numbered by the tenant's own creation order, which is the only thing
 *      distinguishing one nameless branch from another.
 *   2. Surrounding whitespace is stripped everywhere, so " Gulshan " and
 *      "Gulshan" stop being two names the moment before uniqueness is enforced.
 *   3. Within a tenant, the oldest branch keeps each name and each of the others
 *      is suffixed with its row id, which cannot repeat. A branch has no second
 *      identifier to use the way a warehouse has its code.
 *
 * Names are compared case-insensitively, matching the check StoresService
 * applies to new and renamed branches. The index itself is case-sensitive — that
 * is all `@@unique` can express, and `db push` drops any index the schema does
 * not describe — so this is the stricter of the two and leaves nothing for the
 * index to reject.
 *
 * It runs on every container start, so it must be idempotent. It is: once every
 * name is present and unique within its tenant, the query returns nothing and
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
 *   npx tsx prisma/sync-store-name-unique.ts --dry-run   # report only
 *   npx tsx prisma/sync-store-name-unique.ts             # report and fix
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

interface Row {
    id: string;
    tenant_id: string;
    name: string | null;
    rank: bigint;
}

/**
 * Is there a `Store` table to work on? A database that has never had `db push`
 * run against it has none, and this script sits ahead of the step that would
 * create it.
 */
async function storeTableExists(): Promise<boolean> {
    const rows = await prisma.$queryRaw<Array<{ count: bigint }>>`
        SELECT COUNT(*)::bigint AS count
        FROM information_schema.columns
        WHERE table_name = 'Store' AND column_name = 'name'
    `;
    return Number(rows[0]?.count ?? 0) > 0;
}

/**
 * Every branch whose name is blank, carries stray whitespace, or is shared with
 * another branch of the same tenant. `rank` is its position in the tenant's
 * creation order, which is what names a blank one. Ordered so the keeper of each
 * shared name comes first: oldest, then by id.
 */
async function loadOffenders(): Promise<Row[]> {
    return prisma.$queryRaw<Row[]>`
        SELECT s.id, s.tenant_id, s.name,
               (SELECT COUNT(*) FROM "Store" AS k
                WHERE k.tenant_id = s.tenant_id AND k.created_at <= s.created_at)::bigint AS rank
        FROM "Store" AS s
        WHERE s.name IS NULL
           OR s.name <> btrim(s.name)
           OR btrim(s.name) = ''
           OR EXISTS (
               SELECT 1 FROM "Store" AS o
               WHERE o.id <> s.id
                 AND o.tenant_id = s.tenant_id
                 AND lower(btrim(COALESCE(o.name, ''))) = lower(btrim(COALESCE(s.name, '')))
           )
        ORDER BY s.tenant_id, lower(btrim(COALESCE(s.name, ''))), s.created_at, s.id
    `;
}

/**
 * The names held by branches this run will not touch, per tenant. A repair must
 * not walk into one of these, and they are gathered separately from the
 * offenders so that an offender is never blocked by its own current name.
 */
async function loadUntouchedNames(offenderIds: Set<string>): Promise<Map<string, Set<string>>> {
    const rows = await prisma.$queryRaw<Array<{ id: string; tenant_id: string; name: string | null }>>`
        SELECT id, tenant_id, name FROM "Store"
    `;
    const taken = new Map<string, Set<string>>();
    for (const row of rows) {
        if (offenderIds.has(row.id)) continue;
        const key = (row.name ?? '').trim().toLowerCase();
        if (!key) continue;
        const names = taken.get(row.tenant_id);
        if (names) names.add(key);
        else taken.set(row.tenant_id, new Set([key]));
    }
    return taken;
}

async function main() {
    const dryRun = process.argv.includes('--dry-run');

    if (!(await storeTableExists())) {
        console.log('[sync-store-name-unique] No Store table yet — fresh database, nothing to do.');
        return;
    }

    const rows = await loadOffenders();
    if (rows.length === 0) {
        console.log('[sync-store-name-unique] Every branch name is present and unique within its tenant. Nothing to do.');
        return;
    }

    const taken = await loadUntouchedNames(new Set(rows.map((row) => row.id)));
    /** tenant_id -> the names this run has already handed out. */
    const claimed = new Map<string, Set<string>>();

    const isFree = (tenantId: string, name: string) => {
        const key = name.trim().toLowerCase();
        return !taken.get(tenantId)?.has(key) && !claimed.get(tenantId)?.has(key);
    };
    const claim = (tenantId: string, name: string) => {
        const key = name.trim().toLowerCase();
        const names = claimed.get(tenantId);
        if (names) names.add(key);
        else claimed.set(tenantId, new Set([key]));
    };

    const fixes: Array<{ row: Row; from: string; to: string }> = [];

    for (const row of rows) {
        const current = row.name ?? '';
        const base = current.trim() || `Branch ${row.rank}`;

        // The first row of each (tenant, name) group keeps the name outright:
        // loadOffenders ordered them so the keeper comes first, and claiming it
        // turns every later row of the group into a collision that has to be
        // renamed. `taken` holds only the names of branches this run leaves
        // alone, so a row is never blocked by the name it already carries.
        let next = base;
        if (!isFree(row.tenant_id, next)) {
            next = `${base} (${row.id})`;
        }

        claim(row.tenant_id, next);
        // A row whose only problem was stray whitespace still needs the write.
        if (next !== current) fixes.push({ row, from: current, to: next });
    }

    if (fixes.length === 0) {
        console.log('[sync-store-name-unique] Nothing to change.');
        return;
    }

    console.log(`[sync-store-name-unique] ${fixes.length} branch name(s) to repair:`);
    for (const fix of fixes) {
        console.log(`  ${fix.row.id}  ${JSON.stringify(fix.from)} -> ${JSON.stringify(fix.to)}`);
    }

    if (dryRun) {
        console.log(`[sync-store-name-unique] --dry-run: would rename ${fixes.length} branch(es). No changes made.`);
        return;
    }

    for (const fix of fixes) {
        await prisma.$executeRaw`UPDATE "Store" SET name = ${fix.to} WHERE id = ${fix.row.id}`;
    }

    console.log(`[sync-store-name-unique] Renamed ${fixes.length} branch(es).`);
}

main()
    .catch((error) => {
        console.error('[sync-store-name-unique] Failed:', error);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
