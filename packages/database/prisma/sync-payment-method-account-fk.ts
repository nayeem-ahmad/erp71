/**
 * Clears `PaymentMethod.account_id` values that point at no account, so
 * `db push` can add the foreign key to `accounts`.
 *
 * Why this runs BEFORE `db push`
 * ------------------------------
 * `PaymentMethod.account_id` was a bare string with no foreign key until
 * migration `20261019120000_branch_payment_methods` added one. Production does
 * not run `prisma migrate deploy`; `db push` adds the constraint, and Postgres
 * refuses to add it while any row names an account that is gone (an account
 * deleted before the guard in `deleteAccount` covered payment methods). With
 * `--accept-data-loss` the push would fail, and every deploy with it.
 *
 * Nulling such a value loses nothing: it already pointed nowhere, and a method
 * with no account falls back to the canonical type's default account when it
 * posts. The post-push `sync:payment-method-accounts` then links the default
 * methods to their accounts.
 *
 * Idempotent: once no dangling value is left it writes nothing. A fresh
 * database with no `PaymentMethod` or `accounts` table is a no-op, and so is a
 * database whose `PaymentMethod` has no `account_id` column yet.
 *
 * Raw SQL rather than the typed client: this runs before the schema sync, so
 * the generated client may describe columns the database does not have yet.
 *
 * Usage:
 *   npx tsx prisma/sync-payment-method-account-fk.ts --dry-run
 *   npx tsx prisma/sync-payment-method-account-fk.ts
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function exists(sql: string): Promise<boolean> {
    const rows = await prisma.$queryRawUnsafe<{ exists: boolean }[]>(sql);
    return Boolean(rows[0]?.exists);
}

async function tableExists(name: string): Promise<boolean> {
    return exists(`
        SELECT EXISTS (
            SELECT 1 FROM information_schema.tables
            WHERE table_schema = current_schema() AND table_name = '${name}'
        ) AS "exists"
    `);
}

async function accountIdColumnExists(): Promise<boolean> {
    return exists(`
        SELECT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = current_schema()
              AND table_name = 'PaymentMethod'
              AND column_name = 'account_id'
        ) AS "exists"
    `);
}

const DANGLING = `
    "account_id" IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM accounts a WHERE a.id = "PaymentMethod"."account_id")
`;

/** Methods whose account no longer exists. Zero once the sync has run. */
export async function countDanglingPaymentMethodAccounts(client: PrismaClient = prisma): Promise<number> {
    const rows = await client.$queryRawUnsafe<{ count: bigint }[]>(`
        SELECT COUNT(*)::bigint AS count FROM "PaymentMethod" WHERE ${DANGLING}
    `);
    return Number(rows[0]?.count ?? 0);
}

/** Null every dangling `account_id`. Returns how many rows were written. */
export async function syncPaymentMethodAccountFk(client: PrismaClient = prisma): Promise<number> {
    return client.$executeRawUnsafe(`UPDATE "PaymentMethod" SET "account_id" = NULL WHERE ${DANGLING}`);
}

async function main() {
    const dryRun = process.argv.includes('--dry-run');

    if (!(await tableExists('PaymentMethod')) || !(await tableExists('accounts'))) {
        console.log(
            '[sync-payment-method-account-fk] No PaymentMethod or accounts table yet — fresh database, nothing to do.',
        );
        return;
    }
    if (!(await accountIdColumnExists())) {
        console.log('[sync-payment-method-account-fk] PaymentMethod has no account_id yet. Nothing to do.');
        return;
    }

    const dangling = await countDanglingPaymentMethodAccounts();
    console.log(`[sync-payment-method-account-fk] ${dangling} payment method(s) point at a missing account.`);
    if (dangling === 0) return;

    if (dryRun) {
        console.log('[sync-payment-method-account-fk] --dry-run: no changes made.');
        return;
    }

    const cleared = await syncPaymentMethodAccountFk();
    console.log(`[sync-payment-method-account-fk] Cleared account_id on ${cleared} payment method(s).`);
}

// Importers (a spec) call the functions and must not boot a second main, or
// disconnect the shared client when this file is loaded.
if (require.main === module) {
    main()
        .catch((error) => {
            console.error('[sync-payment-method-account-fk] Failed:', error);
            process.exitCode = 1;
        })
        .finally(() => prisma.$disconnect());
}
