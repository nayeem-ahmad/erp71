import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { DatabaseService } from '../database/database.service';
import { isCostingMethod, recordCostAdjustment, type CostingMethod } from '../database/product-cost.utils';
import { paginate } from '../common/pagination.dto';
import { ACTIVE_PURCHASE } from '../purchases/purchase-status';
import { CreateCostAdjustmentsDto, ListCostAdjustmentsDto, ListProductCostsDto } from './product-costs.dto';

/** Where a product's cost comes from — the same three values Stock on Hand reports. */
export type CostBasis = 'WEIGHTED_AVERAGE' | 'LATEST_COST' | 'UNCOSTED';

/**
 * What every stock-carrying product costs, and the one place to state it by hand.
 *
 * Products end up with no cost basis in ordinary ways — opening stock entered
 * without a cost, stock brought in by an import or a count, goods bought before
 * the system — and sell at an unknown COGS until someone says what they cost.
 * This lists them and records the answer through `recordCostAdjustment`, which
 * keeps the pool and its audit row in step.
 */
@Injectable()
export class ProductCostsService {
    constructor(private readonly db: DatabaseService) {}

    async list(tenantId: string, query: ListProductCostsDto) {
        const page = query.page ?? 1;
        const limit = Math.min(query.limit ?? 50, 100);
        const where = this.buildWhere(tenantId, query);

        const [products, total, costingMethod, summary] = await Promise.all([
            this.db.product.findMany({
                where,
                select: {
                    id: true,
                    name: true,
                    sku: true,
                    unit_type: true,
                    price: true,
                    group: { select: { id: true, name: true } },
                    cost: { select: { avg_cost: true, updated_at: true } },
                    stocks: { select: { quantity: true } },
                },
                orderBy: { name: 'asc' },
                skip: (page - 1) * limit,
                take: limit,
            }),
            this.db.product.count({ where }),
            this.costingMethod(tenantId),
            this.summary(tenantId),
        ]);

        const ids = products.map((product) => product.id);
        const [priceListCosts, lastPurchases] = await Promise.all([
            this.priceListCosts(tenantId, ids),
            this.lastPurchaseCosts(tenantId, ids),
        ]);

        const rows = products.map((product) => {
            const onHand = product.stocks.reduce((sum, stock) => sum + stock.quantity, 0);
            const averageCost = product.cost ? Number(product.cost.avg_cost) : null;
            const priceListCost = priceListCosts.get(product.id) ?? null;
            // The cost a sale of this product would be snapshotted at today —
            // the same precedence `resolveProductCosts` applies.
            const [primary, fallback] =
                costingMethod === 'LATEST_COST'
                    ? [{ value: priceListCost, basis: 'LATEST_COST' as const }, { value: averageCost, basis: 'WEIGHTED_AVERAGE' as const }]
                    : [{ value: averageCost, basis: 'WEIGHTED_AVERAGE' as const }, { value: priceListCost, basis: 'LATEST_COST' as const }];
            const chosen = primary.value !== null ? primary : fallback.value !== null ? fallback : null;
            const lastPurchase = lastPurchases.get(product.id) ?? null;

            return {
                product: {
                    id: product.id,
                    name: product.name,
                    sku: product.sku,
                    unitType: product.unit_type,
                    sellingPrice: Number(product.price ?? 0),
                    group: product.group,
                },
                onHand,
                averageCost,
                priceListCost,
                effectiveCost: chosen?.value ?? null,
                costBasis: (chosen?.basis ?? 'UNCOSTED') as CostBasis,
                // Null rather than zero for uncosted stock: "worth nothing" and
                // "we do not know" must not add up to the same total.
                stockValue: chosen ? onHand * chosen.value! : null,
                lastPurchaseCost: lastPurchase?.unitCost ?? null,
                lastPurchaseAt: lastPurchase?.at ?? null,
                costUpdatedAt: product.cost?.updated_at ?? null,
            };
        });

        // Pagination nested rather than spread: TransformInterceptor rewrites any
        // top-level `{ items, total, page, limit, pages }` into `{ data, meta }`
        // and drops every other key, which would take the summary with it.
        const { items, ...pagination } = paginate(rows, total, page, limit);
        return { items, pagination, costingMethod, summary };
    }

    async adjust(tenantId: string, userId: string, dto: CreateCostAdjustmentsDto) {
        const seen = new Set<string>();
        for (const item of dto.items) {
            if (seen.has(item.productId)) {
                // The second line would see the first one's cost as the basis on
                // file and need a reason of its own — two answers to one question.
                throw new BadRequestException('Each product can appear only once in a batch.');
            }
            seen.add(item.productId);
        }

        const adjustments = await this.db.$transaction(
            async (tx) => {
                const rows = [];
                for (const item of dto.items) {
                    rows.push(
                        await recordCostAdjustment(tx, {
                            tenantId,
                            productId: item.productId,
                            newCost: item.unitCost,
                            reason: dto.reason,
                            note: dto.note,
                            userId,
                        }),
                    );
                }
                return rows;
            },
            // A full batch is a few hundred statements; the default 5s is sized
            // for a single document.
            { timeout: 30_000 },
        );

        return { adjusted: adjustments.length, adjustments };
    }

    async history(tenantId: string, query: ListCostAdjustmentsDto) {
        const page = query.page ?? 1;
        const limit = Math.min(query.limit ?? 20, 100);
        const where: Prisma.ProductCostAdjustmentWhereInput = {
            tenant_id: tenantId,
            ...(query.productId ? { product_id: query.productId } : {}),
        };

        const [rows, total] = await Promise.all([
            this.db.productCostAdjustment.findMany({
                where,
                include: {
                    product: { select: { id: true, name: true, sku: true } },
                    creator: { select: { id: true, name: true, email: true } },
                },
                orderBy: { created_at: 'desc' },
                skip: (page - 1) * limit,
                take: limit,
            }),
            this.db.productCostAdjustment.count({ where }),
        ]);

        const items = rows.map((row) => {
            const previousCost = row.previous_cost === null ? null : Number(row.previous_cost);
            const newCost = Number(row.new_cost);
            return {
                id: row.id,
                product: row.product,
                reason: row.reason,
                previousCost,
                newCost,
                qtyOnHand: row.qty_on_hand,
                // What the stated cost moved the stock on hand by. Null for an
                // opening cost: there was no value before to move from.
                valueChange: previousCost === null ? null : round2((newCost - previousCost) * row.qty_on_hand),
                note: row.note,
                createdBy: row.creator ? { id: row.creator.id, name: row.creator.name ?? row.creator.email } : null,
                createdAt: row.created_at,
            };
        });

        return paginate(items, total, page, limit);
    }

    private buildWhere(tenantId: string, query: ListProductCostsDto): Prisma.ProductWhereInput {
        const and: Prisma.ProductWhereInput[] = [];
        const search = query.search?.trim();
        if (search) {
            and.push({
                OR: [
                    { name: { contains: search, mode: 'insensitive' } },
                    { sku: { contains: search, mode: 'insensitive' } },
                ],
            });
        }
        // "Has a basis" is the same test under either costing method, since
        // each falls back to the other: a pool row, or a price-list cost.
        if (query.status === 'UNCOSTED') {
            and.push({ cost: { is: null } }, { prices: { none: { cost: { not: null } } } });
        } else if (query.status === 'COSTED') {
            and.push({ OR: [{ cost: { isNot: null } }, { prices: { some: { cost: { not: null } } } }] });
        }
        if (query.inStockOnly) {
            // `not: 0` rather than `gt: 0`: stock sold into a negative balance
            // is still stock someone will have to cost.
            and.push({ stocks: { some: { quantity: { not: 0 } } } });
        }

        return {
            tenant_id: tenantId,
            deleted_at: null,
            // Services are never stock-tracked and can carry no cost.
            type: { not: 'SERVICE' },
            ...(query.groupId ? { group_id: query.groupId } : {}),
            ...(and.length > 0 ? { AND: and } : {}),
        };
    }

    /** Tenant-wide counts, independent of the page and its filters. */
    private async summary(tenantId: string) {
        const goods: Prisma.ProductWhereInput = { tenant_id: tenantId, deleted_at: null, type: { not: 'SERVICE' } };
        const uncosted: Prisma.ProductWhereInput = { cost: { is: null }, prices: { none: { cost: { not: null } } } };
        const [productCount, uncostedCount, uncostedInStockCount] = await Promise.all([
            this.db.product.count({ where: goods }),
            this.db.product.count({ where: { ...goods, ...uncosted } }),
            this.db.product.count({ where: { ...goods, ...uncosted, stocks: { some: { quantity: { not: 0 } } } } }),
        ]);
        return { productCount, uncostedCount, uncostedInStockCount };
    }

    private async costingMethod(tenantId: string): Promise<CostingMethod> {
        const settings = await this.db.inventorySettings.findUnique({
            where: { tenant_id: tenantId },
            select: { costing_method: true },
        });
        return isCostingMethod(settings?.costing_method) ? settings!.costing_method as CostingMethod : 'WEIGHTED_AVERAGE';
    }

    /** Newest price-list cost per product, any store — what Stock on Hand falls back to. */
    private async priceListCosts(tenantId: string, productIds: string[]) {
        const costs = new Map<string, number>();
        if (productIds.length === 0) return costs;
        const prices = await this.db.productPrice.findMany({
            where: { tenant_id: tenantId, product_id: { in: productIds }, cost: { not: null } },
            orderBy: { effective_from: 'desc' },
            select: { product_id: true, cost: true },
        });
        for (const price of prices) {
            if (!costs.has(price.product_id)) costs.set(price.product_id, Number(price.cost));
        }
        return costs;
    }

    /**
     * What each product was last bought at, from the bill rather than the pool.
     * Offered as the suggested figure for an uncosted product: stock imported
     * from another system often has its purchase bills imported too, without
     * those bills ever having costed the pool.
     */
    private async lastPurchaseCosts(tenantId: string, productIds: string[]) {
        const costs = new Map<string, { unitCost: number; at: Date }>();
        if (productIds.length === 0) return costs;
        const lines = await this.db.purchaseItem.findMany({
            where: {
                product_id: { in: productIds },
                unit_cost: { gt: 0 },
                purchase: { tenant_id: tenantId, ...ACTIVE_PURCHASE },
            },
            orderBy: { purchase: { created_at: 'desc' } },
            distinct: ['product_id'],
            select: { product_id: true, unit_cost: true, purchase: { select: { created_at: true } } },
        });
        for (const line of lines) {
            if (!costs.has(line.product_id)) {
                costs.set(line.product_id, { unitCost: Number(line.unit_cost), at: line.purchase.created_at });
            }
        }
        return costs;
    }
}

function round2(value: number): number {
    return Math.round(value * 100) / 100;
}
