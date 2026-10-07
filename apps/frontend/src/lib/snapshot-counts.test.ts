import { snapshotCountEntries } from './snapshot-counts';

describe('snapshotCountEntries', () => {
    it('lists everything the snapshot found, in import order', () => {
        const entries = snapshotCountEntries({
            products: 120,
            customers: 30,
            suppliers: 4,
            sales: 800,
            purchases: 50,
            customerPayments: 200,
            supplierPayments: 40,
            saleReturns: 3,
            quotations: 25,
        });

        expect(entries).toEqual([
            { key: 'products', label: 'products', count: 120 },
            { key: 'customers', label: 'customers', count: 30 },
            { key: 'suppliers', label: 'suppliers', count: 4 },
            { key: 'purchases', label: 'purchases', count: 50 },
            { key: 'sales', label: 'sales', count: 800 },
            { key: 'quotations', label: 'quotations', count: 25 },
            { key: 'customerPayments', label: 'customer payments', count: 200 },
            { key: 'supplierPayments', label: 'supplier payments', count: 40 },
            { key: 'saleReturns', label: 'sale returns', count: 3 },
        ]);
    });

    it('keeps zeros, which are a real answer', () => {
        const entries = snapshotCountEntries({ products: 1, quotations: 0 });
        expect(entries).toContainEqual({ key: 'quotations', label: 'quotations', count: 0 });
    });

    it('leaves out what a snapshot never counted, such as quotations on an older extract', () => {
        const entries = snapshotCountEntries({ products: 1, customers: 2 });
        expect(entries.map((entry) => entry.key)).toEqual(['products', 'customers']);
    });

    it('is empty without counts', () => {
        expect(snapshotCountEntries(null)).toEqual([]);
    });
});
