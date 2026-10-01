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
