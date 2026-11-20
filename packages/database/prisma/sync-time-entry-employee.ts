/**
 * Stamps each project hour log with the employee its login is linked to.
 *
 * Why this exists
 * ---------------
 * `ProjectTimeEntry.employee_id` is the hook project costing needs to price an
 * hour against payroll, and until 2026-11-19 nothing wrote it: every entry was
 * logged under `user_id` alone. The backend now stamps it on every new entry,
 * and stamps a person's earlier entries the moment HR links their login to an
 * employee record. This is the half a code change cannot reach — the entries
 * logged before either of those existed.
 *
 * Production boots with `prisma db push`, so the same statement in migration
 * `20261119090000_employee_user_unique_per_tenant` never runs there.
 *
 * Only ever fills a NULL, never rewrites a stamped entry: an hour logged while
 * someone was linked to one employee card stays theirs if the login is later
 * re-linked. Idempotent — once every linked entry is stamped it touches nothing.
 * Not load-bearing for anything but the costing rollups, which do not exist yet.
 *
 * Usage:
 *   npx tsx prisma/sync-time-entry-employee.ts --dry-run   # report only
 *   npx tsx prisma/sync-time-entry-employee.ts             # report and fix
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/** Shared with the migration of the same name — keep the two in step. */
export const PENDING_SQL = `
SELECT COUNT(*)::bigint AS count
FROM "project_time_entries" AS te
JOIN "Employee" AS e
  ON e."tenant_id" = te."tenant_id"
 AND e."user_id" = te."user_id"
 AND e."deleted_at" IS NULL
WHERE te."employee_id" IS NULL
`;

export const STAMP_SQL = `
UPDATE "project_time_entries" AS te
SET "employee_id" = e."id"
FROM "Employee" AS e
WHERE te."employee_id" IS NULL
  AND te."user_id" IS NOT NULL
  AND e."tenant_id" = te."tenant_id"
  AND e."user_id" = te."user_id"
  AND e."deleted_at" IS NULL
`;

async function main() {
    const dryRun = process.argv.includes('--dry-run');

    const pending = await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(PENDING_SQL);
    const count = Number(pending[0]?.count ?? 0);
    if (count === 0) {
        console.log('[sync-time-entry-employee] Every linked hour log already names its employee. Nothing to do.');
        return;
    }

    if (dryRun) {
        console.log(`[sync-time-entry-employee] --dry-run: would stamp ${count} hour log(s). No changes made.`);
        return;
    }

    const updated = await prisma.$executeRawUnsafe(STAMP_SQL);
    console.log(`[sync-time-entry-employee] Stamped ${updated} hour log(s) with their employee.`);
}

main()
    .catch((error) => {
        console.error('[sync-time-entry-employee] Failed:', error);
        process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
