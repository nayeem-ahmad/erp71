/**
 * Partial uniques and the cash-only check for branch drawers.
 *
 * Prisma's schema cannot express a partial unique, and production applies
 * the schema with `prisma db push --accept-data-loss`, which drops indexes
 * the schema does not describe. `db-prepare.sh` runs these statements after
 * every push. `sync-branch-books` runs them again before a manual fold.
 * Neither path stamps drawers or moves lines.
 */

export const BRANCH_BOOK_CONSTRAINT_SQL = [
    `CREATE UNIQUE INDEX IF NOT EXISTS "accounts_shared_name_key" ON "accounts" ("tenant_id", "name") WHERE "store_id" IS NULL`,
    `CREATE UNIQUE INDEX IF NOT EXISTS "accounts_one_drawer_per_branch" ON "accounts" ("tenant_id", "store_id") WHERE "store_id" IS NOT NULL`,
    `DO $$ BEGIN
        ALTER TABLE "accounts" ADD CONSTRAINT "accounts_store_id_cash_only"
        CHECK ("store_id" IS NULL OR "category" = 'cash');
     EXCEPTION WHEN duplicate_object THEN NULL;
     END $$`,
    `DROP INDEX IF EXISTS "accounts_tenant_id_name_key"`,
];

/** Installs the four statements. Returns the first error message, or null. */
export async function installBranchBookConstraints(
    execute: (sql: string) => Promise<unknown>,
): Promise<string | null> {
    for (const sql of BRANCH_BOOK_CONSTRAINT_SQL) {
        try {
            await execute(sql);
        } catch (error) {
            return error instanceof Error ? error.message : String(error);
        }
    }
    return null;
}
