import {
    discountRatio,
    groupMargin,
    marginBridge,
    returnLines,
    saleLines,
    summariseMargin,
    type MarginLine,
    type ReturnForMargin,
    type SaleForMargin,
} from './gross-profit.utils';

const byProduct = (item: { productId: string }) => ({ key: item.productId, label: item.productId });

const line = (over: Partial<MarginLine> = {}): MarginLine => ({
    key: 'p1',
    label: 'p1',
    quantity: 1,
    revenue: 100,
    cost: 60,
    ...over,
});

describe('discountRatio', () => {
    it('is 1 when the invoice matches the list total', () => {
        const sale: SaleForMargin = {
            id: 's1',
            totalAmount: 200,
            items: [{ productId: 'p1', quantity: 2, priceAtSale: 100, unitCostAtSale: 60 }],
        };

        expect(discountRatio(sale)).toBe(1);
    });

    it('scales down when the invoice carries an order-level discount', () => {
        // Two lines at 100 each, customer paid 150 — a 25% order discount that
        // never touched price_at_sale.
        const sale: SaleForMargin = {
            id: 's1',
            totalAmount: 150,
            items: [
                { productId: 'p1', quantity: 1, priceAtSale: 100, unitCostAtSale: 60 },
                { productId: 'p2', quantity: 1, priceAtSale: 100, unitCostAtSale: 60 },
            ],
        };

        expect(discountRatio(sale)).toBe(0.75);
    });

    it('is 1 for a giveaway sale rather than dividing by zero', () => {
        const sale: SaleForMargin = {
            id: 's1',
            totalAmount: 0,
            items: [{ productId: 'p1', quantity: 1, priceAtSale: 0, unitCostAtSale: 60 }],
        };

        expect(discountRatio(sale)).toBe(1);
    });
});

describe('saleLines', () => {
    it('spreads an invoice discount in proportion to line value', () => {
        // 300 of list value sold for 240 — every line keeps 80%.
        const sale: SaleForMargin = {
            id: 's1',
            totalAmount: 240,
            items: [
                { productId: 'p1', quantity: 1, priceAtSale: 200, unitCostAtSale: 100 },
                { productId: 'p2', quantity: 1, priceAtSale: 100, unitCostAtSale: 50 },
            ],
        };

        const lines = saleLines([sale], byProduct);

        expect(lines.map((l) => l.revenue)).toEqual([160, 80]);
        // Cost is unaffected by a discount — the goods cost what they cost.
        expect(lines.map((l) => l.cost)).toEqual([100, 50]);
    });

    it('reconciles line revenue to the invoice total', () => {
        const sale: SaleForMargin = {
            id: 's1',
            totalAmount: 137.5,
            items: [
                { productId: 'p1', quantity: 3, priceAtSale: 33.33, unitCostAtSale: 20 },
                { productId: 'p2', quantity: 2, priceAtSale: 27.5, unitCostAtSale: 15 },
            ],
        };

        const total = saleLines([sale], byProduct).reduce((sum, l) => sum + l.revenue, 0);

        expect(total).toBeCloseTo(137.5, 6);
    });

    it('carries a null cost through rather than substituting zero', () => {
        const sale: SaleForMargin = {
            id: 's1',
            totalAmount: 100,
            items: [{ productId: 'p1', quantity: 1, priceAtSale: 100, unitCostAtSale: null }],
        };

        expect(saleLines([sale], byProduct)[0].cost).toBeNull();
    });
});

describe('returnLines', () => {
    it('produces negative revenue and negative cost', () => {
        const ret: ReturnForMargin = {
            id: 'r1',
            items: [{ productId: 'p1', quantity: 2, refundAmount: 200, unitCostAtReturn: 60 }],
        };

        expect(returnLines([ret], byProduct)[0]).toMatchObject({
            quantity: -2,
            revenue: -200,
            cost: -120,
        });
    });

    it('leaves a return with no cost on file uncosted', () => {
        const ret: ReturnForMargin = {
            id: 'r1',
            items: [{ productId: 'p1', quantity: 1, refundAmount: 100, unitCostAtReturn: null }],
        };

        expect(returnLines([ret], byProduct)[0].cost).toBeNull();
    });
});

describe('summariseMargin', () => {
    it('computes margin over costed revenue', () => {
        const totals = summariseMargin([line({ revenue: 100, cost: 60 })]);

        expect(totals.grossProfit).toBe(40);
        expect(totals.grossMarginPct).toBe(40);
        expect(totals.cogs).toBe(60);
    });

    it('excludes an uncosted line from BOTH sides of the margin', () => {
        // The bug this replaces: the old code folded an uncosted line in as
        // cost 0, so this basket reported 200 revenue against 60 cost — a 70%
        // margin on a business actually running at 40% on what it can measure.
        const totals = summariseMargin([
            line({ revenue: 100, cost: 60 }),
            line({ key: 'p2', revenue: 100, cost: null }),
        ]);

        expect(totals.grossProfit).toBe(40);
        expect(totals.grossMarginPct).toBe(40);
        // The revenue is still real and still reported — it just is not
        // attributable to a cost.
        expect(totals.netRevenue).toBe(200);
    });

    it('reports coverage so a thin basis is visible', () => {
        const totals = summariseMargin([
            line({ revenue: 100, cost: 60 }),
            line({ key: 'p2', revenue: 300, cost: null }),
        ]);

        expect(totals.coverage).toEqual({
            costedLines: 1,
            uncostedLines: 1,
            costedRevenue: 100,
            uncostedRevenue: 300,
            costedRevenuePct: 25,
        });
    });

    it('returns null margin rather than zero when nothing has a basis', () => {
        // Zero would read as "we broke even". Null reads as "we cannot say",
        // which is the truth.
        const totals = summariseMargin([line({ cost: null })]);

        expect(totals.grossProfit).toBeNull();
        expect(totals.grossMarginPct).toBeNull();
    });

    it('nets a return against the sale it reverses', () => {
        // Sold 2 @ 100 costing 60, all of it came back. Gross profit must be
        // zero — not the 80 the old code reported by subtracting the refund
        // from revenue while leaving COGS at 120.
        const totals = summariseMargin([
            line({ quantity: 2, revenue: 200, cost: 120 }),
            line({ quantity: -2, revenue: -200, cost: -120 }),
        ]);

        expect(totals.netRevenue).toBe(0);
        expect(totals.cogs).toBe(0);
        expect(totals.grossProfit).toBe(0);
    });

    it('nets a partial return correctly', () => {
        // Sold 4 @ 100 cost 60 (gp 160); returned 1 (revenue -100, cost -60).
        const totals = summariseMargin([
            line({ quantity: 4, revenue: 400, cost: 240 }),
            line({ quantity: -1, revenue: -100, cost: -60 }),
        ]);

        expect(totals.netRevenue).toBe(300);
        expect(totals.cogs).toBe(180);
        expect(totals.grossProfit).toBe(120);
    });

    it('handles an empty range without dividing by zero', () => {
        const totals = summariseMargin([]);

        expect(totals.grossProfit).toBeNull();
        expect(totals.netRevenue).toBe(0);
        expect(totals.coverage.costedRevenuePct).toBeNull();
    });

    it('reports a negative margin when goods sold below cost', () => {
        const totals = summariseMargin([line({ revenue: 50, cost: 80 })]);

        expect(totals.grossProfit).toBe(-30);
        expect(totals.grossMarginPct).toBe(-60);
    });
});

describe('groupMargin', () => {
    it('groups by key and sorts by gross profit descending', () => {
        const groups = groupMargin([
            line({ key: 'a', label: 'A', revenue: 100, cost: 90 }),
            line({ key: 'b', label: 'B', revenue: 100, cost: 10 }),
            line({ key: 'a', label: 'A', revenue: 100, cost: 90 }),
        ]);

        expect(groups.map((g) => g.key)).toEqual(['b', 'a']);
        expect(groups[0].grossProfit).toBe(90);
        expect(groups[1].grossProfit).toBe(20);
        expect(groups[1].units).toBe(2);
    });

    it('sorts a group with no cost basis last, since it claims nothing', () => {
        const groups = groupMargin([
            line({ key: 'a', label: 'A', cost: null }),
            line({ key: 'b', label: 'B', revenue: 100, cost: 99 }),
        ]);

        expect(groups.map((g) => g.key)).toEqual(['b', 'a']);
        expect(groups[1].grossProfit).toBeNull();
    });
});

describe('marginBridge', () => {
    it('attributes a pure volume change to volume', () => {
        // Same price and cost per unit, twice the units.
        const bridge = marginBridge(
            { units: 10, revenue: 1000, cogs: 600 },
            { units: 20, revenue: 2000, cogs: 1200 },
        );

        expect(bridge.totalChange).toBe(400);
        expect(bridge.volumeEffect).toBe(400);
        expect(bridge.priceEffect).toBe(0);
        expect(bridge.costEffect).toBe(0);
    });

    it('attributes a pure price change to price', () => {
        const bridge = marginBridge(
            { units: 10, revenue: 1000, cogs: 600 },
            { units: 10, revenue: 1100, cogs: 600 },
        );

        expect(bridge.priceEffect).toBe(100);
        expect(bridge.volumeEffect).toBe(0);
        expect(bridge.costEffect).toBe(0);
    });

    it('attributes rising cost as a negative effect', () => {
        // Cost per unit up from 60 to 70 across 10 units: profit down 100.
        const bridge = marginBridge(
            { units: 10, revenue: 1000, cogs: 600 },
            { units: 10, revenue: 1000, cogs: 700 },
        );

        expect(bridge.costEffect).toBe(-100);
        expect(bridge.totalChange).toBe(-100);
    });

    it('always sums the four effects to the total change', () => {
        // The reason mix is the residual: readers treat a rounding gap between
        // the bars and the total as a bug in the report.
        const bridge = marginBridge(
            { units: 37, revenue: 4211.5, cogs: 2588.25 },
            { units: 52, revenue: 6903.75, cogs: 4401.1 },
        );

        const sum =
            bridge.volumeEffect + bridge.priceEffect + bridge.costEffect + bridge.mixEffect;

        expect(sum).toBeCloseTo(bridge.totalChange, 2);
    });

    it('treats growth from nothing as volume', () => {
        // No prior units means no per-unit baseline to hold constant; a product
        // that did not sell before grew by appearing, not by repricing.
        const bridge = marginBridge(
            { units: 0, revenue: 0, cogs: 0 },
            { units: 5, revenue: 500, cogs: 300 },
        );

        expect(bridge.volumeEffect).toBe(200);
        expect(bridge.priceEffect).toBe(0);
        expect(bridge.mixEffect).toBe(0);
    });

    it('handles a product that stopped selling', () => {
        const bridge = marginBridge(
            { units: 10, revenue: 1000, cogs: 600 },
            { units: 0, revenue: 0, cogs: 0 },
        );

        expect(bridge.totalChange).toBe(-400);
        expect(bridge.volumeEffect).toBe(-400);
    });
});
