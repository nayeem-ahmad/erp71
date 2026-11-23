import { rollUpByFamily, rollUpSalesByProduct, rollUpStockOnHand, type StockOnHandRollupRow } from './product-family-rollup';

const belt = { id: 'fam-1', name: 'Belt OAC' };

describe('rollUpByFamily', () => {
    it('folds a family into one row where its first member was and passes the rest through', () => {
        const rows = [
            { id: 'a', family: null },
            { id: 's', family: belt },
            { id: 'b', family: null },
            { id: 'm', family: belt },
        ];
        const out = rollUpByFamily(rows, (row) => row.family, (family, members) => ({
            id: `${family.id}:${members.map((m) => m.id).join('+')}`,
            family: null,
        }));
        expect(out.map((row) => row.id)).toEqual(['a', 'fam-1:s+m', 'b']);
    });
});

describe('rollUpSalesByProduct', () => {
    it('sums units, revenue and share per family and re-sorts by revenue', () => {
        const out = rollUpSalesByProduct([
            { product: { id: 'cap', name: 'Cap' }, unitsSold: 10, revenue: 900, revenueShare: 45 },
            { product: { id: 's', name: 'Belt OAC S', family: belt }, unitsSold: 2, revenue: 600, revenueShare: 30 },
            { product: { id: 'm', name: 'Belt OAC M', family: belt }, unitsSold: 1, revenue: 500, revenueShare: 25 },
        ]);
        expect(out.map((row) => [row.product.name, row.unitsSold, row.revenue, row.revenueShare, row.variantCount])).toEqual([
            ['Belt OAC', 3, 1100, 55, 2],
            ['Cap', 10, 900, 45, undefined],
        ]);
        expect(out[0].product.id).toBe('family:fam-1');
    });
});

describe('rollUpStockOnHand', () => {
    const row = (id: string, qty: Record<string, number>, cost: number | null, basis: StockOnHandRollupRow['costBasis']): StockOnHandRollupRow => {
        const totalQuantity = Object.values(qty).reduce((a, b) => a + b, 0);
        return {
            product: { id, name: id, family: belt },
            quantityByWarehouse: qty,
            totalQuantity,
            averageUnitCost: cost,
            lastPurchasePrice: 100,
            costBasis: basis,
            totalStockValue: cost != null ? totalQuantity * cost : 0,
        };
    };

    it('sums quantity and value per warehouse, and costs the family at value ÷ quantity', () => {
        const [rolled] = rollUpStockOnHand([
            row('s', { w1: 2, w2: 1 }, 100, 'WEIGHTED_AVERAGE'),
            row('l', { w1: 1, w2: 0 }, 160, 'WEIGHTED_AVERAGE'),
        ]);
        expect(rolled.quantityByWarehouse).toEqual({ w1: 3, w2: 1 });
        expect(rolled.valueByWarehouse).toEqual({ w1: 360, w2: 100 });
        expect(rolled.totalStockValue).toBe(460);
        expect(rolled.averageUnitCost).toBe(115);
        expect(rolled.lastPurchasePrice).toBeNull();
        expect(rolled.variantCount).toBe(2);
    });

    it('marks the family uncosted, with no unit cost, when any size is', () => {
        const [rolled] = rollUpStockOnHand([
            row('s', { w1: 2 }, 100, 'WEIGHTED_AVERAGE'),
            row('m', { w1: 5 }, null, 'UNCOSTED'),
        ]);
        expect(rolled.costBasis).toBe('UNCOSTED');
        expect(rolled.averageUnitCost).toBeNull();
        expect(rolled.totalStockValue).toBe(200);
    });
});
