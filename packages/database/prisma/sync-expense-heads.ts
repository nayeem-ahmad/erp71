/**
 * Gives every expense entry that predates expense heads a head named after
 * its category, then points the entry at it.
 *
 * Why this runs AFTER `db push`
 * -----------------------------
 * Production does not run `prisma migrate deploy`. `db push` creates
 * `ExpenseHead` and a nullable `ExpenseEntry.head_id` and does not copy any
 * rows. Without this script every existing expense has no head, and the
 * report cannot split a category into the people (or other heads) under it.
 *
 * The column stays nullable on purpose. Prepare runs while the previous app
 * is still serving, and that app inserts an expense with a category and no
 * head. A NOT NULL column with no default would reject those inserts. The
 * API on this release requires a head; this script fills whatever is still
 * null, and a later prepare fills anything the previous app wrote in the gap.
 *
 * Idempotent: a head named exactly like its category is reused, and an entry
 * that already has a head is left alone. A fresh database with no
 * ExpenseEntry table is a no-op.
 *
 * Raw SQL: this can run against a database the generated client has not
 * caught up with, and the statement is the same one the migration uses.
 *
 * Usage:
 *   npx tsx prisma/sync-expense-heads.ts --dry-run
 *   npx tsx prisma/sync-expense-heads.ts
 */

import { PrismaClient } from '@prisma/client';

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

export interface SyncExpenseHeadsResult {
    /** Categories that received a head named after themselves. */
    created: number;
    /** Entries whose head_id was empty and is now set. */
    linked: number;
    /** Entries that still have no head. Zero after a real run that could see the tables. */
    remaining: number;
}

export async function countEntriesWithoutHead(client: PrismaClient = prisma): Promise<number> {
    const rows = await client.$queryRawUnsafe<{ count: bigint }[]>(`
        SELECT COUNT(*)::bigint AS count FROM "ExpenseEntry" WHERE "head_id" IS NULL
    `);
    return Number(rows[0]?.count ?? 0);
}

/**
 * Create the catch-all head for each category that still has an unheaded
 * entry, and point those entries at it. Returns how many heads were inserted
 * and how many entries were linked.
 */
export async function syncExpenseHeads(client: PrismaClient = prisma): Promise<SyncExpenseHeadsResult> {
    return client.$transaction(async (tx) => {
        const created = await tx.$executeRawUnsafe(`
            INSERT INTO "ExpenseHead" ("id", "tenant_id", "category_id", "name", "created_at", "updated_at")
            SELECT gen_random_uuid()::text, c."tenant_id", c."id", c."name", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
            FROM "ExpenseCategory" c
            WHERE EXISTS (
                SELECT 1 FROM "ExpenseEntry" e
                WHERE e."category_id" = c."id" AND e."head_id" IS NULL
            )
            AND NOT EXISTS (
                SELECT 1 FROM "ExpenseHead" h
                WHERE h."category_id" = c."id" AND h."name" = c."name"
            )
        `);
        const linked = await tx.$executeRawUnsafe(`
            UPDATE "ExpenseEntry" e
            SET "head_id" = h."id"
            FROM "ExpenseHead" h
            INNER JOIN "ExpenseCategory" c ON c."id" = h."category_id" AND c."name" = h."name"
            WHERE e."head_id" IS NULL
              AND e."category_id" = c."id"
        `);
        const rows = await tx.$queryRawUnsafe<{ count: bigint }[]>(`
            SELECT COUNT(*)::bigint AS count FROM "ExpenseEntry" WHERE "head_id" IS NULL
        `);
        return {
            created: Number(created),
            linked: Number(linked),
            remaining: Number(rows[0]?.count ?? 0),
        };
    });
}

async function main() {
    const dryRun = process.argv.includes('--dry-run');

    if (!(await tableExists('ExpenseEntry')) || !(await tableExists('ExpenseHead'))) {
        console.log('[sync-expense-heads] Expense tables are not in place yet. Nothing to do.');
        return;
    }

    const pending = await countEntriesWithoutHead();
    console.log(`[sync-expense-heads] ${pending} expense(s) have no head.`);
    if (dryRun) {
        console.log('[sync-expense-heads] --dry-run: no changes made.');
        return;
    }
    if (pending === 0) {
        console.log('[sync-expense-heads] Nothing to do.');
        return;
    }

    const result = await syncExpenseHeads();
    console.log(
        `[sync-expense-heads] Created ${result.created} head(s) and linked ${result.linked} expense(s). ` +
            `${result.remaining} still have no head.`,
    );
    if (result.remaining > 0) {
        throw new Error(`${result.remaining} expense(s) still have no head after the backfill.`);
    }
}

if (require.main === module) {
    main()
        .catch((error) => {
            console.error('[sync-expense-heads] Failed:', error);
            process.exitCode = 1;
        })
        .finally(() => prisma.$disconnect());
}
