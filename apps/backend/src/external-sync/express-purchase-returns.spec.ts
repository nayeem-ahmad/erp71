import { ExpressRetailClient } from './express-retail.client';
import { mapPurchaseReturn, type SyncWarning } from './external-sync.mapper';
import { ExternalSyncService } from './external-sync.service';
import { DIZI_CASHIER_DEFINITION, EXPRESS_RETAIL_DEFINITION } from './provider-adapter';
import { SnapshotClient } from './snapshot/snapshot-client';
import { assertCounts, countsOf } from './snapshot/snapshot-file';

/**
 * Express Retail purchase returns: `/get-purchase-return` with recordType
 * 'with' embeds each return's lines and its parent purchase. Shaped from real
 * rows, names dropped.
 */

const RETURN: any = {
    id: 1704,
    invoice: '2601323',
    supplier_id: '5658',
    date: '2026-09-01',
    amount: '900.000',
    description: 'damaged in transit',
    status: 'a',
    organization_id: '262',
    updated_at: '2026-09-01T13:14:25.000000Z',
    purchase: {
        id: 135627,
        invoice: '2601323',
        supplier_id: '5658',
        supplier_type: 'retail',
        supplier: { id: 5658, code: 'S00012', name: 'Some Supplier', phone: '01700000000' },
    },
    purchase_return_details: [
        { id: 2834, purchase_return_id: '1704', product_id: '98585', quantity: '1.00', unit_price: '450.00', amount: '450.000' },
        { id: 2835, purchase_return_id: '1704', product_id: '98586', quantity: '1.00', unit_price: '450.00', amount: '450.000' },
    ],
};

/** A return from Express's walk-in "Cash Supplier": no supplier of its own. */
const CASH_RETURN: any = {
    ...RETURN,
    id: 1705,
    supplier_id: null,
    purchase: { id: 135628, invoice: '2601324', supplier_id: null, supplier_type: 'G', supplier_name: 'Cash Supplier', supplier: null },
};

describe('ExpressRetailClient.fetchPurchaseReturns', () => {
    afterEach(() => {
        jest.restoreAllMocks();
        delete (global as any).fetch;
    });

    it("asks for the returns with their lines ('with') over the window", async () => {
        const calls: any[] = [];
        (global as any).fetch = jest.fn(async (url: string, init: any) => {
            calls.push({ url, init });
            const body = calls.length === 2
                ? { status: true, data: { id: 1, username: 'u', name: 'U', organization_id: '262', role: 'admin' } }
                : { status: true, data: { purchasereturns: [RETURN] } };
            return { status: 200, ok: true, text: async () => JSON.stringify(body), headers: { getSetCookie: () => ['XSRF-TOKEN=x; Path=/'], get: () => null } };
        });

        const client = new ExpressRetailClient({ baseUrl: 'https://erp.example.com', username: 'u', password: 'p' });
        await client.login();
        const rows = await client.fetchPurchaseReturns({ from: '2026-09-01', to: '2026-09-30' });

        expect(rows).toEqual([RETURN]);
        expect(calls[2].url).toBe('https://erp.example.com/get-purchase-return');
        expect(JSON.parse(calls[2].init.body)).toEqual({ searchType: '', recordType: 'with', dateFrom: '2026-09-01', dateTo: '2026-09-30' });
    });
});

describe('mapPurchaseReturn (Express Retail)', () => {
    it('maps the return, its parent purchase, supplier and lines', () => {
        const warnings: SyncWarning[] = [];
        expect(mapPurchaseReturn(RETURN, 'XR-', warnings)).toEqual({
            externalId: '1704',
            returnNumber: 'XR-2601323',
            referenceNumber: '2601323',
            externalPurchaseId: '135627',
            externalSupplierId: '5658',
            embeddedSupplier: RETURN.purchase.supplier,
            totalAmount: 900,
            notes: 'damaged in transit',
            returnDate: new Date('2026-09-01T00:00:00.000Z'),
            externalUpdatedAt: new Date('2026-09-01T13:14:25.000Z'),
            items: [
                { externalProductId: '98585', quantity: 1, unitCost: 450, lineTotal: 450 },
                { externalProductId: '98586', quantity: 1, unitCost: 450, lineTotal: 450 },
            ],
        });
        expect(warnings).toEqual([]);
    });

    it("gives a return from Express's cash supplier no supplier", () => {
        const mapped = mapPurchaseReturn(CASH_RETURN, 'XR-', []);
        expect(mapped.externalSupplierId).toBeNull();
        expect(mapped.embeddedSupplier).toBeNull();
    });
});

describe('Express purchase returns through the provider and the snapshot', () => {
    afterEach(() => jest.restoreAllMocks());

    it('fetches through the provider client and maps through the definition', async () => {
        jest.spyOn(ExpressRetailClient.prototype, 'fetchPurchaseReturns').mockResolvedValue([RETURN]);
        const client = EXPRESS_RETAIL_DEFINITION.createClient({ baseUrl: 'https://erp.example.com', username: 'u', password: 'p' });

        const docs = await client.fetchPurchaseReturnDocuments!({ from: '2026-09-01', to: '2026-09-30' });
        expect(docs).toEqual([RETURN]);
        expect(EXPRESS_RETAIL_DEFINITION.mappers.purchaseReturn!(RETURN, 'XR-', [])).toEqual(mapPurchaseReturn(RETURN, 'XR-', []));
        // Dizi has no purchase-return import yet, so the step drops for it.
        expect(DIZI_CASHIER_DEFINITION.mappers.purchaseReturn).toBeUndefined();
    });

    it('counts them in a snapshot, and accepts a snapshot from before they were extracted', async () => {
        const lists = { products: [], customers: [], suppliers: [], sales: [], purchases: [], customerPayments: [], supplierPayments: [], saleReturns: [] };
        expect(countsOf({ ...lists, purchaseReturns: [RETURN] }).purchaseReturns).toBe(1);

        const old: any = { formatVersion: 1, manifest: { counts: countsOf(lists) }, ...lists };
        delete old.manifest.counts.purchaseReturns;
        expect(() => assertCounts(old)).not.toThrow();
        expect(await new SnapshotClient(old).fetchPurchaseReturnDocuments({ from: '2026-01-01', to: '2026-12-31' })).toEqual([]);
    });
});

const CONNECTION = {
    id: 'conn-1',
    tenant_id: 'tenant-1',
    store_id: 'store-1',
    provider: 'EXPRESS_RETAIL_PRO',
    document_prefix: 'XR-',
    post_impacts: false,
};

function emptyStats() {
    const tally = () => ({ created: 0, updated: 0, skipped: 0 });
    return {
        products: tally(), customers: tally(), suppliers: tally(), sales: tally(), purchases: tally(),
        customerPayments: tally(), supplierPayments: tally(), saleReturns: tally(), quotations: tally(), purchaseReturns: tally(),
    };
}

function makeDb(taken: string[] = []) {
    const db: any = {
        externalSyncMapping: {
            findMany: jest.fn(async () => []),
            upsert: jest.fn(async () => ({})),
            deleteMany: jest.fn(async () => ({ count: 0 })),
        },
        purchaseItem: {
            findMany: jest.fn(async () => [
                { id: 'pi-1', product_id: 'prod-a' },
                { id: 'pi-2', product_id: 'prod-b' },
            ]),
        },
        purchaseReturn: {
            findFirst: jest.fn(async ({ where }: any) => (taken.includes(where.return_number) ? { id: 'other' } : null)),
            create: jest.fn(async () => ({ id: 'ret-new' })),
        },
    };
    db.$transaction = jest.fn(async (run: (tx: any) => Promise<unknown>) => run(db));
    return db;
}

async function sync(db: any, docs: unknown[], maps: { purchases?: Map<string, string>; suppliers?: Map<string, string> } = {}) {
    const stats = emptyStats();
    const warnings: any[] = [];
    await (new ExternalSyncService(db, {} as any, {} as any) as any).syncPurchaseReturnsWindow(
        CONNECTION,
        { fetchPurchaseReturnDocuments: jest.fn(async () => docs) },
        { from: '2021-10-12', to: '2026-10-11' },
        new Map([['98585', 'prod-a'], ['98586', 'prod-b']]),
        maps.purchases ?? new Map([['135627', 'pur-1']]),
        maps.suppliers ?? new Map([['5658', 'sup-1']]),
        stats,
        warnings,
        false,
        EXPRESS_RETAIL_DEFINITION.mappers,
        new Date('2021-10-12T00:00:00.000Z'),
    );
    return { stats, warnings };
}

describe('importing purchase returns', () => {
    it('creates the return against its purchase and supplier, each line on its purchase line', async () => {
        const db = makeDb();
        const { stats, warnings } = await sync(db, [RETURN]);

        expect(db.purchaseReturn.create).toHaveBeenCalledWith({
            data: {
                tenant_id: 'tenant-1',
                store_id: 'store-1',
                purchase_id: 'pur-1',
                supplier_id: 'sup-1',
                return_number: 'XR-2601323',
                reference_number: '2601323',
                total_amount: 900,
                notes: 'damaged in transit',
                status: 'RECORDED',
                created_at: new Date('2026-09-01T00:00:00.000Z'),
                items: {
                    create: [
                        { purchase_item_id: 'pi-1', product_id: 'prod-a', quantity: 1, unit_cost: 450, line_total: 450 },
                        { purchase_item_id: 'pi-2', product_id: 'prod-b', quantity: 1, unit_cost: 450, line_total: 450 },
                    ],
                },
            },
            select: { id: true },
        });
        expect(db.externalSyncMapping.upsert.mock.calls[0][0].create).toMatchObject({ entity_type: 'PURCHASE_RETURN', external_id: '1704', internal_id: 'ret-new' });
        expect(stats.purchaseReturns).toEqual({ created: 1, updated: 0, skipped: 0 });
        expect(warnings).toEqual([]);
    });

    it('numbers a second return against the same purchase with a suffix', async () => {
        const db = makeDb(['XR-2601323']);
        const { warnings } = await sync(db, [RETURN]);

        expect(db.purchaseReturn.create.mock.calls[0][0].data.return_number).toBe('XR-2601323-2');
        expect(warnings.map((w) => w.code)).toEqual(['NUMBER_TAKEN']);
    });

    it('imports without a parent purchase it cannot find, and says so', async () => {
        const db = makeDb();
        const { warnings } = await sync(db, [RETURN], { purchases: new Map() });

        const data = db.purchaseReturn.create.mock.calls[0][0].data;
        expect(data.purchase_id).toBeNull();
        expect(data.items.create.map((i: any) => i.purchase_item_id)).toEqual([null, null]);
        expect(warnings.map((w) => w.code)).toEqual(['PARENT_PURCHASE_UNRESOLVED']);
    });

    it("skips, with the details, a return whose product was never imported", async () => {
        const db = makeDb();
        const odd = { ...RETURN, purchase_return_details: [{ ...RETURN.purchase_return_details[0], product_id: 'gone' }] };
        const { stats, warnings } = await sync(db, [odd]);

        expect(db.purchaseReturn.create).not.toHaveBeenCalled();
        expect(stats.purchaseReturns.skipped).toBe(1);
        expect(warnings[0]).toMatchObject({
            code: 'RETURN_LINE_UNMATCHED',
            skipped: { number: '2601323', date: '2026-09-01', party: 'S00012 Some Supplier', amount: 900, lines: 1 },
        });
    });
});
