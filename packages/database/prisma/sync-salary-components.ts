/**
 * Seeds every tenant's salary components (HRIS Phase 5).
 *
 * Why this is not a migration
 * ---------------------------
 * Same reason as `sync-work-schedules.ts`: production applies its schema with
 * `prisma db push` and runs no migration files, so a data migration reaches
 * nobody. See that file's header for the full history.
 *
 * Why it does NOT backfill per-employee structures
 * ------------------------------------------------
 * The obvious next step — turn every `Employee.basic_salary` into a one-line
 * structure — is deliberately **not** done here, and that is the interesting
 * decision in this file.
 *
 * `SalaryStructuresService.resolveStructure` already falls back to
 * `basic_salary` when an employee has no structure, so the backfill would buy
 * nothing at read time. What it would cost is real: it would stamp a structure
 * with an `effective_from` that the tenant never chose, and from then on
 * editing `basic_salary` on the employee form would silently stop affecting
 * pay, because a structure now exists and wins. A tenant that has not adopted
 * salary structures would have had them adopted on their behalf by a deploy.
 *
 * So the rule is: components are seeded (they are a blank-screen problem),
 * structures are opt-in (they are a policy).
 *
 * Idempotency
 * -----------
 * A tenant with any component at all is skipped — including one that
 * deliberately deleted the seeded set down to none of the defaults. Re-adding
 * them on every deploy would be worse than leaving a tenant with a list they
 * curated.
 *
 * Usage:
 *   npx tsx prisma/sync-salary-components.ts --dry-run
 *   npx tsx prisma/sync-salary-components.ts
 */
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(__dirname, '../../../.env') });

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/**
 * The standard Bangladeshi private-sector split. These percentages are a
 * convention, not a legal requirement — a tenant is expected to edit them.
 * Kept in step with `DEFAULT_COMPONENTS` in the backend's
 * `payroll/salary-structure.util.ts`; the duplication is deliberate, because
 * this script must not import from the backend build.
 */
export const DEFAULT_COMPONENTS = [
    { name: 'Basic', kind: 'EARNING', calculation: 'FIXED', is_basic: true, is_taxable: true, sort_order: 0 },
    { name: 'House Rent', kind: 'EARNING', calculation: 'PERCENT_OF_BASIC', is_basic: false, is_taxable: true, sort_order: 1 },
    { name: 'Medical Allowance', kind: 'EARNING', calculation: 'PERCENT_OF_BASIC', is_basic: false, is_taxable: true, sort_order: 2 },
    { name: 'Conveyance', kind: 'EARNING', calculation: 'FIXED', is_basic: false, is_taxable: true, sort_order: 3 },
    { name: 'Provident Fund', kind: 'DEDUCTION', calculation: 'PERCENT_OF_BASIC', is_basic: false, is_taxable: false, sort_order: 10 },
];

export interface SyncResult {
    tenantsScanned: number;
    tenantsSeeded: number;
    tenantsAlreadyConfigured: number;
    componentsCreated: number;
}

export async function syncSalaryComponents(
    db: any,
    options: { dryRun?: boolean } = {},
): Promise<SyncResult> {
    const dryRun = options.dryRun ?? false;
    const result: SyncResult = {
        tenantsScanned: 0,
        tenantsSeeded: 0,
        tenantsAlreadyConfigured: 0,
        componentsCreated: 0,
    };

    const tenants = await db.tenant.findMany({
        where: { deleted_at: null },
        select: { id: true },
    });
    result.tenantsScanned = tenants.length;

    for (const tenant of tenants) {
        const existing = await db.salaryComponent.count({
            where: { tenant_id: tenant.id, deleted_at: null },
        });
        if (existing > 0) {
            result.tenantsAlreadyConfigured += 1;
            continue;
        }

        result.tenantsSeeded += 1;
        result.componentsCreated += DEFAULT_COMPONENTS.length;
        if (dryRun) continue;

        await db.salaryComponent.createMany({
            data: DEFAULT_COMPONENTS.map((component) => ({ tenant_id: tenant.id, ...component })),
            skipDuplicates: true,
        });
    }

    return result;
}

async function main() {
    const dryRun = process.argv.includes('--dry-run');
    console.log(`Sync salary components (${dryRun ? 'DRY RUN' : 'LIVE'})`);

    const result = await syncSalaryComponents(prisma, { dryRun });

    console.log(
        `  ${result.tenantsScanned} tenant(s) scanned: ` +
        `${dryRun ? 'would seed' : 'seeded'} ${result.tenantsSeeded} ` +
        `(${result.componentsCreated} component rows), ` +
        `${result.tenantsAlreadyConfigured} already configured.`,
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
