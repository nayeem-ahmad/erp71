/**
 * "Group variants" on reports: a product's sizes and colours added up into one
 * line, for the question "how many belts did we sell, whatever the size".
 *
 * Only a view. Every report still reads and returns one row per product — the
 * same SKU-level truth sales and stock run on — and the page folds the rows it
 * already has, so the toggle costs no request and cannot disagree with the
 * ungrouped figures it was summed from.
 */

export type FamilyRef = { id: string; name: string } | null | undefined;

/**
 * Rows with a family folded into one row per family, placed where the
 * family's first row was; rows without one pass through untouched.
 */
export function rollUpByFamily<R>(
    rows: readonly R[],
    familyOf: (row: R) => FamilyRef,
    combine: (family: { id: string; name: string }, members: R[]) => R,
): R[] {
    const members = new Map<string, { family: { id: string; name: string }; rows: R[] }>();
    for (const row of rows) {
        const family = familyOf(row);
        if (!family) continue;
        const entry = members.get(family.id) ?? { family, rows: [] };
        entry.rows.push(row);
        members.set(family.id, entry);
    }
    if (members.size === 0) return [...rows];

    const out: R[] = [];
    const placed = new Set<string>();
    for (const row of rows) {
        const family = familyOf(row);
        if (!family) {
            out.push(row);
            continue;
        }
        if (placed.has(family.id)) continue;
        placed.add(family.id);
        const entry = members.get(family.id)!;
        out.push(combine(entry.family, entry.rows));
    }
    return out;
}

/** The id a rolled-up row carries: never a product id, so nothing links it to one. */
export function familyRowId(familyId: string): string {
    return `family:${familyId}`;
}

// ─── Sales by product ──────────────────────────────────────────────────────

export type SalesByProductRollupRow = {
    product: {
        id: string;
        name: string;
        sku?: string | null;
        group?: { name: string } | null;
        subgroup?: { name: string } | null;
        family?: FamilyRef;
    };
    unitsSold: number;
    revenue: number;
    revenueShare: number;
    /** Set on a rolled-up row: how many of the family's products sold in the period. */
    variantCount?: number;
};

export function rollUpSalesByProduct<R extends SalesByProductRollupRow>(rows: readonly R[]): R[] {
    return rollUpByFamily(
        rows,
        (row) => row.product.family,
        (family, members) =>
            ({
                ...members[0],
                product: {
                    id: familyRowId(family.id),
                    name: family.name,
                    sku: null,
                    group: members[0].product.group,
                    subgroup: members[0].product.subgroup,
                    family: null,
                },
                unitsSold: members.reduce((sum, row) => sum + row.unitsSold, 0),
                revenue: members.reduce((sum, row) => sum + row.revenue, 0),
                revenueShare: members.reduce((sum, row) => sum + row.revenueShare, 0),
                variantCount: members.length,
            }) as R,
    ).sort((a, b) => b.revenue - a.revenue);
}

// ─── Stock on hand ─────────────────────────────────────────────────────────

export type StockRollupCostBasis = 'WEIGHTED_AVERAGE' | 'LATEST_COST' | 'UNCOSTED';

export type StockOnHandRollupRow = {
    product: {
        id: string;
        name: string;
        sku?: string | null;
        sellingPrice?: number | null;
        brand?: { id: string; name: string } | null;
        group?: { id: string; name: string } | null;
        subgroup?: { id: string; name: string } | null;
        family?: FamilyRef;
    };
    quantityByWarehouse: Record<string, number>;
    /**
     * Set on a rolled-up row: each warehouse's value summed from its members.
     * Quantity × an averaged cost would not equal that sum when the sizes cost
     * different amounts, and the value columns must add up to the total.
     */
    valueByWarehouse?: Record<string, number>;
    totalQuantity: number;
    averageUnitCost: number | null;
    lastPurchasePrice: number | null;
    costBasis: StockRollupCostBasis;
    totalStockValue: number;
    variantCount?: number;
};

/**
 * One line per family: quantities and values summed per warehouse, a unit
 * cost only when every member has one (value ÷ quantity), and the weakest
 * cost basis among the members — a family with one uncosted size is
 * understated, and says so.
 */
export function rollUpStockOnHand<R extends StockOnHandRollupRow>(rows: readonly R[]): R[] {
    return rollUpByFamily(rows, (row) => row.product.family, (family, members) => {
        const quantityByWarehouse: Record<string, number> = {};
        const valueByWarehouse: Record<string, number> = {};
        for (const row of members) {
            for (const [warehouseId, quantity] of Object.entries(row.quantityByWarehouse)) {
                quantityByWarehouse[warehouseId] = (quantityByWarehouse[warehouseId] ?? 0) + quantity;
                const value = row.averageUnitCost != null ? quantity * row.averageUnitCost : 0;
                valueByWarehouse[warehouseId] = (valueByWarehouse[warehouseId] ?? 0) + value;
            }
        }
        const totalQuantity = members.reduce((sum, row) => sum + row.totalQuantity, 0);
        const totalStockValue = members.reduce((sum, row) => sum + row.totalStockValue, 0);
        const costBasis: StockRollupCostBasis = members.some((row) => row.costBasis === 'UNCOSTED')
            ? 'UNCOSTED'
            : members.some((row) => row.costBasis === 'LATEST_COST')
              ? 'LATEST_COST'
              : 'WEIGHTED_AVERAGE';
        const first = members[0];
        return {
            ...first,
            product: {
                id: familyRowId(family.id),
                name: family.name,
                sku: null,
                sellingPrice: null,
                brand: first.product.brand,
                group: first.product.group,
                subgroup: first.product.subgroup,
                family: null,
            },
            quantityByWarehouse,
            valueByWarehouse,
            totalQuantity,
            averageUnitCost: costBasis !== 'UNCOSTED' && totalQuantity !== 0 ? totalStockValue / totalQuantity : null,
            lastPurchasePrice: null,
            costBasis,
            totalStockValue,
            variantCount: members.length,
        } as R;
    });
}
