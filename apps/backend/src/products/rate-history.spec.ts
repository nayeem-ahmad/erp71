import {
    clampRateHistoryLimit,
    mapPurchaseItemToRateRow,
    mapSaleItemToRateRow,
    summariseRates,
    RATE_HISTORY_DEFAULT_LIMIT,
    RATE_HISTORY_MAX_LIMIT,
    type RateHistoryRow,
} from './rate-history';

const row = (over: Partial<RateHistoryRow> = {}): RateHistoryRow => ({
    documentId: 'doc-1',
    documentNumber: 'INV-001',
    date: '2026-08-12T00:00:00.000Z',
    partyId: 'party-1',
    partyName: 'Rahim Traders',
    quantity: 2,
    rate: 100,
    lineTotal: 200,
    ...over,
});

describe('clampRateHistoryLimit', () => {
    it('falls back to the default for missing or nonsense limits', () => {
        expect(clampRateHistoryLimit(undefined)).toBe(RATE_HISTORY_DEFAULT_LIMIT);
        expect(clampRateHistoryLimit(NaN)).toBe(RATE_HISTORY_DEFAULT_LIMIT);
        expect(clampRateHistoryLimit(0)).toBe(RATE_HISTORY_DEFAULT_LIMIT);
        expect(clampRateHistoryLimit(-3)).toBe(RATE_HISTORY_DEFAULT_LIMIT);
    });

    it('caps a caller that asks for the whole trading history', () => {
        expect(clampRateHistoryLimit(1000)).toBe(RATE_HISTORY_MAX_LIMIT);
    });

    it('honours a sensible limit', () => {
        expect(clampRateHistoryLimit(3)).toBe(3);
    });
});

describe('mapSaleItemToRateRow', () => {
    const saleItem = (over: any = {}) => ({
        quantity: 3,
        price_at_sale: '125.50',
        sale: {
            id: 'sale-1',
            serial_number: 'S-0009',
            reference_number: 'INV-77',
            sale_date: new Date('2026-08-12T10:00:00.000Z'),
            customer_id: 'cus-1',
            customer: { name: 'Rahim Traders' },
            ...over,
        },
    });

    it('coerces the serialised Decimal rate before doing arithmetic', () => {
        const mapped = mapSaleItemToRateRow(saleItem());
        expect(mapped.rate).toBe(125.5);
        expect(mapped.lineTotal).toBe(376.5);
    });

    it('prefers the tenant reference number over the internal serial', () => {
        expect(mapSaleItemToRateRow(saleItem()).documentNumber).toBe('INV-77');
        expect(mapSaleItemToRateRow(saleItem({ reference_number: null })).documentNumber).toBe('S-0009');
    });

    it('leaves a walk-in sale with no party name for the caller to label', () => {
        const mapped = mapSaleItemToRateRow(saleItem({ customer_id: null, customer: null }));
        expect(mapped.partyId).toBeNull();
        expect(mapped.partyName).toBeNull();
    });
});

describe('mapPurchaseItemToRateRow', () => {
    const purchaseItem = (over: any = {}) => ({
        quantity: 10,
        unit_cost: '48.25',
        purchase: {
            id: 'pur-1',
            purchase_number: 'PUR-0004',
            reference_number: null,
            created_at: new Date('2026-07-28T09:00:00.000Z'),
            supplier_id: 'sup-1',
            supplier: { name: 'Fresh Farms' },
            ...over,
        },
    });

    it('reports the unit cost, not the freight-loaded line total', () => {
        const mapped = mapPurchaseItemToRateRow(purchaseItem());
        expect(mapped.rate).toBe(48.25);
        expect(mapped.lineTotal).toBe(482.5);
        expect(mapped.partyName).toBe('Fresh Farms');
        expect(mapped.documentNumber).toBe('PUR-0004');
    });

    it('leaves a supplier-less purchase unlabelled', () => {
        const mapped = mapPurchaseItemToRateRow(purchaseItem({ supplier_id: null, supplier: null }));
        expect(mapped.partyId).toBeNull();
        expect(mapped.partyName).toBeNull();
    });
});

describe('summariseRates', () => {
    it('has nothing to say about a product that has never traded', () => {
        expect(summariseRates([])).toBeNull();
    });

    it('summarises only the rows the caller is about to show', () => {
        const summary = summariseRates([
            row({ rate: 100, date: '2026-08-12T00:00:00.000Z' }),
            row({ rate: 130, date: '2026-08-03T00:00:00.000Z' }),
            row({ rate: 120, date: '2026-07-28T00:00:00.000Z' }),
        ]);

        expect(summary).toEqual({
            lastRate: 100,
            avgRate: 350 / 3,
            minRate: 100,
            maxRate: 130,
        });
    });

    it('takes lastRate from the newest row, not the first in the array', () => {
        // The party section leads the list, so row order is not date order.
        const summary = summariseRates([
            row({ rate: 90, date: '2026-06-01T00:00:00.000Z' }),
            row({ rate: 150, date: '2026-08-20T00:00:00.000Z' }),
        ]);

        expect(summary?.lastRate).toBe(150);
    });
});
