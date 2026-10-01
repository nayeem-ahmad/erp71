import { BadRequestException, NotFoundException } from '@nestjs/common';
import { mergePools } from '../database/product-cost.utils';

/**
 * Shared merge planner. Preview returns this plan; commit re-runs it
 * inside a transaction and refuses the same blockers.
 */

export const TAKE_FIELDS = [
    'name', 'sku', 'price', 'compareAtPrice', 'brand', 'category', 'image',
    'gallery', 'description', 'unitType', 'vatRate', 'sdRate', 'warranty',
    'reorder', 'hsCode', 'origin', 'weight',
] as const;
export type TakeField = (typeof TAKE_FIELDS)[number];
export type BlockerCode =
    | 'SOURCE_NOT_FOUND'
    | 'TARGET_NOT_FOUND'
    | 'SAME_PRODUCT'
    | 'TYPE_MISMATCH'
    | 'SERIAL_COLLISION'
    | 'BOM_CONFLICT';

export type MergeBlocker = { code: BlockerCode; message: string };
export type MergePlan = {
    source: any | null;
    target: any | null;
    fields: Array<{ key: TakeField; sourceValue: unknown; targetValue: unknown }>;
    stock: Array<{ warehouseId: string; warehouseName: string; sourceQty: number; targetQty: number; combinedQty: number }>;
    cost: {
        source: { avgCost: number | null; qtyOnHand: number };
        target: { avgCost: number | null; qtyOnHand: number };
        combined: { avgCost: number | null; qtyOnHand: number };
    };
    counts: {
        saleLines: number; purchaseLines: number;
        saleReturnLines: number; purchaseReturnLines: number;
        orderLines: number; quoteLines: number;
        movements: number; serials: number; warranties: number; mappings: number;
    };
    folds: Array<{ kind: string; parentLabel: string; note: string }>;
    blockers: MergeBlocker[];
};

const EMPTY_COST = { avgCost: null, qtyOnHand: 0 };
const EMPTY_COUNTS: MergePlan['counts'] = {
    saleLines: 0,
    purchaseLines: 0,
    saleReturnLines: 0,
    purchaseReturnLines: 0,
    orderLines: 0,
    quoteLines: 0,
    movements: 0,
    serials: 0,
    warranties: 0,
    mappings: 0,
};

function blocker(code: BlockerCode, message: string): MergeBlocker {
    return { code, message };
}

/** Prisma already filters tenant_id; re-check the row so a mock (or leak) cannot pass a foreign product. */
function liveInTenant(row: any, tenantId: string): any | null {
    if (!row || row.tenant_id !== tenantId || row.deleted_at != null) return null;
    return row;
}

async function findLiveProduct(db: any, tenantId: string, id: string) {
    const row = await db.product.findFirst({
        where: { id, tenant_id: tenantId, deleted_at: null },
    });
    return liveInTenant(row, tenantId);
}

function catalogValue(product: any, key: TakeField): unknown {
    switch (key) {
        case 'name': return product.name;
        case 'sku': return product.sku;
        case 'price': return Number(product.price);
        case 'compareAtPrice': return product.compare_at_price;
        case 'brand': return product.brand_id;
        case 'category': return { groupId: product.group_id, subgroupId: product.subgroup_id };
        case 'image': return product.image_url;
        case 'gallery': return product.images_gallery;
        case 'description': return product.description;
        case 'unitType': return product.unit_type;
        case 'vatRate': return product.vat_rate;
        case 'sdRate': return product.sd_rate;
        case 'warranty': return { enabled: product.warranty_enabled, durationDays: product.warranty_duration_days };
        case 'reorder': return {
            reorderLevel: product.reorder_level,
            safetyStock: product.safety_stock,
            leadTimeDays: product.lead_time_days,
        };
        case 'hsCode': return product.hs_code;
        case 'origin': return product.country_of_origin;
        case 'weight': return { netWeightKg: product.net_weight_kg, cbm: product.cbm };
    }
}

function catalogFields(source: any, target: any): MergePlan['fields'] {
    return TAKE_FIELDS.map((key) => ({
        key,
        sourceValue: catalogValue(source, key),
        targetValue: catalogValue(target, key),
    }));
}

function costSide(row: any): MergePlan['cost']['source'] {
    if (!row) return { ...EMPTY_COST };
    return { avgCost: Number(row.avg_cost), qtyOnHand: Number(row.qty_on_hand) };
}

function combineStock(
    rows: Array<{ product_id: string; warehouse_id: string; quantity: number; warehouse?: { name?: string } | null }>,
    sourceId: string,
    targetId: string,
): MergePlan['stock'] {
    const byWarehouse = new Map<string, MergePlan['stock'][number]>();
    for (const row of rows) {
        const warehouseId = row.warehouse_id;
        const existing = byWarehouse.get(warehouseId) ?? {
            warehouseId,
            warehouseName: row.warehouse?.name ?? warehouseId,
            sourceQty: 0,
            targetQty: 0,
            combinedQty: 0,
        };
        const qty = Number(row.quantity);
        if (row.product_id === sourceId) existing.sourceQty += qty;
        else if (row.product_id === targetId) existing.targetQty += qty;
        if (row.warehouse?.name) existing.warehouseName = row.warehouse.name;
        existing.combinedQty = existing.sourceQty + existing.targetQty;
        byWarehouse.set(warehouseId, existing);
    }
    return [...byWarehouse.values()];
}

function parentFolds(
    kind: string,
    items: any[],
    sourceId: string,
    targetId: string,
    parentKey: string,
    labelOf: (item: any, parentId: string) => string,
    note: string,
): MergePlan['folds'] {
    if (sourceId === targetId) return [];
    const byParent = new Map<string, any[]>();
    for (const item of items) {
        const parentId = item[parentKey];
        const group = byParent.get(parentId) ?? [];
        group.push(item);
        byParent.set(parentId, group);
    }
    const folds: MergePlan['folds'] = [];
    for (const [parentId, group] of byParent) {
        const ids = new Set(group.map((row) => row.product_id));
        if (ids.has(sourceId) && ids.has(targetId)) {
            folds.push({ kind, parentLabel: labelOf(group[0], parentId), note });
        }
    }
    return folds;
}

function emptyPayload(source: any | null, target: any | null, blockers: MergeBlocker[]): MergePlan {
    return {
        source,
        target,
        fields: [],
        stock: [],
        cost: {
            source: { ...EMPTY_COST },
            target: { ...EMPTY_COST },
            combined: { ...EMPTY_COST },
        },
        counts: { ...EMPTY_COUNTS },
        folds: [],
        blockers,
    };
}

export async function planMerge(
    db: any,
    tenantId: string,
    sourceId: string,
    targetId: string,
): Promise<MergePlan> {
    const source = await findLiveProduct(db, tenantId, sourceId);
    const target = await findLiveProduct(db, tenantId, targetId);
    const blockers: MergeBlocker[] = [];

    if (!source) {
        blockers.push(blocker('SOURCE_NOT_FOUND', 'Source product was not found.'));
    }
    if (!target) {
        blockers.push(blocker('TARGET_NOT_FOUND', 'Target product was not found.'));
    }
    if (sourceId === targetId) {
        blockers.push(blocker('SAME_PRODUCT', 'Cannot merge a product into itself.'));
    }

    if (source && target && sourceId !== targetId) {
        if (source.type !== target.type) {
            blockers.push(blocker('TYPE_MISMATCH', 'Cannot merge products of different types.'));
        }

        const serials: Array<{ product_id: string; serial_number: string }> =
            await db.productSerial.findMany({
                where: { product_id: { in: [sourceId, targetId] } },
            });
        const sourceSerials = new Set(
            serials.filter((s) => s.product_id === sourceId).map((s) => s.serial_number),
        );
        const serialCollision = serials.some(
            (s) => s.product_id === targetId && sourceSerials.has(s.serial_number),
        );
        if (serialCollision) {
            blockers.push(blocker('SERIAL_COLLISION', 'Both products have the same serial number.'));
        }

        const recipes: Array<{ productId: string }> = await db.bomRecipe.findMany({
            where: { productId: { in: [sourceId, targetId] } },
        });
        const hasSourceBom = recipes.some((r) => r.productId === sourceId);
        const hasTargetBom = recipes.some((r) => r.productId === targetId);
        if (hasSourceBom && hasTargetBom) {
            blockers.push(blocker('BOM_CONFLICT', 'Both products have a bill of materials.'));
        }
    }

    // Missing products cannot be counted; other blockers still get a preview payload.
    if (!source || !target) {
        return emptyPayload(source, target, blockers);
    }

    const bothIds = [sourceId, targetId];
    const [
        saleLines,
        purchaseLines,
        saleReturnLines,
        purchaseReturnLines,
        orderLines,
        quoteLines,
        movements,
        serials,
        warranties,
        mappings,
        stockRows,
        sourceCostRow,
        targetCostRow,
        transferItems,
        shrinkageItems,
        stockTakeLines,
        demandItems,
        priceListItems,
    ] = await Promise.all([
        db.saleItem.count({ where: { product_id: sourceId } }),
        db.purchaseItem.count({ where: { product_id: sourceId } }),
        db.salesReturnItem.count({ where: { product_id: sourceId } }),
        db.purchaseReturnItem.count({ where: { product_id: sourceId } }),
        db.salesOrderItem.count({ where: { product_id: sourceId } }),
        db.quotationItem.count({ where: { product_id: sourceId } }),
        db.inventoryMovement.count({ where: { product_id: sourceId } }),
        db.productSerial.count({ where: { product_id: sourceId } }),
        db.warrantyClaim.count({ where: { product_id: sourceId } }),
        db.externalSyncMapping.count({
            where: { entity_type: 'PRODUCT', internal_id: sourceId, tenant_id: tenantId },
        }),
        db.productStock.findMany({
            where: { product_id: { in: bothIds } },
            include: { warehouse: { select: { name: true } } },
        }),
        db.productCost.findUnique({ where: { product_id: sourceId } }),
        db.productCost.findUnique({ where: { product_id: targetId } }),
        db.warehouseTransferItem.findMany({
            where: { product_id: { in: bothIds } },
            include: { transfer: { select: { transfer_number: true } } },
        }),
        db.inventoryShrinkageItem.findMany({
            where: { product_id: { in: bothIds } },
            include: { shrinkage: { select: { reference_number: true } } },
        }),
        db.stockTakeCountLine.findMany({
            where: { product_id: { in: bothIds } },
            include: { session: { select: { session_number: true } } },
        }),
        db.productDemandItem.findMany({
            where: { product_id: { in: bothIds } },
            include: { demand: { select: { demand_number: true } } },
        }),
        db.priceListItem.findMany({
            where: { product_id: { in: bothIds } },
            include: { priceList: { select: { name: true } } },
        }),
    ]);

    const sourceCost = costSide(sourceCostRow);
    const targetCost = costSide(targetCostRow);

    return {
        source,
        target,
        fields: catalogFields(source, target),
        stock: combineStock(stockRows, sourceId, targetId),
        cost: {
            source: sourceCost,
            target: targetCost,
            combined: mergePools(targetCost, sourceCostRow ? sourceCost : null),
        },
        counts: {
            saleLines,
            purchaseLines,
            saleReturnLines,
            purchaseReturnLines,
            orderLines,
            quoteLines,
            movements,
            serials,
            warranties,
            mappings,
        },
        folds: [
            ...parentFolds(
                'transfer',
                transferItems,
                sourceId,
                targetId,
                'transfer_id',
                (item, parentId) => item.transfer?.transfer_number ?? parentId,
                'Quantities on this transfer will be combined.',
            ),
            ...parentFolds(
                'shrinkage',
                shrinkageItems,
                sourceId,
                targetId,
                'shrinkage_id',
                (item, parentId) => item.shrinkage?.reference_number ?? parentId,
                'Quantities on this shrinkage will be combined.',
            ),
            ...parentFolds(
                'stockTake',
                stockTakeLines,
                sourceId,
                targetId,
                'session_id',
                (item, parentId) => item.session?.session_number ?? parentId,
                'Quantities on this stock take will be combined.',
            ),
            ...parentFolds(
                'demand',
                demandItems,
                sourceId,
                targetId,
                'demand_id',
                (item, parentId) => item.demand?.demand_number ?? parentId,
                'Quantities on this demand will be combined.',
            ),
            ...parentFolds(
                'priceList',
                priceListItems,
                sourceId,
                targetId,
                'price_list_id',
                (item, parentId) => item.priceList?.name ?? parentId,
                'Keeper list price wins; the duplicate row will be dropped.',
            ),
        ],
        blockers,
    };
}

export function throwIfBlocked(plan: MergePlan, mode: 'preview' | 'commit'): void {
    const sourceGone = plan.blockers.find((b) => b.code === 'SOURCE_NOT_FOUND');
    if (sourceGone) {
        throw new NotFoundException({ code: sourceGone.code, message: sourceGone.message });
    }
    if (mode === 'preview' || plan.blockers.length === 0) return;
    const first = plan.blockers[0];
    throw new BadRequestException({ code: first.code, message: first.message });
}

const TAKE_FIELD_SET = new Set<string>(TAKE_FIELDS);

function isTakeField(value: unknown): value is TakeField {
    return typeof value === 'string' && TAKE_FIELD_SET.has(value);
}

export function parseTakeFields(raw: unknown): TakeField[] {
    if (raw == null) return [];
    if (!Array.isArray(raw)) {
        throw new BadRequestException('takeFields must be an array.');
    }
    const seen = new Set<TakeField>();
    const fields: TakeField[] = [];
    for (const item of raw) {
        if (!isTakeField(item)) {
            throw new BadRequestException(`Unknown takeFields value: ${String(item)}`);
        }
        if (!seen.has(item)) {
            seen.add(item);
            fields.push(item);
        }
    }
    return fields;
}

const REPOINT_PRODUCT_ID = [
    'saleItem',
    'salesReturnItem',
    'purchaseItem',
    'purchaseReturnItem',
    'salesOrderItem',
    'quotationItem',
    'purchaseOrderItem',
    'purchaseQuotationItem',
    'importShipmentItem',
    'warrantyClaim',
    'inventoryMovement',
    'productSerial',
    'productPrice',
] as const;

const REPOINT_PRODUCT_ID_CAMEL = [
    'storefrontOrderItem',
    'productionJob',
    'productionWastage',
] as const;

const PRODUCT_INCLUDE = {
    brand: true,
    group: true,
    subgroup: { include: { group: true } },
    stocks: {
        include: { warehouse: true },
        orderBy: [{ warehouse: { is_default: 'desc' as const } }, { warehouse: { name: 'asc' as const } }],
    },
};

async function repointForeignKeys(tx: any, sourceId: string, targetId: string): Promise<void> {
    for (const model of REPOINT_PRODUCT_ID) {
        await tx[model].updateMany({
            where: { product_id: sourceId },
            data: { product_id: targetId },
        });
    }
    for (const model of REPOINT_PRODUCT_ID_CAMEL) {
        await tx[model].updateMany({
            where: { productId: sourceId },
            data: { productId: targetId },
        });
    }
}

async function combineStockRows(
    tx: any,
    tenantId: string,
    sourceId: string,
    targetId: string,
): Promise<number> {
    const rows: Array<{ id: string; product_id: string; warehouse_id: string; quantity: number }> =
        await tx.productStock.findMany({
            where: { tenant_id: tenantId, product_id: { in: [sourceId, targetId] } },
        });

    const keeperByWarehouse = new Map<string, { id: string; quantity: number }>();
    const sourceRows: typeof rows = [];
    for (const row of rows) {
        if (row.product_id === targetId) {
            keeperByWarehouse.set(row.warehouse_id, { id: row.id, quantity: Number(row.quantity) });
        } else if (row.product_id === sourceId) {
            sourceRows.push(row);
        }
    }

    for (const source of sourceRows) {
        const keeper = keeperByWarehouse.get(source.warehouse_id);
        const sourceQty = Number(source.quantity);
        if (keeper) {
            keeper.quantity += sourceQty;
            await tx.productStock.update({
                where: { id: keeper.id },
                data: { quantity: keeper.quantity },
            });
            await tx.productStock.delete({ where: { id: source.id } });
        } else {
            await tx.productStock.update({
                where: { id: source.id },
                data: { product_id: targetId },
            });
            keeperByWarehouse.set(source.warehouse_id, { id: source.id, quantity: sourceQty });
        }
    }

    let sum = 0;
    for (const row of keeperByWarehouse.values()) sum += row.quantity;
    return sum;
}

async function writeCombinedCost(
    tx: any,
    tenantId: string,
    sourceId: string,
    targetId: string,
    stockSum: number,
): Promise<MergePlan['cost']['combined']> {
    const [sourceCostRow, targetCostRow] = await Promise.all([
        tx.productCost.findUnique({ where: { product_id: sourceId } }),
        tx.productCost.findUnique({ where: { product_id: targetId } }),
    ]);
    const merged = mergePools(
        costSide(targetCostRow),
        sourceCostRow ? costSide(sourceCostRow) : null,
    );
    const combined: MergePlan['cost']['combined'] = {
        avgCost: merged.avgCost,
        qtyOnHand: stockSum,
    };

    if (targetCostRow || sourceCostRow) {
        if (combined.avgCost !== null) {
            await tx.productCost.upsert({
                where: { product_id: targetId },
                update: { avg_cost: combined.avgCost, qty_on_hand: combined.qtyOnHand },
                create: {
                    tenant_id: tenantId,
                    product_id: targetId,
                    avg_cost: combined.avgCost,
                    qty_on_hand: combined.qtyOnHand,
                },
            });
        } else if (targetCostRow && combined.qtyOnHand !== Number(targetCostRow.qty_on_hand)) {
            await tx.productCost.update({
                where: { product_id: targetId },
                data: { qty_on_hand: combined.qtyOnHand },
            });
        }
    }

    if (sourceCostRow) {
        await tx.productCost.delete({ where: { product_id: sourceId } });
    }

    return combined;
}

export async function commitMerge(
    db: any,
    redis: { invalidatePattern(pattern: string): Promise<void> },
    tenantId: string,
    sourceId: string,
    dto: { targetId: string; takeFields: TakeField[] },
): Promise<{
    product: any;
    sourceId: string;
    targetId: string;
    counts: MergePlan['counts'];
    combinedStock: number;
    combinedCost: MergePlan['cost']['combined'];
}> {
    parseTakeFields(dto.takeFields);
    const targetId = dto.targetId;

    const result = await db.$transaction(async (tx: any) => {
        const plan = await planMerge(tx, tenantId, sourceId, targetId);
        throwIfBlocked(plan, 'commit');

        await repointForeignKeys(tx, sourceId, targetId);

        const combinedStock = await combineStockRows(tx, tenantId, sourceId, targetId);
        const combinedCost = await writeCombinedCost(tx, tenantId, sourceId, targetId, combinedStock);

        await tx.product.update({
            where: { id: sourceId },
            data: { sku: null, deleted_at: new Date() },
        });

        const product = await tx.product.findFirst({
            where: { id: targetId, tenant_id: tenantId, deleted_at: null },
            include: PRODUCT_INCLUDE,
        });

        return {
            product,
            sourceId,
            targetId,
            counts: plan.counts,
            combinedStock,
            combinedCost,
        };
    });

    await redis.invalidatePattern(`products:${tenantId}:`);
    return result;
}
