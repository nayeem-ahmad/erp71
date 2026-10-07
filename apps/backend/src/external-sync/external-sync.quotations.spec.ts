import { ExternalSyncService } from './external-sync.service';
import { DIZI_CASHIER_DEFINITION } from './provider-adapter';
import { SnapshotClient } from './snapshot/snapshot-client';
import { SNAPSHOT_FORMAT_VERSION, assertCounts, countsOf } from './snapshot/snapshot-file';
import type { SnapshotDocument } from './snapshot/snapshot.types';

/**
 * Quotations are the one imported document that never posts, so the tests
 * here are about what can still go wrong without a ledger: a provider that
 * refuses them, a re-pull over one the tenant has already acted on, and
 * snapshots written before quotations existed.
 */

const CONNECTION = { id: 'conn-1', tenant_id: 'tenant-1', store_id: 'store-1', document_prefix: 'DZ-' };

const DOC = {
    header: { Id: 'q-1', QuotationNo: 'QT-1', TransactionDate: '2026-08-14', TraderId: 'cust-ext', TotalAmount: 750 },
    detail: {
        Id: 'q-1',
        Status: 'Accepted',
        SaleQuotationItems: [
            { ItemId: 'item-ext', Quantity: 3, PricePerUnit: 250 },
            { ItemId: 'deleted-item', Quantity: 1, PricePerUnit: 99 },
        ],
    },
};

function emptyStats() {
    const tally = () => ({ created: 0, updated: 0, skipped: 0 });
    return {
        products: tally(),
        customers: tally(),
        suppliers: tally(),
        sales: tally(),
        purchases: tally(),
        customerPayments: tally(),
        supplierPayments: tally(),
        saleReturns: tally(),
        quotations: tally(),
    };
}

function makeDb(opts: { mapped?: string; localStatus?: string | null } = {}) {
    const tx = {
        quotation: { update: jest.fn(async () => ({})) },
        quotationItem: { deleteMany: jest.fn(async () => ({})), createMany: jest.fn(async () => ({})) },
    };
    return {
        tx,
        externalSyncMapping: {
            findMany: jest.fn(async () => (opts.mapped ? [{ external_id: 'q-1', internal_id: opts.mapped }] : [])),
            deleteMany: jest.fn(async () => ({ count: 1 })),
            upsert: jest.fn(async () => ({})),
        },
        quotation: {
            findFirst: jest.fn(async () => (opts.localStatus ? { status: opts.localStatus } : null)),
            create: jest.fn(async () => ({ id: 'quote-new' })),
        },
        $transaction: jest.fn(async (fn: (t: unknown) => unknown) => fn(tx)),
    } as any;
}

const productMap = new Map([['item-ext', 'prod-1']]);
const customerMap = new Map([['cust-ext', 'cust-1']]);

async function sync(db: any, client: any, dryRun = false) {
    const service = new ExternalSyncService(db, {} as any, {} as any);
    const stats = emptyStats();
    const warnings: any[] = [];
    await (service as any).syncQuotationsWindow(
        CONNECTION,
        client,
        { from: '2026-01-01', to: '2026-12-31' },
        productMap,
        customerMap,
        stats,
        warnings,
        dryRun,
        DIZI_CASHIER_DEFINITION.mappers,
    );
    return { stats, warnings };
}

const clientWith = (docs: unknown[]) => ({ fetchQuotationDocuments: jest.fn(async () => docs) });

describe('external-sync quotations', () => {
    it('creates the quotation with its customer, lines, date and status, and maps it', async () => {
        const db = makeDb();
        const { stats, warnings } = await sync(db, clientWith([DOC]));

        expect(db.quotation.create).toHaveBeenCalledWith({
            data: {
                tenant_id: 'tenant-1',
                store_id: 'store-1',
                quote_number: 'DZ-QT-1',
                created_at: new Date('2026-08-14T00:00:00.000Z'),
                customer_id: 'cust-1',
                total_amount: 750,
                status: 'ACCEPTED',
                valid_until: null,
                notes: null,
                items: { create: [{ product_id: 'prod-1', quantity: 3, unit_price: 250 }] },
            },
            select: { id: true },
        });
        expect(db.externalSyncMapping.upsert.mock.calls[0][0].create).toMatchObject({
            entity_type: 'QUOTATION',
            external_id: 'q-1',
            internal_id: 'quote-new',
        });
        expect(stats.quotations).toEqual({ created: 1, updated: 0, skipped: 0 });
        // The line for a product Dizi no longer lists is dropped, with a reason.
        expect(warnings.map((w) => w.code)).toEqual(['PRODUCT_UNRESOLVED']);
    });

    it('imports without a customer when the customer was not imported', async () => {
        const db = makeDb();
        const doc = { ...DOC, header: { ...DOC.header, TraderId: 'unknown' } };
        const { warnings } = await sync(db, clientWith([doc]));

        expect(db.quotation.create.mock.calls[0][0].data.customer_id).toBeNull();
        expect(warnings.map((w) => w.code)).toContain('CUSTOMER_UNRESOLVED');
    });

    it('rewrites an open quotation on a re-pull', async () => {
        const db = makeDb({ mapped: 'quote-1', localStatus: 'SENT' });
        const { stats } = await sync(db, clientWith([DOC]));

        expect(db.quotation.create).not.toHaveBeenCalled();
        expect(db.tx.quotation.update).toHaveBeenCalledWith({
            where: { id: 'quote-1' },
            data: expect.objectContaining({ status: 'ACCEPTED', total_amount: 750 }),
        });
        expect(db.tx.quotationItem.deleteMany).toHaveBeenCalledWith({ where: { quotation_id: 'quote-1' } });
        expect(db.tx.quotationItem.createMany).toHaveBeenCalledWith({
            data: [{ product_id: 'prod-1', quantity: 3, unit_price: 250, quotation_id: 'quote-1' }],
        });
        expect(stats.quotations.updated).toBe(1);
    });

    it.each(['CONVERTED', 'REVISED'])('leaves a quotation already %s here untouched', async (localStatus) => {
        const db = makeDb({ mapped: 'quote-1', localStatus });
        const { stats, warnings } = await sync(db, clientWith([DOC]));

        expect(db.$transaction).not.toHaveBeenCalled();
        expect(stats.quotations.skipped).toBe(1);
        expect(warnings.map((w) => w.code)).toContain('QUOTATION_LOCKED');
    });

    it('re-imports when the mapped quotation was deleted', async () => {
        const db = makeDb({ mapped: 'gone', localStatus: null });
        const { stats, warnings } = await sync(db, clientWith([DOC]));

        expect(db.externalSyncMapping.deleteMany).toHaveBeenCalledWith({
            where: { connection_id: 'conn-1', entity_type: 'QUOTATION', external_id: 'q-1' },
        });
        expect(db.quotation.create).toHaveBeenCalled();
        expect(stats.quotations.created).toBe(1);
        expect(warnings.map((w) => w.code)).toContain('STALE_MAPPING_REPAIRED');
    });

    it('a dry run counts without writing', async () => {
        const db = makeDb();
        const { stats } = await sync(db, clientWith([DOC]), true);

        expect(db.quotation.create).not.toHaveBeenCalled();
        expect(stats.quotations.created).toBe(1);
    });

    it('a provider that refuses quotations costs a warning, not the run', async () => {
        const db = makeDb();
        const client = { fetchQuotationDocuments: jest.fn(async () => Promise.reject(new Error('quotation list not found'))) };

        const { stats, warnings } = await sync(db, client);

        expect(warnings).toEqual([
            expect.objectContaining({ code: 'QUOTATIONS_UNAVAILABLE', message: expect.stringContaining('quotation list not found') }),
        ]);
        expect(stats.quotations).toEqual({ created: 0, updated: 0, skipped: 0 });
    });
});

describe('external-sync quotations in a run', () => {
    function runDb(provider: string) {
        const connection = { ...CONNECTION, provider, external_org_id: 'org-1', post_impacts: false };
        return {
            externalSyncConnection: {
                findUnique: jest.fn(async () => connection),
                update: jest.fn(async () => connection),
            },
            externalSyncRun: {
                findUnique: jest.fn(async () => ({ cancel_requested: false })),
                update: jest.fn(async () => ({})),
            },
            externalSyncMapping: { findMany: jest.fn(async () => []) },
        } as any;
    }

    const liveClient = () => ({
        login: jest.fn(async () => ({ organizationId: 'org-1', user: {} })),
        fetchQuotationDocuments: jest.fn(async () => []),
    });

    async function execute(provider: string, client: any) {
        const db = runDb(provider);
        const service = new ExternalSyncService(db, { decrypt: () => 'pw' } as any, {} as any);
        const def = require('./provider-adapter').getProviderDefinition(provider);
        jest.spyOn(def, 'createClient').mockReturnValue(client);
        await service.executeRun('run-1', 'conn-1', { from: new Date('2026-01-01'), to: new Date('2026-01-31') }, false, ['QUOTATIONS']);
        return db;
    }

    afterEach(() => jest.restoreAllMocks());

    it('runs the step for Dizi', async () => {
        const client = liveClient();
        const db = await execute('DIZI_CASHIER', client);

        expect(client.fetchQuotationDocuments).toHaveBeenCalled();
        const final = db.externalSyncRun.update.mock.calls.at(-1)[0].data;
        expect(final.status).toBe('SUCCESS');
        expect(final.stats.quotations).toEqual({ created: 0, updated: 0, skipped: 0 });
    });

    it('drops the step for a provider without quotations instead of counting it', async () => {
        const client = liveClient();
        const db = await execute('EXPRESS_RETAIL_PRO', client);

        // Express has no quotation mapper, so even a client that could fetch is not asked.
        expect(client.fetchQuotationDocuments).not.toHaveBeenCalled();
        const progress = db.externalSyncRun.update.mock.calls.map((c: any) => c[0].data.progress).filter(Boolean);
        expect(progress).toEqual([]);
        expect(db.externalSyncRun.update.mock.calls.at(-1)[0].data.status).toBe('SUCCESS');
    });
});

describe('snapshots and quotations', () => {
    function snapshot(extra: Partial<SnapshotDocument> = {}): SnapshotDocument {
        const lists = {
            products: [], customers: [], suppliers: [], sales: [], purchases: [],
            customerPayments: [], supplierPayments: [], saleReturns: [],
        };
        const counts = countsOf({ ...lists, ...extra } as SnapshotDocument);
        return {
            formatVersion: SNAPSHOT_FORMAT_VERSION,
            manifest: {
                formatVersion: SNAPSHOT_FORMAT_VERSION,
                tenantId: 't', connectionId: 'c', provider: 'DIZI_CASHIER', externalOrgId: 'o',
                windowFrom: '2026-01-01', windowTo: '2026-01-31', extractedAt: '2026-01-31T00:00:00Z',
                counts, sha256: '',
            },
            ...lists,
            ...extra,
        };
    }

    it('still accepts a snapshot extracted before quotations existed', async () => {
        const old = snapshot();
        delete (old.manifest.counts as any).quotations;

        expect(() => assertCounts(old)).not.toThrow();
        await expect(new SnapshotClient(old).fetchQuotationDocuments({ from: '', to: '' })).resolves.toEqual([]);
    });

    it('checks the quotation count like any other', () => {
        const doc = snapshot({ quotations: [{}, {}] });
        doc.manifest.counts.quotations = 3;
        expect(() => assertCounts(doc)).toThrow(/quotations/);
    });

    it('replays an extract-time failure so the import can report it', async () => {
        const doc = snapshot({ quotations: [], quotationsError: 'quotation list not found' });
        await expect(new SnapshotClient(doc).fetchQuotationDocuments({ from: '', to: '' })).rejects.toThrow(
            'quotation list not found',
        );
    });
});
