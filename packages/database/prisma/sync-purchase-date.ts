/**
 * Copies `Purchase.created_at` onto `purchase_date` for bills that predate the
 * column, then makes the column NOT NULL.
 *
 * Why this runs BEFORE `db push`
 * ------------------------------
 * Production does not run `prisma migrate deploy`. Migration
 * `20261014120000_add_purchase_date` adds `purchase_date` NOT NULL DEFAULT
 * CURRENT_TIMESTAMP and then sets it from `created_at`. `db push` does only
 * the first half: every existing bill is stamped with the deploy clock, and
 * reports, stock and the supplier statement then treat that instant as when
 * the purchase happened.
 *
 * This adds the column nullable when it is missing, fills only NULLs from
 * `created_at`, and sets NOT NULL plus the default while the table is locked.
 * A bill the old backend inserts in that gap cannot land without a date, and
 * `db push` is left to add the `(tenant_id, purchase_date)` index.
 *
 * Idempotent: a date that is already set is never rewritten, so a time an
 * operator chose survives every later deploy. Once the column is NOT NULL the
 * script does not lock the table. A fresh database with no `Purchase` table
 * is a no-op.
 *
 * Raw SQL rather than the typed client: this runs before the schema sync, so
 * the generated client may describe a column the database does not have yet.
 *
 * Usage:
 *   npx tsx prisma/sync-purchase-date.ts --dry-run
 *   npx tsx prisma/sync-purchase-date.ts
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function exists(sql: string): Promise<boolean> {
    const rows = await prisma.$queryRawUnsafe<{ exists: boolean }[]>(sql);
    return Boolean(rows[0]?.exists);
}

async function purchaseTableExists(): Promise<boolean> {
    return exists(`
        SELECT EXISTS (
            SELECT 1 FROM information_schema.tables
            WHERE table_schema = current_schema() AND table_name = 'Purchase'
        ) AS "exists"
    `);
}

async function purchaseDateColumn(): Promise<{ exists: boolean; nullable: boolean }> {
    const rows = await prisma.$queryRawUnsafe<{ is_nullable: string }[]>(`
        SELECT is_nullable
        FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND table_name = 'Purchase'
          AND column_name = 'purchase_date'
    `);
    if (rows.length === 0) return { exists: false, nullable: true };
    return { exists: true, nullable: rows[0].is_nullable === 'YES' };
}

/** Rows still waiting for a date. Zero once the backfill has run. */
export async function countUnfilledPurchaseDates(client: PrismaClient = prisma): Promise<number> {
    const rows = await client.$queryRawUnsafe<{ count: bigint }[]>(`
        SELECT COUNT(*)::bigint AS count
        FROM "Purchase"
        WHERE "purchase_date" IS NULL
    `);
    return Number(rows[0]?.count ?? 0);
}

/**
 * Fill NULL purchase dates from `created_at` and lock the column down.
 * Returns how many rows were written. Does nothing when the column is already
 * NOT NULL — that is every prepare after the first.
 */
export async function syncPurchaseDate(client: PrismaClient = prisma): Promise<number> {
    return client.$transaction(async (tx) => {
        await tx.$executeRawUnsafe('LOCK TABLE "Purchase" IN SHARE ROW EXCLUSIVE MODE');
        await tx.$executeRawUnsafe(
            'ALTER TABLE "Purchase" ADD COLUMN IF NOT EXISTS "purchase_date" TIMESTAMP(3)',
        );
        const filled = await tx.$executeRawUnsafe(
            'UPDATE "Purchase" SET "purchase_date" = "created_at" WHERE "purchase_date" IS NULL',
        );
        await tx.$executeRawUnsafe(
            'ALTER TABLE "Purchase" ALTER COLUMN "purchase_date" SET DEFAULT CURRENT_TIMESTAMP',
        );
        await tx.$executeRawUnsafe(
            'ALTER TABLE "Purchase" ALTER COLUMN "purchase_date" SET NOT NULL',
        );
        return filled;
    });
}

async function main() {
    const dryRun = process.argv.includes('--dry-run');

    if (!(await purchaseTableExists())) {
        console.log('[sync-purchase-date] No Purchase table yet — fresh database, nothing to do.');
        return;
    }

    const column = await purchaseDateColumn();
    if (column.exists && !column.nullable) {
        console.log('[sync-purchase-date] purchase_date is already set on every bill. Nothing to do.');
        return;
    }

    if (!column.exists) {
        console.log('[sync-purchase-date] purchase_date is missing; a real run adds it and copies created_at.');
        if (dryRun) {
            console.log('[sync-purchase-date] --dry-run: no changes made.');
            return;
        }
    } else {
        const pending = await countUnfilledPurchaseDates();
        console.log(`[sync-purchase-date] ${pending} purchase(s) have no purchase_date.`);
        if (dryRun) {
            console.log('[sync-purchase-date] --dry-run: no changes made.');
            return;
        }
    }

    const filled = await syncPurchaseDate();
    console.log(`[sync-purchase-date] Set purchase_date from created_at on ${filled} purchase(s).`);
}

// Importers (the backend spec) call the functions and must not boot a second
// main, or disconnect the shared client when this file is loaded.
if (require.main === module) {
    main()
        .catch((error) => {
            console.error('[sync-purchase-date] Failed:', error);
            process.exitCode = 1;
        })
        .finally(() => prisma.$disconnect());
}
