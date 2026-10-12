/**
 * Gives every branch without one a code (`S1`, `S2`, …), so a document number
 * format that prints `{STORE}` works the moment a tenant saves it.
 *
 * Why this exists, and why it runs AFTER `db push`
 * ------------------------------------------------
 * Production boots with `prisma db push`, not `prisma migrate deploy`, so the
 * backfill in migration `20261007180000_document_numbering` never runs there.
 * `Store.code` is nullable, so `db push` adds it without complaint and its
 * unique index is a formality over NULLs; this then fills it in. Nothing breaks
 * if it never runs — the numbering engine assigns a code on first use — but
 * the settings page would show blank codes until then.
 *
 * How codes are assigned
 * ----------------------
 * Per tenant, branches with no code are numbered in creation order, after the
 * highest `S<n>` the tenant already holds. A code an owner has typed is never
 * rewritten.
 *
 * Idempotent: once every branch has a code the UPDATE touches nothing. Raw SQL,
 * because the generated client may describe a column the database does not
 * have yet; tolerates the column being absent.
 *
 * Usage:
 *   npx tsx prisma/sync-store-code.ts --dry-run   # report only
 *   npx tsx prisma/sync-store-code.ts             # report and fix
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/** Shared with the migration of the same name — keep the two in step. */
export const FILL_STORE_CODES_SQL = `
WITH taken AS (
    SELECT "tenant_id", MAX(CAST(SUBSTRING("code" FROM 2) AS INTEGER)) AS base
    FROM "Store"
    WHERE "code" ~ '^S[0-9]{1,5}$'
    GROUP BY "tenant_id"
),
ranked AS (
    SELECT "id", "tenant_id",
           ROW_NUMBER() OVER (PARTITION BY "tenant_id" ORDER BY "created_at", "id") AS rn
    FROM "Store"
    WHERE "code" IS NULL
)
UPDATE "Store" AS s
SET "code" = 'S' || (COALESCE(t.base, 0) + r.rn)
FROM ranked AS r
LEFT JOIN taken AS t ON t."tenant_id" = r."tenant_id"
WHERE s."id" = r."id"
`;

async function main() {
    const dryRun = process.argv.includes('--dry-run');

    const columns = await prisma.$queryRaw<Array<{ count: bigint }>>`
        SELECT COUNT(*)::bigint AS count FROM information_schema.columns
        WHERE table_name = 'Store' AND column_name = 'code'
    `;
    if (Number(columns[0]?.count ?? 0) === 0) {
        console.log('[sync-store-code] No Store.code column yet — nothing to do.');
        return;
    }

    const pending = await prisma.$queryRaw<Array<{ count: bigint }>>`
        SELECT COUNT(*)::bigint AS count FROM "Store" WHERE "code" IS NULL
    `;
    const count = Number(pending[0]?.count ?? 0);
    if (count === 0) {
        console.log('[sync-store-code] Every branch already has a code. Nothing to do.');
        return;
    }

    if (dryRun) {
        console.log(`[sync-store-code] --dry-run: would assign ${count} branch code(s). No changes made.`);
        return;
    }

    const updated = await prisma.$executeRawUnsafe(FILL_STORE_CODES_SQL);
    console.log(`[sync-store-code] Assigned ${updated} branch code(s).`);
}

main()
    .catch((error) => {
        console.error('[sync-store-code] Failed:', error);
        process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
