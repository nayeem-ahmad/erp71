import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import {
    SNAPSHOT_FORMAT_VERSION,
    assertSafeId,
    snapshotFilePath,
    withChecksum,
    assertChecksum,
    assertCounts,
    assertFormatVersion,
    writeSnapshotFile,
    readSnapshotFile,
} from './snapshot-file';
import type { SnapshotDocument } from './snapshot.types';

function sample(overrides: Partial<SnapshotDocument> = {}): SnapshotDocument {
    const base: SnapshotDocument = {
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
                products: 1, customers: 0, suppliers: 0, sales: 1,
                purchases: 0, customerPayments: 0, supplierPayments: 0, saleReturns: 0,
            },
            sha256: '',
        },
        products: [{ id: 1, name: 'Napa 500mg' }],
        customers: [],
        suppliers: [],
        sales: [{ header: { id: 10 }, lines: [{ product_id: 1, quantity: 2 }] }],
        purchases: [],
        customerPayments: [],
        supplierPayments: [],
        saleReturns: [],
    };
    return { ...base, ...overrides, manifest: { ...base.manifest, ...(overrides.manifest ?? {}) } };
}

describe('assertSafeId', () => {
    it('rejects path traversal', () => {
        expect(() => assertSafeId('snapshotId', '../etc/passwd')).toThrow(/invalid/i);
        expect(() => assertSafeId('tenantId', 'tenant/../../x')).toThrow(/invalid/i);
    });
    it('accepts uuid-shaped ids', () => {
        expect(assertSafeId('snapshotId', 'a1b2c3d4-e5f6-7890-abcd-ef1234567890')).toBe(
            'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
        );
    });
});

describe('snapshotFilePath', () => {
    it('never calls through a dotted id', () => {
        expect(() => snapshotFilePath('tenant-1', '..')).toThrow(/invalid/i);
    });
});

describe('checksum and counts', () => {
    it('round-trips a gzip file with equal collections', async () => {
        const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'snap-'));
        process.env.EXTERNAL_SYNC_SNAPSHOT_DIR = dir;
        const dest = path.join(dir, 'tenant-1', 'snap-1.json.gz');
        await fs.mkdir(path.dirname(dest), { recursive: true });
        const written = await writeSnapshotFile(dest, sample());
        const read = await readSnapshotFile(dest);
        expect(read.products).toEqual([{ id: 1, name: 'Napa 500mg' }]);
        expect(read.sales[0]).toEqual({ header: { id: 10 }, lines: [{ product_id: 1, quantity: 2 }] });
        expect(read.manifest.sha256).toBe(written.sha256);
        assertChecksum(read);
        assertCounts(read);
        assertFormatVersion(read);
        await expect(fs.stat(dest + '.tmp')).rejects.toMatchObject({ code: 'ENOENT' });
    });

    it('leaves no READY file when the write throws after creating the temp', async () => {
        const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'snap-'));
        const blocker = path.join(dir, 'blocker');
        await fs.writeFile(blocker, 'not a dir');
        await expect(writeSnapshotFile(path.join(blocker, 'snap-1.json.gz'), sample())).rejects.toThrow();
        const leftovers = await fs.readdir(dir);
        expect(leftovers.some((name) => name.endsWith('.json.gz'))).toBe(false);
    });

    it('rejects a tampered checksum', () => {
        const doc = withChecksum(sample());
        doc.manifest.sha256 = '0'.repeat(64);
        expect(() => assertChecksum(doc)).toThrow(/checksum/i);
    });

    it('rejects a counts mismatch', () => {
        const doc = sample();
        doc.manifest.counts.products = 99;
        expect(() => assertCounts(doc)).toThrow(/count/i);
    });

    it('rejects an unknown formatVersion', () => {
        const doc = sample();
        (doc as { formatVersion: number }).formatVersion = 2;
        expect(() => assertFormatVersion(doc)).toThrow(/format/i);
    });
});
