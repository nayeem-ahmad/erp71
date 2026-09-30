import { BadRequestException, ConflictException } from '@nestjs/common';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { getProviderDefinition } from '../provider-adapter';
import { ExternalSyncSnapshotService } from './snapshot.service';
import { SNAPSHOT_FORMAT_VERSION } from './snapshot.types';
import { readSnapshotFile, writeSnapshotFile } from './snapshot-file';
import type { SnapshotDocument } from './snapshot.types';

jest.mock('../provider-adapter', () => ({
    getProviderDefinition: jest.fn(),
    DEFAULT_PROVIDER: 'EXPRESS_RETAIL_PRO',
}));

const mockedGetDef = getProviderDefinition as jest.Mock;

const CONNECTION = {
    id: 'conn-1',
    tenant_id: 'tenant-1',
    provider: 'EXPRESS_RETAIL_PRO',
    base_url: 'https://example.test',
    username: 'user',
    password_encrypted: 'cipher',
    external_org_id: 'org-9',
    window_days: 90,
    history_start_date: null,
};

const SNAPSHOT = {
    id: 'snap-1',
    tenant_id: 'tenant-1',
    connection_id: 'conn-1',
    status: 'EXTRACTING',
    window_from: new Date('2026-01-01T00:00:00.000Z'),
    window_to: new Date('2026-01-31T00:00:00.000Z'),
    cancel_requested: false,
    connection: CONNECTION,
};

function makeClient(overrides: Record<string, jest.Mock> = {}) {
    return {
        login: jest.fn().mockResolvedValue({
            organizationId: 'org-9',
            user: { name: 'a', username: 'a', role: 'OWNER' },
        }),
        fetchProducts: jest.fn().mockResolvedValue([{ id: 1 }]),
        fetchCustomers: jest.fn().mockResolvedValue([]),
        fetchSuppliers: jest.fn().mockResolvedValue([]),
        fetchSaleDocuments: jest.fn().mockResolvedValue([]),
        fetchPurchaseDocuments: jest.fn().mockResolvedValue([]),
        fetchPayments: jest.fn().mockResolvedValue([]),
        fetchSaleReturnDocuments: jest.fn().mockResolvedValue([]),
        ...overrides,
    };
}

function makeDb() {
    return {
        externalSyncConnection: {
            findUnique: jest.fn().mockResolvedValue(CONNECTION),
        },
        externalSyncSnapshot: {
            findFirst: jest.fn().mockResolvedValue(null),
            findUnique: jest.fn().mockResolvedValue(SNAPSHOT),
            findMany: jest.fn().mockResolvedValue([]),
            create: jest.fn().mockResolvedValue(SNAPSHOT),
            update: jest.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) =>
                Promise.resolve({ ...SNAPSHOT, ...data }),
            ),
            delete: jest.fn().mockResolvedValue({}),
        },
        externalSyncRun: {
            findFirst: jest.fn().mockResolvedValue(null),
        },
    };
}

describe('ExternalSyncSnapshotService', () => {
    let db: ReturnType<typeof makeDb>;
    let service: ExternalSyncSnapshotService;
    let client: ReturnType<typeof makeClient>;
    let tmp: string;

    beforeEach(async () => {
        tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'snap-svc-'));
        process.env.EXTERNAL_SYNC_SNAPSHOT_DIR = tmp;
        db = makeDb();
        client = makeClient();
        mockedGetDef.mockReturnValue({
            provider: 'EXPRESS_RETAIL_PRO',
            label: 'Express Retail Pro',
            planWindows: () => [{ from: '2026-01-01', to: '2026-01-31' }],
            createClient: () => client,
        });
        service = new ExternalSyncSnapshotService(db as any, { decrypt: jest.fn().mockReturnValue('secret') } as any);
    });

    it('reaches READY only after the gzip exists and has matching counts', async () => {
        await service.executeExtract('snap-1');
        const dest = path.join(tmp, 'tenant-1', 'snap-1.json.gz');
        const doc = await readSnapshotFile(dest);
        expect(doc.products).toEqual([{ id: 1 }]);
        expect(doc.manifest.counts.products).toBe(1);
        const ready = db.externalSyncSnapshot.update.mock.calls.find(
            (call) => call[0].data.status === 'READY',
        );
        expect(ready).toBeTruthy();
    });

    it('rewrites phase as collections complete', async () => {
        await service.executeExtract('snap-1');
        const phases = db.externalSyncSnapshot.update.mock.calls
            .map((call) => call[0].data.phase)
            .filter((phase): phase is string => typeof phase === 'string' && phase.length > 0);
        expect(phases).toEqual(
            expect.arrayContaining(['Products', 'Customers', 'Suppliers', 'Sales', 'Purchases']),
        );
        const withProgress = db.externalSyncSnapshot.update.mock.calls.find(
            (call) => call[0].data.progress && call[0].data.phase === 'Products',
        );
        expect(withProgress?.[0].data.progress).toEqual({ done: 1, total: 8 });
    });

    it('marks FAILED and deletes the file when fetchProducts throws', async () => {
        client.fetchProducts.mockRejectedValue(new Error('provider down'));
        await expect(service.executeExtract('snap-1')).rejects.toThrow(/provider down/);
        const failed = db.externalSyncSnapshot.update.mock.calls.find(
            (call) => call[0].data.status === 'FAILED',
        );
        expect(failed).toBeTruthy();
        await expect(fs.stat(path.join(tmp, 'tenant-1', 'snap-1.json.gz'))).rejects.toMatchObject({
            code: 'ENOENT',
        });
    });

    it('honours cancel_requested between collections', async () => {
        db.externalSyncSnapshot.findUnique
            .mockResolvedValueOnce(SNAPSHOT)
            .mockResolvedValue({ ...SNAPSHOT, cancel_requested: true });
        await service.executeExtract('snap-1');
        const failed = db.externalSyncSnapshot.update.mock.calls.find(
            (call) => call[0].data.status === 'FAILED',
        );
        expect(failed).toBeTruthy();
        expect(client.fetchCustomers).not.toHaveBeenCalled();
    });

    it('refuses a second extract while one is EXTRACTING', async () => {
        db.externalSyncSnapshot.findFirst.mockResolvedValue({
            id: 'other',
            created_at: new Date('2026-09-30T00:00:00.000Z'),
        });
        await expect(
            service.startExtract('tenant-1', { dateFrom: '2026-01-01', dateTo: '2026-01-31' }, 'u1'),
        ).rejects.toBeInstanceOf(ConflictException);
        expect(db.externalSyncSnapshot.create).not.toHaveBeenCalled();
    });

    it('refuses an extract while a run is RUNNING', async () => {
        db.externalSyncRun.findFirst.mockResolvedValue({
            id: 'run-1',
            started_at: new Date('2026-09-30T00:00:00.000Z'),
        });
        await expect(
            service.startExtract('tenant-1', { dateFrom: '2026-01-01', dateTo: '2026-01-31' }, 'u1'),
        ).rejects.toBeInstanceOf(ConflictException);
        expect(db.externalSyncSnapshot.create).not.toHaveBeenCalled();
    });
});

function sampleDoc(overrides: Partial<SnapshotDocument['manifest']> = {}): SnapshotDocument {
    return {
        formatVersion: SNAPSHOT_FORMAT_VERSION,
        manifest: {
            formatVersion: SNAPSHOT_FORMAT_VERSION,
            tenantId: 'tenant-1',
            connectionId: 'conn-1',
            provider: 'EXPRESS_RETAIL_PRO',
            externalOrgId: 'org-9',
            windowFrom: '2026-01-01',
            windowTo: '2026-01-31',
            extractedAt: '2026-09-30T00:00:00.000Z',
            counts: {
                products: 1, customers: 0, suppliers: 0, sales: 0,
                purchases: 0, customerPayments: 0, supplierPayments: 0, saleReturns: 0,
            },
            sha256: '',
            ...overrides,
        },
        products: [{ id: 1 }],
        customers: [],
        suppliers: [],
        sales: [],
        purchases: [],
        customerPayments: [],
        supplierPayments: [],
        saleReturns: [],
    };
}

async function gzipOf(doc: SnapshotDocument): Promise<Buffer> {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'snap-up-'));
    const dest = path.join(dir, 'x.json.gz');
    await writeSnapshotFile(dest, doc);
    return fs.readFile(dest);
}

describe('ExternalSyncSnapshotService upload/download/delete', () => {
    let db: ReturnType<typeof makeDb>;
    let service: ExternalSyncSnapshotService;
    let tmp: string;

    beforeEach(async () => {
        tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'snap-up-svc-'));
        process.env.EXTERNAL_SYNC_SNAPSHOT_DIR = tmp;
        db = makeDb();
        mockedGetDef.mockReturnValue({
            provider: 'EXPRESS_RETAIL_PRO',
            label: 'Express Retail Pro',
            planWindows: () => [{ from: '2026-01-01', to: '2026-01-31' }],
            createClient: () => makeClient(),
        });
        db.externalSyncSnapshot.create.mockResolvedValue({
            ...SNAPSHOT,
            id: 'snap-up-1',
            status: 'READY',
        });
        service = new ExternalSyncSnapshotService(db as any, { decrypt: jest.fn() } as any);
    });

    it('rejects an upload whose manifest tenantId disagrees', async () => {
        const buf = await gzipOf(sampleDoc({ tenantId: 'other-tenant' }));
        await expect(service.uploadSnapshot('tenant-1', undefined, buf)).rejects.toBeInstanceOf(BadRequestException);
        expect(db.externalSyncSnapshot.create).not.toHaveBeenCalled();
    });

    it('rejects an upload whose provider disagrees with the connection', async () => {
        const buf = await gzipOf(sampleDoc({ provider: 'DIZI_CASHIER' }));
        await expect(service.uploadSnapshot('tenant-1', undefined, buf)).rejects.toBeInstanceOf(BadRequestException);
        expect(db.externalSyncSnapshot.create).not.toHaveBeenCalled();
    });

    it('rejects an upload whose externalOrgId disagrees', async () => {
        const buf = await gzipOf(sampleDoc({ externalOrgId: 'org-other' }));
        await expect(service.uploadSnapshot('tenant-1', undefined, buf)).rejects.toBeInstanceOf(BadRequestException);
        expect(db.externalSyncSnapshot.create).not.toHaveBeenCalled();
    });

    it('creates a READY row for a valid gzip', async () => {
        const buf = await gzipOf(sampleDoc());
        const row = await service.uploadSnapshot('tenant-1', undefined, buf);
        expect(row.status).toBe('READY');
        expect(db.externalSyncSnapshot.create).toHaveBeenCalled();
        const stored = await readSnapshotFile(path.join(tmp, 'tenant-1', 'snap-up-1.json.gz'));
        expect(stored.products).toEqual([{ id: 1 }]);
    });

    it('deletes the READY row when the gzip cannot be stored on the snapshot volume', async () => {
        const buf = await gzipOf(sampleDoc());
        await fs.writeFile(path.join(tmp, 'tenant-1'), 'not a directory');
        await expect(service.uploadSnapshot('tenant-1', undefined, buf)).rejects.toThrow();
        expect(db.externalSyncSnapshot.delete).toHaveBeenCalledWith({ where: { id: 'snap-up-1' } });
    });

    it('openFile throws when the gzip is missing on disk', async () => {
        db.externalSyncSnapshot.findFirst.mockResolvedValue({
            ...SNAPSHOT,
            status: 'READY',
            window_from: new Date('2026-01-01T00:00:00.000Z'),
            window_to: new Date('2026-01-31T00:00:00.000Z'),
            connection: CONNECTION,
        });
        await expect(service.openFile('tenant-1', 'snap-1')).rejects.toThrow(/missing/i);
    });

    it('deleteSnapshot refuses EXTRACTING', async () => {
        db.externalSyncSnapshot.findFirst.mockResolvedValue({ ...SNAPSHOT, status: 'EXTRACTING' });
        await expect(service.deleteSnapshot('tenant-1', 'snap-1')).rejects.toBeInstanceOf(ConflictException);
    });

    it('deleteConnection removes the gzip files', async () => {
        const dest = path.join(tmp, 'tenant-1', 'snap-1.json.gz');
        await fs.mkdir(path.dirname(dest), { recursive: true });
        await writeSnapshotFile(dest, sampleDoc());
        db.externalSyncSnapshot.findMany.mockResolvedValue([{ id: 'snap-1', tenant_id: 'tenant-1' }]);
        await service.removeFilesForConnection('tenant-1', 'conn-1');
        await expect(fs.stat(dest)).rejects.toMatchObject({ code: 'ENOENT' });
    });
});
