import { ConflictException } from '@nestjs/common';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { getProviderDefinition } from '../provider-adapter';
import { ExternalSyncSnapshotService } from './snapshot.service';
import { readSnapshotFile } from './snapshot-file';

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
