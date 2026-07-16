/**
 * Repairs tenants created before the posting-rule correction.
 *
 * Three jobs, per tenant:
 *   1. Re-run the accounting bootstrap, adding the accounts and rules that did not
 *      exist when the tenant was created (notably Accounts Receivable, without
 *      which every customer payment silently posted nothing).
 *   2. Delete the harmful condition_key:'none' fallback rules. The bootstrap only
 *      ever upserts, so removing them from DEFAULT_POSTING_RULES does not remove
 *      them from tenants that already have them.
 *   3. Delete the vouchers those fallbacks fabricated.
 *
 * On (3): a voucher is only deleted when its source_type matches AND its two
 * detail lines point at exactly the fallback rule's account pair. PostingRule is
 * tenant-configurable, so a tenant may have deliberately configured correct
 * transfer postings - matching on source_type alone would destroy them.
 *
 * Writes via raw Prisma, below the fiscal-period lock guard. Deliberate: locked
 * periods must not block removal of entries that should never have existed.
 *
 * Usage:
 *   npx tsx prisma/repair-fabricated-vouchers.ts --dry-run
 *   npx tsx prisma/repair-fabricated-vouchers.ts --tenant=<uuid>
 *   npx tsx prisma/repair-fabricated-vouchers.ts
 */
import { PrismaClient } from '@prisma/client';
import { bootstrapDefaultAccountingForTenant } from './bootstrap-accounting';
import {
    isFabricatedVoucher,
    FABRICATED_SOURCE_TYPES,
    FALLBACK_FINGERPRINTS,
} from './repair-fabricated-vouchers.utils';

const prisma = new PrismaClient();

type RepairStats = {
    tenantId: string;
    rulesDeleted: number;
    vouchersDeleted: number;
    vouchersPreserved: number;
};

async function repairTenant(tenantId: string, dryRun: boolean): Promise<RepairStats> {
    const stats: RepairStats = { tenantId, rulesDeleted: 0, vouchersDeleted: 0, vouchersPreserved: 0 };

    // 1. Bring the tenant's accounts and rules up to date.
    if (!dryRun) {
        await bootstrapDefaultAccountingForTenant(prisma, tenantId);
    }

    // 2. Remove the harmful none-fallbacks.
    const harmfulRules = await prisma.postingRule.findMany({
        where: {
            tenant_id: tenantId,
            event_type: { in: ['fund_movement', 'inventory_adjustment'] },
            condition_key: 'none',
        },
        select: { id: true },
    });
    stats.rulesDeleted = harmfulRules.length;
    if (!dryRun && harmfulRules.length > 0) {
        await prisma.postingRule.deleteMany({ where: { id: { in: harmfulRules.map((r) => r.id) } } });
    }

    // 3. Delete the vouchers they fabricated.
    const accounts = await prisma.account.findMany({
        where: { tenant_id: tenantId },
        select: { id: true, name: true },
    });
    const nameById = new Map(accounts.map((a) => [a.id, a.name]));

    const candidates = await prisma.voucher.findMany({
        where: { tenant_id: tenantId, source_type: { in: Object.keys(FABRICATED_SOURCE_TYPES) } },
        include: { details: { select: { account_id: true, debit_amount: true, credit_amount: true } } },
    });

    for (const voucher of candidates) {
        if (!isFabricatedVoucher(voucher, nameById)) {
            stats.vouchersPreserved++;
            continue;
        }

        const eventType = FABRICATED_SOURCE_TYPES[voucher.source_type!];
        const fingerprint = FALLBACK_FINGERPRINTS[eventType];
        const debitLine = voucher.details.find((d) => Number(d.debit_amount) > 0)!;

        stats.vouchersDeleted++;
        if (dryRun) continue;

        await prisma.$transaction(async (tx) => {
            await tx.auditLog.create({
                data: {
                    tenant_id: tenantId,
                    action: 'accounting.voucher.repair_delete',
                    entity: 'Voucher',
                    entity_id: voucher.id,
                    payload: {
                        reason: 'Fabricated by the condition_key:none posting fallback; the underlying event moved no money.',
                        voucher_number: voucher.voucher_number,
                        voucher_type: voucher.voucher_type,
                        date: voucher.date.toISOString(),
                        source_type: voucher.source_type,
                        source_id: voucher.source_id,
                        debit_account: fingerprint.debit,
                        credit_account: fingerprint.credit,
                        amount: String(debitLine.debit_amount),
                    },
                },
            });

            await tx.postingEvent.deleteMany({
                where: { tenant_id: tenantId, event_type: eventType, source_id: voucher.source_id ?? undefined },
            });
            await tx.voucherDetail.deleteMany({ where: { voucher_id: voucher.id } });
            await tx.voucher.delete({ where: { id: voucher.id } });
        });
    }

    return stats;
}

async function main() {
    const dryRun = process.argv.includes('--dry-run');
    const tenantArg = process.argv.find((arg) => arg.startsWith('--tenant='));
    const tenantId = tenantArg?.split('=')[1];

    const tenants = tenantId
        ? [{ id: tenantId }]
        : await prisma.tenant.findMany({ select: { id: true } });

    console.log(`Repair fabricated vouchers (${dryRun ? 'DRY RUN' : 'LIVE'}) — ${tenants.length} tenant(s)`);

    let totalDeleted = 0;
    let totalPreserved = 0;
    let totalRules = 0;

    for (const tenant of tenants) {
        const stats = await repairTenant(tenant.id, dryRun);
        totalDeleted += stats.vouchersDeleted;
        totalPreserved += stats.vouchersPreserved;
        totalRules += stats.rulesDeleted;

        if (stats.vouchersDeleted || stats.vouchersPreserved || stats.rulesDeleted) {
            console.log(
                `  ${stats.tenantId}: ${stats.vouchersDeleted} voucher(s) deleted, ` +
                `${stats.vouchersPreserved} preserved, ${stats.rulesDeleted} harmful rule(s) removed`,
            );
        }
    }

    console.log(`\nTotal: ${totalDeleted} deleted, ${totalPreserved} preserved, ${totalRules} rules removed`);
    if (dryRun) {
        console.log('DRY RUN — nothing was written. Re-run without --dry-run to apply.');
    }
}

main()
    .catch((error) => {
        console.error(error);
        process.exit(1);
    })
    .finally(() => prisma.$disconnect());
