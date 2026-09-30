import { SnapshotClient } from './snapshot-client';
import { SNAPSHOT_FORMAT_VERSION } from './snapshot.types';
import type { SnapshotDocument } from './snapshot.types';

const doc: SnapshotDocument = {
    formatVersion: SNAPSHOT_FORMAT_VERSION,
    manifest: {
        formatVersion: SNAPSHOT_FORMAT_VERSION,
        tenantId: 't1',
        connectionId: 'c1',
        provider: 'DIZI_CASHIER',
        externalOrgId: 'org-dizi',
        windowFrom: '2026-01-01',
        windowTo: '2026-03-31',
        extractedAt: '2026-09-30T00:00:00.000Z',
        counts: {
            products: 1, customers: 0, suppliers: 0, sales: 1,
            purchases: 0, customerPayments: 2, supplierPayments: 1, saleReturns: 0,
        },
        sha256: 'x',
    },
    products: [{ id: 'p' }],
    customers: [],
    suppliers: [],
    sales: [{ header: { id: 's' }, lines: [] }],
    purchases: [],
    customerPayments: [{ id: 'cp-1' }, { id: 'cp-2' }],
    supplierPayments: [{ id: 'sp-1' }],
    saleReturns: [],
};

describe('SnapshotClient', () => {
    const client = new SnapshotClient(doc);
    const window = { from: '2020-01-01', to: '2020-01-02' };

    it('logs in as the manifest org, ignoring the window the caller passes', async () => {
        const session = await client.login();
        expect(session.organizationId).toBe('org-dizi');
        expect(await client.fetchSaleDocuments(window)).toEqual(doc.sales);
        expect(await client.fetchProducts()).toEqual(doc.products);
    });

    it('splits payments by party', async () => {
        expect(await client.fetchPayments(window, 'CUSTOMER')).toHaveLength(2);
        expect(await client.fetchPayments(window, 'SUPPLIER')).toHaveLength(1);
    });
});
