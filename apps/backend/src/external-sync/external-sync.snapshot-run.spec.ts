import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { ConflictException } from '@nestjs/common';
import { getProviderDefinition } from './provider-adapter';
import { ExternalSyncService } from './external-sync.service';

jest.mock('./provider-adapter', () => {
    const actual = jest.requireActual('./provider-adapter');
    return {
        ...actual,
        getProviderDefinition: jest.fn((provider: string) => actual.getProviderDefinition(provider)),
    };
});

const mockedGetDef = getProviderDefinition as jest.MockedFunction<typeof getProviderDefinition>;

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
    enabled: true,
};

const READY_SNAPSHOT = {
    id: 'snap-1',
    tenant_id: 'tenant-1',
    connection_id: 'conn-1',
    status: 'READY',
    window_from: new Date('2026-01-01T00:00:00.000Z'),
    window_to: new Date('2026-01-31T00:00:00.000Z'),
};

function makeDb() {
    const run = { id: 'run-1', snapshot_id: null, status: 'RUNNING' };
    return {
        externalSyncConnection: {
            findUnique: jest.fn().mockResolvedValue(CONNECTION),
            update: jest.fn().mockResolvedValue(CONNECTION),
        },
        externalSyncSnapshot: {
            findFirst: jest.fn().mockResolvedValue(READY_SNAPSHOT),
        },
        externalSyncRun: {
            findFirst: jest.fn().mockResolvedValue(null),
            findUnique: jest.fn().mockResolvedValue({ cancel_requested: false }),
            create: jest.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) =>
                Promise.resolve({ ...run, ...data }),
            ),
            update: jest.fn().mockResolvedValue({}),
        },
        externalSyncMapping: {
            findMany: jest.fn().mockResolvedValue([]),
        },
    };
}

describe('startRun snapshot vs live', () => {
    let db: ReturnType<typeof makeDb>;
    let service: ExternalSyncService;
    let createClient: jest.Mock;
    let snapshots: { assertNoInFlight: jest.Mock };

    beforeEach(() => {
        db = makeDb();
        createClient = jest.fn(() => {
            throw new Error('live client must not be created');
        });
        const actual = jest.requireActual('./provider-adapter');
        const def = actual.getProviderDefinition('EXPRESS_RETAIL_PRO');
        mockedGetDef.mockReturnValue({ ...def, createClient, planWindows: () => [{ from: '2026-01-01', to: '2026-01-31' }] });
        snapshots = { assertNoInFlight: jest.fn().mockResolvedValue(undefined) };
        service = new ExternalSyncService(db as any, { decrypt: jest.fn().mockReturnValue('secret') } as any, snapshots as any);
    });

    it('rejects a manual run without snapshotId and does not create a client', async () => {
        await expect(
            service.startRun('tenant-1', { provider: 'EXPRESS_RETAIL_PRO' }, 'MANUAL', 'u1'),
        ).rejects.toThrow(/snapshot/i);
        expect(createClient).not.toHaveBeenCalled();
        expect(db.externalSyncRun.create).not.toHaveBeenCalled();
    });

    it('refuses a scheduled run while an extract is in flight', async () => {
        snapshots.assertNoInFlight.mockRejectedValue(
            new ConflictException('An extract is already running (started 2026-09-30T00:00:00.000Z)'),
        );
        await expect(service.startRun('tenant-1', {}, 'SCHEDULED')).rejects.toBeInstanceOf(ConflictException);
        expect(db.externalSyncRun.create).not.toHaveBeenCalled();
        expect(createClient).not.toHaveBeenCalled();
    });

    it('a scheduled run without snapshotId still uses the live client', async () => {
        const live = {
            login: jest.fn().mockResolvedValue({
                organizationId: 'org-9',
                user: { name: 'a', username: 'a', role: 'OWNER' },
            }),
            fetchProducts: jest.fn().mockResolvedValue([]),
            fetchCustomers: jest.fn().mockResolvedValue([]),
            fetchSuppliers: jest.fn().mockResolvedValue([]),
            fetchSaleDocuments: jest.fn().mockResolvedValue([]),
            fetchPurchaseDocuments: jest.fn().mockResolvedValue([]),
            fetchPayments: jest.fn().mockResolvedValue([]),
            fetchSaleReturnDocuments: jest.fn().mockResolvedValue([]),
        };
        createClient.mockReturnValue(live);

        const run = await service.startRun('tenant-1', {}, 'SCHEDULED');
        expect(run.snapshot_id ?? null).toBeNull();
        expect(db.externalSyncRun.create).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({ trigger: 'SCHEDULED', snapshot_id: null }),
            }),
        );
    });

    it('a manual run with a READY snapshot never calls createClient', async () => {
        const run = await service.startRun('tenant-1', { snapshotId: 'snap-1' }, 'MANUAL', 'u1');
        expect(snapshots.assertNoInFlight).toHaveBeenCalledWith('conn-1');
        expect(createClient).not.toHaveBeenCalled();
        expect(db.externalSyncRun.create).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({
                    snapshot_id: 'snap-1',
                    window_from: READY_SNAPSHOT.window_from,
                    window_to: READY_SNAPSHOT.window_to,
                }),
            }),
        );
        expect(run.snapshot_id).toBe('snap-1');
    });

    it('a READY snapshot whose file is missing fails the run and does not createClient', async () => {
        const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'snap-run-'));
        process.env.EXTERNAL_SYNC_SNAPSHOT_DIR = dir;

        await (service as unknown as { executeRun: (...args: unknown[]) => Promise<void> }).executeRun(
            'run-1',
            'conn-1',
            { from: READY_SNAPSHOT.window_from, to: READY_SNAPSHOT.window_to },
            false,
            ['MASTERS'],
            'snap-1',
        );

        expect(createClient).not.toHaveBeenCalled();
        expect(db.externalSyncRun.update).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({
                    status: 'FAILED',
                    error_message: expect.stringMatching(/snapshot/i),
                }),
            }),
        );
    });
});
