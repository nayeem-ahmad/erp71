/**
 * Gives every supplier without one a code (`SUP-00001`, `SUP-00002`, …), the
 * way every customer has a `CUST-` code.
 *
 * Why this exists, and why it runs AFTER `db push`
 * ------------------------------------------------
 * Production boots with `prisma db push`, not `prisma migrate deploy`, so the
 * backfill in migration `20261011120000_supplier_code` never runs there.
 * `Supplier.supplier_code` is nullable, so `db push` adds it without complaint
 * and its unique index is a formality over NULLs; this then fills it in.
 * Nothing breaks if it never runs — the supplier list shows a blank code — and
 * every prepare runs it again, so a supplier the old backend creates while a
 * deploy swaps over gets its code on the next one.
 *
 * How codes are assigned
 * ----------------------
 * Per tenant, suppliers with no code are numbered in creation order, after the
 * highest `SUP-<n>` the tenant already holds. A code someone typed is never
 * rewritten.
 *
 * Idempotent: once every supplier has a code the UPDATE touches nothing. Raw
 * SQL, because the generated client may describe a column the database does
 * not have yet; tolerates the column being absent.
 *
 * Usage:
 *   npx tsx prisma/sync-supplier-code.ts --dry-run   # report only
 *   npx tsx prisma/sync-supplier-code.ts             # report and fix
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/** Shared with the migration of the same name — keep the two in step. */
export const FILL_SUPPLIER_CODES_SQL = `
WITH taken AS (
    SELECT "tenant_id", MAX(CAST(SUBSTRING("supplier_code" FROM '^SUP-([0-9]+)$') AS NUMERIC)) AS base
    FROM "Supplier"
    WHERE "supplier_code" ~ '^SUP-[0-9]+$'
    GROUP BY "tenant_id"
),
ranked AS (
    SELECT "id", "tenant_id",
           ROW_NUMBER() OVER (PARTITION BY "tenant_id" ORDER BY "created_at", "id") AS rn
    FROM "Supplier"
    WHERE "supplier_code" IS NULL
)
UPDATE "Supplier" AS s
SET "supplier_code" = 'SUP-' || LPAD((COALESCE(t.base, 0) + r.rn)::text, GREATEST(5, LENGTH((COALESCE(t.base, 0) + r.rn)::text)), '0')
FROM ranked AS r
LEFT JOIN taken AS t ON t."tenant_id" = r."tenant_id"
WHERE s."id" = r."id"
`;

async function main() {
    const dryRun = process.argv.includes('--dry-run');

    const columns = await prisma.$queryRaw<Array<{ count: bigint }>>`
        SELECT COUNT(*)::bigint AS count FROM information_schema.columns
        WHERE table_name = 'Supplier' AND column_name = 'supplier_code'
    `;
    if (Number(columns[0]?.count ?? 0) === 0) {
        console.log('[sync-supplier-code] No Supplier.supplier_code column yet — nothing to do.');
        return;
    }

    const pending = await prisma.$queryRaw<Array<{ count: bigint }>>`
        SELECT COUNT(*)::bigint AS count FROM "Supplier" WHERE "supplier_code" IS NULL
    `;
    const count = Number(pending[0]?.count ?? 0);
    if (count === 0) {
        console.log('[sync-supplier-code] Every supplier already has a code. Nothing to do.');
        return;
    }

    if (dryRun) {
        console.log(`[sync-supplier-code] --dry-run: would assign ${count} supplier code(s). No changes made.`);
        return;
    }

    const updated = await prisma.$executeRawUnsafe(FILL_SUPPLIER_CODES_SQL);
    console.log(`[sync-supplier-code] Assigned ${updated} supplier code(s).`);
}

main()
    .catch((error) => {
        console.error('[sync-supplier-code] Failed:', error);
        process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
