/**
 * Fills missing Product Lost / stock-take reason catalogues, and labels blank
 * custom rows so the entry picker is not an empty option.
 *
 * Why this exists
 * ---------------
 * `sync-found-reasons.ts` already carries the FOUND catalogue to tenants that
 * predate it — but only when the tenant has *zero* FOUND rows. Product Lost
 * (type SHRINKAGE) never got that treatment. Tenants created outside `seed.ts`,
 * or that saved a blank custom reason from the settings form (code and label
 * were not required), open Stock Discrepancy to a picker of empty options:
 * the entry screen filters `type === 'SHRINKAGE'` and the only rows they have
 * have no label. KH Trading on production is the case that surfaced it: two
 * SHRINKAGE rows, both blank, 29 LOSS documents behind them, and none of
 * Theft / Damage / Expiration / Unknown Loss.
 *
 * Unlike FOUND, this script is additive per *code*. A tenant that already has
 * a blank custom row still receives the four defaults; skipDuplicates on
 * `(tenant_id, type, code)` is what makes a second run a no-op. Existing
 * labels are never rewritten except when they are blank or whitespace, in
 * which case the code becomes the label, or `Unspecified` when the code is
 * blank too — so a used empty row still has something the picker can show
 * without inventing a new code that would collide with UNKNOWN.
 *
 * Usage:
 *   npx tsx prisma/sync-inventory-reasons.ts --dry-run
 *   npx tsx prisma/sync-inventory-reasons.ts --tenant=<uuid>
 *   npx tsx prisma/sync-inventory-reasons.ts
 */
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(__dirname, '../../../.env') });

import { PrismaClient } from '@prisma/client';
import {
    DEFAULT_DISCREPANCY_REASONS,
    DEFAULT_SHRINKAGE_REASONS,
} from './inventory-reasons.seed';

const prisma = new PrismaClient();

export const SHRINKAGE_REASON_TYPE = 'SHRINKAGE';
export const DISCREPANCY_REASON_TYPE = 'DISCREPANCY';

export interface TenantResult {
    tenantId: string;
    tenantName: string;
    createdShrinkage: number;
    createdDiscrepancy: number;
    relabelled: number;
}

function fallbackLabel(code: string, label: string): string | null {
    if (String(label ?? '').trim()) return null;
    const trimmedCode = String(code ?? '').trim();
    return trimmedCode || 'Unspecified';
}

/**
 * Creates missing default Product Lost / stock-take reasons and labels blank
 * rows. Exported so a test can drive it against a stand-in client.
 */
export async function syncInventoryReasons(
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
        const existing = await prisma.inventoryReason.findMany({
            where: { tenant_id: tenant.id },
            select: { id: true, type: true, code: true, label: true },
        });

        const shrinkageData = DEFAULT_SHRINKAGE_REASONS.map((reason, index) => ({
            tenant_id: tenant.id,
            type: SHRINKAGE_REASON_TYPE,
            code: reason.code,
            label: reason.label,
            is_system: true,
            is_active: true,
            display_order: index,
        }));
        const discrepancyData = DEFAULT_DISCREPANCY_REASONS.map((reason, index) => ({
            tenant_id: tenant.id,
            type: DISCREPANCY_REASON_TYPE,
            code: reason.code,
            label: reason.label,
            is_system: true,
            is_active: true,
            display_order: index,
        }));

        const hasCode = (type: string, code: string) =>
            existing.some((row: { type: string; code: string }) => row.type === type && row.code === code);

        const missingShrinkage = shrinkageData.filter((row) => !hasCode(row.type, row.code));
        const missingDiscrepancy = discrepancyData.filter((row) => !hasCode(row.type, row.code));
        const blank = existing.filter(
            (row: { code: string; label: string }) => fallbackLabel(row.code, row.label) !== null,
        );

        if (missingShrinkage.length === 0 && missingDiscrepancy.length === 0 && blank.length === 0) {
            continue;
        }

        if (!dryRun) {
            if (missingShrinkage.length > 0 || missingDiscrepancy.length > 0) {
                await prisma.inventoryReason.createMany({
                    data: [...missingShrinkage, ...missingDiscrepancy],
                    skipDuplicates: true,
                });
            }
            for (const row of blank) {
                const label = fallbackLabel(row.code, row.label);
                if (!label) continue;
                await prisma.inventoryReason.update({
                    where: { id: row.id },
                    data: { label },
                });
            }
        }

        changed.push({
            tenantId: tenant.id,
            tenantName: tenant.name,
            createdShrinkage: missingShrinkage.length,
            createdDiscrepancy: missingDiscrepancy.length,
            relabelled: blank.length,
        });
    }

    return changed;
}

async function main() {
    const dryRun = process.argv.includes('--dry-run');
    const tenantId = process.argv.find((arg) => arg.startsWith('--tenant='))?.split('=')[1];

    const changed = await syncInventoryReasons(prisma, { dryRun, tenantId });

    for (const result of changed) {
        console.log(
            `  ${result.tenantName} (${result.tenantId}): ` +
            `${dryRun ? 'would add' : 'added'} ${result.createdShrinkage} Product Lost, ` +
            `${result.createdDiscrepancy} stock-take reason(s); ` +
            `${dryRun ? 'would label' : 'labelled'} ${result.relabelled} blank row(s)`,
        );
    }

    console.log(
        `${dryRun ? 'Would sync' : 'Synced'} ${changed.length} tenant(s).` +
        (tenantId ? ` (filtered to ${tenantId})` : ''),
    );

    if (dryRun) {
        console.log('DRY RUN — nothing was written. Re-run without --dry-run to apply.');
    }
}

if (require.main === module) {
    main()
        .catch((error) => {
            console.error(error);
            process.exit(1);
        })
        .finally(() => prisma.$disconnect());
}
