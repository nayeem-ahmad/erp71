/**
 * Gives every existing tenant the default expense categories (Salary, Rent,
 * Utilities, Refreshments, Conveyance, Miscellaneous), each with a head of
 * the same name.
 *
 * Why this is not a migration
 * ---------------------------
 * Production applies its schema with `prisma db push` and runs no migration
 * files. `seedDefaultExpenseCategories` runs at tenant creation. This script
 * is what carries the same list to tenants that already exist. It is
 * idempotent and additive: a category the tenant already named the same way
 * is left alone, including whichever account they connected it to.
 *
 * A category they deleted comes back on the next prepare. The entry form
 * cannot save against a category that has no head, so a default category
 * with zero heads also receives one named after itself.
 *
 * Runs after `db push`, which is what creates `ExpenseHead`. A database that
 * does not have those tables yet is a no-op.
 *
 * Usage:
 *   npx tsx prisma/sync-expense-categories.ts --dry-run
 *   npx tsx prisma/sync-expense-categories.ts
 */

import { PrismaClient } from '@prisma/client';
import { seedDefaultExpenseCategories } from './expense-category.seed';

const prisma = new PrismaClient();

async function tableExists(name: string): Promise<boolean> {
    const rows = await prisma.$queryRaw<{ exists: boolean }[]>`
        SELECT EXISTS (
            SELECT 1 FROM information_schema.tables
            WHERE table_schema = current_schema() AND table_name = ${name}
        ) AS "exists"
    `;
    return Boolean(rows[0]?.exists);
}

export interface SyncExpenseCategoriesResult {
    tenants: number;
    created: number;
    headsAdded: number;
}

export async function syncExpenseCategories(
    client: PrismaClient = prisma,
    options: { dryRun?: boolean } = {},
): Promise<SyncExpenseCategoriesResult> {
    const result: SyncExpenseCategoriesResult = { tenants: 0, created: 0, headsAdded: 0 };
    if (!(await tableExists('ExpenseCategory')) || !(await tableExists('ExpenseHead'))) {
        return result;
    }

    const tenants = await client.tenant.findMany({
        where: { deleted_at: null },
        select: { id: true },
    });
    result.tenants = tenants.length;

    for (const tenant of tenants) {
        const seeded = await seedDefaultExpenseCategories(client, tenant.id, options);
        result.created += seeded.created.length;
        result.headsAdded += seeded.headsAdded.length;
    }

    return result;
}

async function main() {
    const dryRun = process.argv.includes('--dry-run');
    console.log(`Sync expense categories (${dryRun ? 'DRY RUN' : 'LIVE'})`);
    const result = await syncExpenseCategories(prisma, { dryRun });
    console.log(
        `  ${result.tenants} tenant(s): ` +
        `${dryRun ? 'would add' : 'added'} ${result.created} categor${result.created === 1 ? 'y' : 'ies'}, ` +
        `${result.headsAdded} head${result.headsAdded === 1 ? '' : 's'}.`,
    );
    if (dryRun) console.log('DRY RUN — nothing was written.');
}

if (require.main === module) {
    main()
        .catch((error) => {
            console.error(error);
            process.exit(1);
        })
        .finally(() => prisma.$disconnect());
}
