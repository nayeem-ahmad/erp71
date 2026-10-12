/**
 * Sets stock back to what its movements add up to (see
 * fix-stock-from-movements.utils.ts).
 *
 * Until 2026-10-11, "Clear transactions" deleted stock movements but left
 * `ProductStock.quantity` and the cost pool's `qty_on_hand` standing, so a
 * tenant that cleared and re-imported had every imported document counted
 * twice. The clears now unwind what they delete; this repairs tenants cleared
 * before that.
 *
 *   ProductStock.quantity      → the sum of the movements in that warehouse
 *   ProductCost.qty_on_hand    → the product's movements across every warehouse
 *
 * Stock with no movement behind it at all is listed and left alone: it may be a
 * quantity entered without a movement. --include-unmoved sets it to 0 as well.
 *
 * One-off, never part of db-prepare. Lists what it would change unless given
 * --apply, which needs --tenant; each tenant's repair is one transaction. Take
 * a backup first (scripts/vps-backup.sh).
 *
 * Usage, inside the backend container on the VPS:
 *   npm run fix:stock-from-movements --workspace=@erp71/database                                 # every tenant, list only
 *   npm run fix:stock-from-movements --workspace=@erp71/database -- --tenant=<uuid>              # one tenant, list only
 *   npm run fix:stock-from-movements --workspace=@erp71/database -- --tenant=<uuid> --apply
 */

import { PrismaClient } from '@prisma/client';
import { StockPlan, planStockRepairs } from './fix-stock-from-movements.utils';

const prisma = new PrismaClient();

async function planTenant(tenantId: string, includeUnmoved: boolean): Promise<StockPlan> {
    const [stocks, sums, pools] = await Promise.all([
        prisma.productStock.findMany({
            where: { tenant_id: tenantId },
            select: { product_id: true, warehouse_id: true, quantity: true },
        }),
        prisma.inventoryMovement.groupBy({
            by: ['product_id', 'warehouse_id'],
            where: { tenant_id: tenantId },
            _sum: { quantity_delta: true },
        }),
        prisma.productCost.findMany({ where: { tenant_id: tenantId }, select: { product_id: true, qty_on_hand: true } }),
    ]);
    return planStockRepairs(
        stocks.map((s) => ({ productId: s.product_id, warehouseId: s.warehouse_id, quantity: s.quantity })),
        sums.map((s) => ({ productId: s.product_id, warehouseId: s.warehouse_id, sum: s._sum.quantity_delta ?? 0 })),
        pools.map((p) => ({ productId: p.product_id, qtyOnHand: p.qty_on_hand })),
        { includeUnmoved },
    );
}

async function report(tenant: { id: string; name: string }, plan: StockPlan) {
    const productIds = [...new Set([...plan.stock, ...plan.pools, ...plan.unmoved].map((r) => r.productId))];
    const warehouseIds = [...new Set([...plan.stock, ...plan.unmoved].map((r) => r.warehouseId))];
    const [products, warehouses] = await Promise.all([
        prisma.product.findMany({ where: { id: { in: productIds } }, select: { id: true, sku: true, name: true } }),
        prisma.warehouse.findMany({ where: { id: { in: warehouseIds } }, select: { id: true, name: true } }),
    ]);
    const product = new Map(products.map((p) => [p.id, `${p.sku ?? '-'}  ${p.name}`]));
    const warehouse = new Map(warehouses.map((w) => [w.id, w.name]));

    console.log(`\n${tenant.name} (${tenant.id})`);
    if (plan.stock.length) {
        console.log(`  Stock that does not match its movements (${plan.stock.length})`);
        for (const r of plan.stock) {
            console.log(`    ${product.get(r.productId)}  @ ${warehouse.get(r.warehouseId)}:  ${r.from ?? '(none)'}  →  ${r.to}`);
        }
    }
    if (plan.pools.length) {
        console.log(`  Cost-pool counts that do not match (${plan.pools.length})`);
        for (const r of plan.pools) console.log(`    ${product.get(r.productId)}:  ${r.from}  →  ${r.to}`);
    }
    if (plan.unmoved.length) {
        console.log(`  Stock with no movement behind it, left as it is (${plan.unmoved.length}; --include-unmoved sets it to 0)`);
        for (const r of plan.unmoved) console.log(`    ${product.get(r.productId)}  @ ${warehouse.get(r.warehouseId)}:  ${r.quantity}`);
    }
}

async function apply(tenantId: string, plan: StockPlan) {
    await prisma.$transaction([
        ...plan.stock.map((r) =>
            prisma.productStock.upsert({
                where: { tenant_id_product_id_warehouse_id: { tenant_id: tenantId, product_id: r.productId, warehouse_id: r.warehouseId } },
                update: { quantity: r.to },
                create: { tenant_id: tenantId, product_id: r.productId, warehouse_id: r.warehouseId, quantity: r.to },
            }),
        ),
        ...plan.pools.map((r) =>
            prisma.productCost.update({
                where: { tenant_id_product_id: { tenant_id: tenantId, product_id: r.productId } },
                data: { qty_on_hand: r.to },
            }),
        ),
    ]);
}

async function main() {
    const write = process.argv.includes('--apply');
    const includeUnmoved = process.argv.includes('--include-unmoved');
    const tenantArg = process.argv.find((a) => a.startsWith('--tenant='))?.slice('--tenant='.length);
    if (write && !tenantArg) throw new Error('--apply needs --tenant=<uuid>: list every tenant first, then repair one at a time.');

    const tenants = await prisma.tenant.findMany({
        where: tenantArg ? { id: tenantArg } : { productStocks: { some: {} } },
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
    });
    if (tenantArg && tenants.length === 0) throw new Error(`No tenant ${tenantArg}`);

    let total = 0;
    for (const tenant of tenants) {
        const plan = await planTenant(tenant.id, includeUnmoved);
        const count = plan.stock.length + plan.pools.length;
        if (count === 0 && plan.unmoved.length === 0) continue;
        await report(tenant, plan);
        total += count;
        if (write && count > 0) {
            await apply(tenant.id, plan);
            console.log('  applied');
        }
    }

    console.log(
        total === 0
            ? '\n[fix-stock-from-movements] Every stock total matches its movements.'
            : write
              ? `\n[fix-stock-from-movements] Repaired ${total} total(s).`
              : `\n[fix-stock-from-movements] ${total} total(s) would be repaired. Nothing written: add --tenant=<uuid> --apply.`,
    );
}

main()
    .catch((error) => {
        console.error('[fix-stock-from-movements] Failed:', error);
        process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
