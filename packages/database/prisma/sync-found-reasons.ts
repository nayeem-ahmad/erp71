/**
 * Gives every tenant that predates the FOUND direction its FOUND reason
 * catalogue.
 *
 * Why this exists
 * ---------------
 * PR #656 gave `InventoryShrinkage` a `direction`, so a count that comes out
 * *over* the book can be recorded instead of leaving the book wrong. The entry
 * screen filters reasons by type and the service refuses an entry whose reason
 * is not an active FOUND reason — so a tenant with no FOUND rows opens the
 * picker to an empty list and cannot file a surplus at all.
 *
 * The four defaults were seeded two ways, and neither reaches an existing
 * tenant in production:
 *
 *   - `prisma/seed.ts` runs only when a tenant is created.
 *   - The INSERT at the bottom of
 *     `migrations/20260916160000_inventory_found_stock/migration.sql` would
 *     cover them, but production reconciles schema with `prisma db push`
 *     (see apps/backend/Dockerfile), which applies the schema and never runs
 *     migration files. Its DDL is written `IF NOT EXISTS` for exactly that
 *     reason; the INSERT is data, and `db push` does not carry data.
 *
 * So the column and its index arrived with the release and the catalogue did
 * not. This script is that missing half — the same role `sync-accounting.ts`
 * plays for the chart of accounts and `sync-lead-taxonomy.ts` for the CRM
 * lookups.
 *
 * Only ever fills an empty catalogue
 * ----------------------------------
 * A tenant is touched only when it has ZERO FOUND reasons. That is deliberate,
 * and it is what makes this safe to run on every boot:
 *
 *   - A tenant that predates the feature has none, and gets all four.
 *   - A tenant that already has them — seeded at creation, or filled in by an
 *     earlier run of this script — is skipped whole. Nothing is relabelled,
 *     reordered, or reactivated, so a reason somebody deliberately switched off
 *     stays off.
 *
 * The defaults are `is_system`, which is what stops the settings screen
 * offering to delete them; they can only be deactivated, and a deactivated row
 * still counts. So "zero FOUND rows" means "never had them", not "cleared them
 * on purpose", and this cannot resurrect a deliberate removal.
 *
 * It runs inside the `&&` chain in apps/backend/Dockerfile, so a throw here
 * means the backend never boots. It is additive-only, idempotent, and a no-op
 * on a database that has no tenants yet.
 *
 * Usage:
 *   npx tsx prisma/sync-found-reasons.ts --dry-run
 *   npx tsx prisma/sync-found-reasons.ts --tenant=<uuid>
 *   npx tsx prisma/sync-found-reasons.ts
 */
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(__dirname, '../../../.env') });

import { PrismaClient } from '@prisma/client';
import { DEFAULT_FOUND_REASONS } from './inventory-reasons.seed';

const prisma = new PrismaClient();

export const FOUND_REASON_TYPE = 'FOUND';

export interface TenantResult {
    tenantId: string;
    tenantName: string;
    /** FOUND reasons created for this tenant. Only ever 0 or the full set. */
    created: number;
}

/**
 * Creates the default FOUND catalogue for every tenant that has none.
 *
 * Exported so it can be driven against a stand-in client in a test; the CLI
 * below is the only thing that hands it a live `PrismaClient`. Returns one
 * entry per tenant actually changed, so the caller reports nothing for a
 * database that is already correct.
 */
export async function syncFoundReasons(
    prisma: any,
    options: { dryRun?: boolean; tenantId?: string } = {},
): Promise<TenantResult[]> {
    const dryRun = options.dryRun ?? false;

    const tenants = await prisma.tenant.findMany({
        where: options.tenantId ? { id: options.tenantId } : undefined,
        select: { id: true, name: true },
        orderBy: { created_at: 'asc' },
    });

    const changed: TenantResult[] = [];

    for (const tenant of tenants) {
        // Any FOUND row at all — active or not — means this tenant has been
        // through seeding already. Leave it entirely alone.
        const existing = await prisma.inventoryReason.count({
            where: { tenant_id: tenant.id, type: FOUND_REASON_TYPE },
        });
        if (existing > 0) continue;

        if (!dryRun) {
            // skipDuplicates rather than a bare createMany: two containers can
            // start at once behind the same database, and the unique key is
            // (tenant_id, type, code). Losing that race must not stop a boot.
            await prisma.inventoryReason.createMany({
                data: DEFAULT_FOUND_REASONS.map((reason, index) => ({
                    tenant_id: tenant.id,
                    type: FOUND_REASON_TYPE,
                    code: reason.code,
                    label: reason.label,
                    is_system: true,
                    is_active: true,
                    display_order: index,
                })),
                skipDuplicates: true,
            });
        }

        changed.push({
            tenantId: tenant.id,
            tenantName: tenant.name,
            created: DEFAULT_FOUND_REASONS.length,
        });
    }

    return changed;
}

async function main() {
    const dryRun = process.argv.includes('--dry-run');
    const tenantId = process.argv.find((arg) => arg.startsWith('--tenant='))?.split('=')[1];

    const changed = await syncFoundReasons(prisma, { dryRun, tenantId });

    for (const result of changed) {
        console.log(
            `  ${result.tenantName} (${result.tenantId}): ` +
            `${dryRun ? 'would add' : 'added'} ${result.created} FOUND reason(s)`,
        );
    }

    const total = changed.reduce((sum, result) => sum + result.created, 0);
    console.log(
        `${dryRun ? 'Would sync' : 'Synced'} ${changed.length} tenant(s): ${total} FOUND reason(s).` +
        (tenantId ? ` (filtered to ${tenantId})` : ''),
    );

    if (dryRun) {
        console.log('DRY RUN — nothing was written. Re-run without --dry-run to apply.');
    }
}

// Only run when invoked directly, so importing the reconciler from a test or
// another script does not fire a live sync.
if (require.main === module) {
    main()
        .catch((error) => {
            console.error(error);
            process.exit(1);
        })
        .finally(() => prisma.$disconnect());
}
