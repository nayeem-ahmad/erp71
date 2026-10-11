/**
 * The plan behind `npm run fix:stock-from-movements`: which stock totals no
 * longer agree with the movements they are supposed to sum, and what they
 * should be. Pure, so the backend's tests can pin it.
 */

export interface StockRow {
    productId: string;
    warehouseId: string;
    quantity: number;
}

export interface MovementSum {
    productId: string;
    warehouseId: string;
    sum: number;
}

export interface PoolRow {
    productId: string;
    qtyOnHand: number;
}

export interface StockFix {
    productId: string;
    warehouseId: string;
    /** Null when no stock row exists yet for movements that net to something. */
    from: number | null;
    to: number;
}

export interface PoolFix {
    productId: string;
    from: number;
    to: number;
}

export interface StockPlan {
    /** Stock rows whose quantity is not what their movements add up to. */
    stock: StockFix[];
    /** Cost pools whose count is not the product's movements across every warehouse. */
    pools: PoolFix[];
    /**
     * Stock with no movement behind it at all. Left alone unless asked: it may
     * be a quantity entered without a movement rather than a leftover.
     */
    unmoved: StockRow[];
}

const key = (productId: string, warehouseId: string) => `${productId}\u0000${warehouseId}`;

export function planStockRepairs(
    stocks: StockRow[],
    sums: MovementSum[],
    pools: PoolRow[],
    options: { includeUnmoved?: boolean } = {},
): StockPlan {
    const summed = new Map(sums.map((s) => [key(s.productId, s.warehouseId), s.sum]));
    const stored = new Map(stocks.map((s) => [key(s.productId, s.warehouseId), s]));

    const stock: StockFix[] = [];
    const unmoved: StockRow[] = [];
    for (const row of stocks) {
        const sum = summed.get(key(row.productId, row.warehouseId));
        if (sum === undefined) {
            if (row.quantity === 0) continue;
            if (options.includeUnmoved) stock.push({ productId: row.productId, warehouseId: row.warehouseId, from: row.quantity, to: 0 });
            else unmoved.push(row);
            continue;
        }
        if (sum !== row.quantity) stock.push({ productId: row.productId, warehouseId: row.warehouseId, from: row.quantity, to: sum });
    }
    for (const s of sums) {
        if (s.sum !== 0 && !stored.has(key(s.productId, s.warehouseId))) {
            stock.push({ productId: s.productId, warehouseId: s.warehouseId, from: null, to: s.sum });
        }
    }

    // The pool counts the product across every warehouse; unmoved stock that is
    // being kept stays in its count, the same as it stays on the shelf.
    const totals = new Map<string, number>();
    for (const s of sums) totals.set(s.productId, (totals.get(s.productId) ?? 0) + s.sum);
    for (const row of unmoved) totals.set(row.productId, (totals.get(row.productId) ?? 0) + row.quantity);
    const poolFixes: PoolFix[] = [];
    for (const pool of pools) {
        const to = totals.get(pool.productId) ?? 0;
        if (to !== pool.qtyOnHand) poolFixes.push({ productId: pool.productId, from: pool.qtyOnHand, to });
    }

    return { stock, pools: poolFixes, unmoved };
}
