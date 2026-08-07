/**
 * Seeds the weighted-average cost pool from movement history, and restates the
 * cost snapshotted on past sales.
 *
 * Before the pool existed, a sale recorded `unit_cost_at_sale` from the newest
 * `ProductPrice.cost` — a standard cost someone typed in. This walks each
 * product's `InventoryMovement` history in order, rebuilds the average as it
 * would have moved, writes the final pool to `ProductCost`, and rewrites every
 * historical `SaleItem.unit_cost_at_sale` to the average in force when those
 * goods actually left. Gross-profit reports are computed from that column, so
 * historical margins change — that is the point of the exercise.
 *
 * Two things the recorded history cannot be trusted on, both handled below:
 *
 *   - INITIAL_STOCK movements carry the product's *selling* price. Opening
 *     stock was stamped with `dto.price` until the pool landed, so replaying it
 *     as a cost would start every product's average at retail. The product's
 *     price-list cost is substituted where there is one; where there is not,
 *     the movement contributes quantity only.
 *   - SHRINKAGE and SALE movements also carry selling prices in places, but
 *     both are quantity-only under the costing rules, so their recorded
 *     unit_cost is ignored on replay exactly as it is in production.
 *
 * The replay uses the same `applyToPool` the live system does — there is no
 * second implementation of the averaging rules to drift out of step.
 *
 * Report-only by default. Read the summary, then re-run with --apply.
 *
 * Usage:
 *   npx tsx prisma/backfill-product-costs.ts                  # report, all tenants
 *   npx tsx prisma/backfill-product-costs.ts --tenant=<id>
 *   npx tsx prisma/backfill-product-costs.ts --apply          # write pools + restate sales
 *   npx tsx prisma/backfill-product-costs.ts --apply --no-restate   # pools only
 */
import { config } from 'dotenv';
import { resolve } from 'node:path';
config({ path: resolve(__dirname, '../../../.env') });

import { PrismaClient } from '@prisma/client';
import { applyToPool, type CostPool } from '../../../apps/backend/src/database/product-cost.utils';

const prisma = new PrismaClient();

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const RESTATE = !args.includes('--no-restate');
const TENANT_ARG = args.find((a) => a.startsWith('--tenant='))?.split('=')[1];

/** Outbound movements that correspond to a SaleItem whose cost we can restate. */
const SALE_ISSUE_TYPES = new Set(['SALE', 'SALE_EDIT']);

type Restatement = {
    saleId: string;
    productId: string;
    unitCost: number;
};

type TenantResult = {
    tenantId: string;
    tenantName: string;
    productsWithPool: number;
    productsWithoutBasis: number;
    saleLinesRestated: number;
    saleLinesStillUncosted: number;
};

async function backfillTenant(tenantId: string, tenantName: string): Promise<TenantResult> {
    // The price-list cost stands in for opening stock, which recorded a selling
    // price. Newest row per product wins; a store-specific row is no better a
    // guess than a global one here, since the pool is tenant-wide.
    const priceListCost = new Map<string, number>();
    const productPrices = await prisma.productPrice.findMany({
        where: { tenant_id: tenantId, cost: { not: null } },
        orderBy: { effective_from: 'desc' },
        select: { product_id: true, cost: true },
    });
    for (const pp of productPrices) {
        if (!priceListCost.has(pp.product_id)) {
            priceListCost.set(pp.product_id, Number(pp.cost));
        }
    }

    const movements = await prisma.inventoryMovement.findMany({
        where: { tenant_id: tenantId },
        // id breaks ties: several movements of one sale share a timestamp to
        // the millisecond, and an unstable order would replay them differently
        // on every run.
        orderBy: [{ product_id: 'asc' }, { created_at: 'asc' }, { id: 'asc' }],
        select: {
            id: true,
            product_id: true,
            movement_type: true,
            quantity_delta: true,
            unit_cost: true,
            reference_type: true,
            reference_id: true,
        },
    });

    const pools = new Map<string, CostPool>();
    // Keyed sale+product so a later edit overwrites the cost an earlier
    // movement assigned — the SaleItem rows reflect the latest edit, so the
    // last issue for that pair is the one that describes them.
    const restatements = new Map<string, Restatement>();

    for (const m of movements) {
        const pool = pools.get(m.product_id) ?? { avgCost: null, qtyOnHand: 0 };

        let unitCost: number | null = m.unit_cost === null ? null : Number(m.unit_cost);
        if (m.movement_type === 'INITIAL_STOCK') {
            // Recorded value is a selling price. Prefer the price-list cost;
            // with neither, let the movement pass as quantity-only rather than
            // seed the pool with retail.
            unitCost = priceListCost.get(m.product_id) ?? null;
        }

        const outcome = applyToPool(pool, {
            quantityDelta: m.quantity_delta,
            movementType: m.movement_type,
            unitCost,
        });

        if (
            RESTATE &&
            SALE_ISSUE_TYPES.has(m.movement_type) &&
            m.reference_type === 'SALE' &&
            m.reference_id &&
            outcome.movementUnitCost !== null
        ) {
            restatements.set(`${m.reference_id}:${m.product_id}`, {
                saleId: m.reference_id,
                productId: m.product_id,
                unitCost: outcome.movementUnitCost,
            });
        }

        pools.set(m.product_id, outcome.pool);
    }

    const costed = [...pools.entries()].filter(([, pool]) => pool.avgCost !== null);
    const withoutBasis = pools.size - costed.length;

    if (APPLY) {
        for (const [productId, pool] of costed) {
            await prisma.productCost.upsert({
                where: { tenant_id_product_id: { tenant_id: tenantId, product_id: productId } },
                update: { avg_cost: pool.avgCost!, qty_on_hand: pool.qtyOnHand },
                create: {
                    tenant_id: tenantId,
                    product_id: productId,
                    avg_cost: pool.avgCost!,
                    qty_on_hand: pool.qtyOnHand,
                },
            });
        }

        for (const r of restatements.values()) {
            await prisma.saleItem.updateMany({
                where: { sale_id: r.saleId, product_id: r.productId },
                data: { unit_cost_at_sale: r.unitCost },
            });
        }
    }

    // What the replay could not cost — the honest measure of how far this
    // tenant's gross-profit reports can be trusted afterwards. Counted against
    // the restatement map rather than the database so a dry run reports the
    // same number an --apply run would produce.
    const saleLines = await prisma.saleItem.findMany({
        where: { sale: { tenant_id: tenantId } },
        select: { sale_id: true, product_id: true, unit_cost_at_sale: true },
    });
    const stillUncosted = saleLines.filter((line) => {
        if (restatements.has(`${line.sale_id}:${line.product_id}`)) {
            return false;
        }
        // Untouched by the replay, so it keeps whatever it already had — which
        // for a line the old price-list lookup could not resolve is nothing.
        return line.unit_cost_at_sale === null;
    }).length;

    return {
        tenantId,
        tenantName,
        productsWithPool: costed.length,
        productsWithoutBasis: withoutBasis,
        saleLinesRestated: restatements.size,
        saleLinesStillUncosted: stillUncosted,
    };
}

async function main() {
    const tenants = await prisma.tenant.findMany({
        where: TENANT_ARG ? { id: TENANT_ARG } : {},
        select: { id: true, name: true },
        orderBy: { created_at: 'asc' },
    });

    if (tenants.length === 0) {
        console.log(TENANT_ARG ? `No tenant with id ${TENANT_ARG}.` : 'No tenants.');
        return;
    }

    console.log(
        APPLY
            ? `Rebuilding cost pools for ${tenants.length} tenant(s)${RESTATE ? ' and restating past sales' : ' (pools only)'}.`
            : `Dry run over ${tenants.length} tenant(s). Re-run with --apply to write.`,
    );
    console.log('');

    const results: TenantResult[] = [];
    for (const tenant of tenants) {
        results.push(await backfillTenant(tenant.id, tenant.name));
    }

    for (const r of results) {
        console.log(`${r.tenantName} (${r.tenantId})`);
        console.log(`  products with a cost pool : ${r.productsWithPool}`);
        console.log(`  products with no basis    : ${r.productsWithoutBasis}`);
        console.log(`  sale lines restated       : ${r.saleLinesRestated}`);
        console.log(`  sale lines left uncosted  : ${r.saleLinesStillUncosted}`);
        console.log('');
    }

    const totals = results.reduce(
        (acc, r) => ({
            pools: acc.pools + r.productsWithPool,
            noBasis: acc.noBasis + r.productsWithoutBasis,
            restated: acc.restated + r.saleLinesRestated,
        }),
        { pools: 0, noBasis: 0, restated: 0 },
    );
    console.log(
        `Total: ${totals.pools} pools, ${totals.noBasis} products without a basis, ${totals.restated} sale lines restated.`,
    );
    if (!APPLY) {
        console.log('Nothing was written — this was a dry run.');
    }
}

main()
    .catch((err) => {
        console.error(err);
        process.exit(1);
    })
    .finally(() => prisma.$disconnect());
