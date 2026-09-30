import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { clientForRun } from './client-for-run';
import { writeSnapshotFile } from './snapshot-file';
import { SNAPSHOT_FORMAT_VERSION } from './snapshot.types';
import type { SnapshotDocument } from './snapshot.types';

function sample(): SnapshotDocument {
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
                products: 1,
                customers: 0,
                suppliers: 0,
                sales: 0,
                purchases: 0,
                customerPayments: 0,
                supplierPayments: 0,
                saleReturns: 0,
            },
            sha256: '',
        },
        products: [{ id: 1, name: 'Napa 500mg' }],
        customers: [],
        suppliers: [],
        sales: [],
        purchases: [],
        customerPayments: [],
        supplierPayments: [],
        saleReturns: [],
    };
}

const CONNECTION = {
    id: 'conn-1',
    provider: 'EXPRESS_RETAIL_PRO',
    base_url: 'https://example.test',
    username: 'user',
    password_encrypted: 'cipher',
    external_org_id: 'org-9',
};

describe('clientForRun', () => {
    it('returns a SnapshotClient for a snapshot id and does not create a live client', async () => {
        const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cfr-'));
        process.env.EXTERNAL_SYNC_SNAPSHOT_DIR = dir;
        const dest = path.join(dir, 'tenant-1', 'snap-1.json.gz');
        await fs.mkdir(path.dirname(dest), { recursive: true });
        await writeSnapshotFile(dest, sample());

        const createLiveClient = jest.fn();
        const decrypt = jest.fn();
        const client = await clientForRun({
            snapshotId: 'snap-1',
            tenantId: 'tenant-1',
            connection: CONNECTION,
            decrypt,
            createLiveClient,
        });

        expect(createLiveClient).not.toHaveBeenCalled();
        expect(decrypt).not.toHaveBeenCalled();
        expect((await client.login()).organizationId).toBe('org-9');
        expect(await client.fetchProducts()).toEqual([{ id: 1, name: 'Napa 500mg' }]);
    });

    it('throws when the snapshot file is missing and does not create a live client', async () => {
        const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cfr-'));
        process.env.EXTERNAL_SYNC_SNAPSHOT_DIR = dir;
        const createLiveClient = jest.fn();

        await expect(
            clientForRun({
                snapshotId: 'snap-1',
                tenantId: 'tenant-1',
                connection: CONNECTION,
                decrypt: jest.fn(),
                createLiveClient,
            }),
        ).rejects.toThrow();
        expect(createLiveClient).not.toHaveBeenCalled();
    });

    it('creates a live client when snapshotId is null', async () => {
        const live = { login: jest.fn() };
        const createLiveClient = jest.fn().mockReturnValue(live);
        const decrypt = jest.fn().mockReturnValue('secret');

        const client = await clientForRun({
            snapshotId: null,
            tenantId: 'tenant-1',
            connection: CONNECTION,
            decrypt,
            createLiveClient,
        });

        expect(decrypt).toHaveBeenCalledWith('cipher');
        expect(createLiveClient).toHaveBeenCalledWith({
            baseUrl: 'https://example.test',
            username: 'user',
            password: 'secret',
        });
        expect(client).toBe(live);
    });
});
