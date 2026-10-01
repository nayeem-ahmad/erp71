import { BadRequestException, NotFoundException } from '@nestjs/common';

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

export function throwIfBlocked(plan: MergePlan, mode: 'preview' | 'commit'): void {
    const sourceGone = plan.blockers.find((b) => b.code === 'SOURCE_NOT_FOUND');
    if (sourceGone) {
        throw new NotFoundException({ code: sourceGone.code, message: sourceGone.message });
    }
    if (mode === 'preview' || plan.blockers.length === 0) return;
    const first = plan.blockers[0];
    throw new BadRequestException({ code: first.code, message: first.message });
}
