import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

type BackfillStats = {
    tenantId: string;
    updatedFromSource: number;
    markedCompany: number;
    skipped: number;
};

async function inferStoreIdFromVoucher(
    voucher: {
        source_module: string | null;
        source_type: string | null;
        source_id: string | null;
    },
): Promise<string | null> {
    const { source_module: module, source_type: type, source_id: sourceId } = voucher;
    if (!module || !type || !sourceId) {
        return null;
    }

    if (module === 'sales' && type === 'sale') {
        const sale = await prisma.sale.findUnique({ where: { id: sourceId }, select: { store_id: true } });
        return sale?.store_id ?? null;
    }

    if (module === 'sales' && type === 'sale_return') {
        const salesReturn = await prisma.salesReturn.findUnique({
            where: { id: sourceId },
            select: { store_id: true },
        });
        return salesReturn?.store_id ?? null;
    }

    if (module === 'purchases' && type === 'purchase') {
        const purchase = await prisma.purchase.findUnique({
            where: { id: sourceId },
            select: { store_id: true },
        });
        return purchase?.store_id ?? null;
    }

    if (module === 'purchases' && type === 'purchase_return') {
        const purchaseReturn = await prisma.purchaseReturn.findUnique({
            where: { id: sourceId },
            select: { store_id: true },
        });
        return purchaseReturn?.store_id ?? null;
    }

    if (module === 'purchase-orders' && type === 'purchase_order') {
        const purchaseOrder = await prisma.purchaseOrder.findUnique({
            where: { id: sourceId },
            select: { store_id: true },
        });
        return purchaseOrder?.store_id ?? null;
    }

    if (module === 'expenses' && type === 'expense_entry') {
        const expense = await prisma.expenseEntry.findUnique({
            where: { id: sourceId },
            select: { store_id: true },
        });
        return expense?.store_id ?? null;
    }

    if (module === 'loans' && type === 'loan') {
        const loan = await prisma.loan.findUnique({ where: { id: sourceId }, select: { store_id: true } });
        return loan?.store_id ?? null;
    }

    if (module === 'loans' && type === 'loan_payment') {
        const payment = await prisma.loanPayment.findUnique({
            where: { id: sourceId },
            select: { loan: { select: { store_id: true } } },
        });
        return payment?.loan.store_id ?? null;
    }

    if (module === 'warehouse_transfers' && type === 'transfer') {
        const transfer = await prisma.warehouseTransfer.findUnique({
            where: { id: sourceId },
            select: {
                source_store_id: true,
                sourceWarehouse: { select: { store_id: true } },
            },
        });
        return transfer?.source_store_id ?? transfer?.sourceWarehouse.store_id ?? null;
    }

    if (module === 'inventory' && type === 'stock_take_adjustment') {
        const session = await prisma.stockTakeSession.findUnique({
            where: { id: sourceId },
            select: { warehouse: { select: { store_id: true } } },
        });
        return session?.warehouse.store_id ?? null;
    }

    if (module === 'inventory' && type === 'shrinkage') {
        const shrinkage = await prisma.inventoryShrinkage.findUnique({
            where: { id: sourceId },
            select: { warehouse: { select: { store_id: true } } },
        });
        return shrinkage?.warehouse.store_id ?? null;
    }

    return null;
}

async function backfillTenant(tenantId: string, dryRun: boolean): Promise<BackfillStats> {
    const stats: BackfillStats = {
        tenantId,
        updatedFromSource: 0,
        markedCompany: 0,
        skipped: 0,
    };

    const vouchers = await prisma.voucher.findMany({
        where: { tenant_id: tenantId, store_id: null },
        select: {
            id: true,
            source_module: true,
            source_type: true,
            source_id: true,
        },
    });

    for (const voucher of vouchers) {
        const storeId = await inferStoreIdFromVoucher(voucher);

        if (storeId) {
            stats.updatedFromSource += 1;
            if (!dryRun) {
                await prisma.voucher.update({
                    where: { id: voucher.id },
                    data: {
                        store_id: storeId,
                        attribution: 'BRANCH',
                    },
                });
            }
            continue;
        }

        stats.markedCompany += 1;
        if (!dryRun) {
            await prisma.voucher.update({
                where: { id: voucher.id },
                data: {
                    store_id: null,
                    attribution: 'COMPANY',
                },
            });
        }
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

    console.log(`Backfill voucher store_id (${dryRun ? 'DRY RUN' : 'LIVE'}) — ${tenants.length} tenant(s)`);

    for (const tenant of tenants) {
        const stats = await backfillTenant(tenant.id, dryRun);
        console.log(
            `[${stats.tenantId}] from_source=${stats.updatedFromSource} company=${stats.markedCompany} skipped=${stats.skipped}`,
        );
    }
}

main()
    .catch((error) => {
        console.error(error);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });