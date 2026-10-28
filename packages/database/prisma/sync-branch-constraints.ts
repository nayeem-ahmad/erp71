/**
 * Puts the branch-drawer indexes and the cash-only check back after `db push`.
 *
 * Why this runs AFTER `db push`
 * -----------------------------
 * Production does not run `prisma migrate deploy`. `db push --accept-data-loss`
 * drops indexes the schema does not describe. The partial uniques
 * (`accounts_shared_name_key`, `accounts_one_drawer_per_branch`) and the
 * check `accounts_store_id_cash_only` live only as SQL, so the push removes
 * them and also drops `accounts_tenant_id_name_key` once the schema no longer
 * has that unique. This script puts the three rules back on every boot and
 * drops the old name unique if it is still there.
 *
 * It does not stamp a drawer, move a line, or place an employee. That fold
 * is `sync:branch-books`, and it stays a reviewed manual run. Do not pass
 * `--yes` here: this script has no data pass.
 *
 * Idempotent. If `accounts.store_id` is missing it exits 1 and writes nothing.
 *
 * Usage:
 *   npx tsx prisma/sync-branch-constraints.ts
 */

import { PrismaClient } from '@prisma/client';
import { installBranchBookConstraints } from './branch-book-constraints';

const prisma = new PrismaClient();

async function accountsStoreColumnExists(): Promise<boolean> {
    const rows = await prisma.$queryRawUnsafe<{ exists: boolean }[]>(`
        SELECT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = current_schema()
              AND table_name = 'accounts'
              AND column_name = 'store_id'
        ) AS "exists"
    `);
    return Boolean(rows[0]?.exists);
}

async function main() {
    if (!(await accountsStoreColumnExists())) {
        console.error(
            'Missing accounts.store_id. Run prisma db push before sync:branch-constraints.',
        );
        process.exitCode = 1;
        return;
    }

    const error = await installBranchBookConstraints((sql) => prisma.$executeRawUnsafe(sql));
    if (error) {
        console.error(`Could not install branch-drawer constraints: ${error}`);
        process.exitCode = 1;
        return;
    }
    console.log('branch-book constraints are in place.');
}

main()
    .catch((error: unknown) => {
        console.error(error instanceof Error ? error.message : error);
        process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
