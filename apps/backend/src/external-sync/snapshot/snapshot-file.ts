import { createHash } from 'crypto';
import { promises as fs } from 'fs';
import * as path from 'path';
import { promisify } from 'util';
import { gunzip, gzip } from 'zlib';
import {
    SNAPSHOT_FORMAT_VERSION,
    type SnapshotCounts,
    type SnapshotDocument,
} from './snapshot.types';

export { SNAPSHOT_FORMAT_VERSION };

const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);

/** Ceiling on uncompressed snapshot JSON. A 100MB gzip can otherwise expand into process memory. */
export const DEFAULT_SNAPSHOT_GUNZIP_MAX_BYTES = 512 * 1024 * 1024;

export function gunzipSnapshot(
    compressed: Buffer,
    maxOutputLength = DEFAULT_SNAPSHOT_GUNZIP_MAX_BYTES,
): Promise<Buffer> {
    return gunzipAsync(compressed, { maxOutputLength }) as Promise<Buffer>;
}

const DEFAULT_SNAPSHOT_DIR = '/var/lib/erp71/external-sync-snapshots';
const SAFE_ID = /^[A-Za-z0-9_-]+$/;

export function snapshotRoot(): string {
    return process.env.EXTERNAL_SYNC_SNAPSHOT_DIR || DEFAULT_SNAPSHOT_DIR;
}

export function assertSafeId(label: string, value: string): string {
    if (!SAFE_ID.test(value)) {
        throw new Error(`Invalid ${label}`);
    }
    return value;
}

export function snapshotFilePath(tenantId: string, snapshotId: string): string {
    return path.join(
        snapshotRoot(),
        assertSafeId('tenantId', tenantId),
        `${assertSafeId('snapshotId', snapshotId)}.json.gz`,
    );
}

export function countsOf(
    doc: Pick<
        SnapshotDocument,
        | 'products'
        | 'customers'
        | 'suppliers'
        | 'sales'
        | 'purchases'
        | 'customerPayments'
        | 'supplierPayments'
        | 'saleReturns'
    >,
): SnapshotCounts {
    return {
        products: doc.products.length,
        customers: doc.customers.length,
        suppliers: doc.suppliers.length,
        sales: doc.sales.length,
        purchases: doc.purchases.length,
        customerPayments: doc.customerPayments.length,
        supplierPayments: doc.supplierPayments.length,
        saleReturns: doc.saleReturns.length,
    };
}

function checksumBytes(doc: SnapshotDocument): string {
    const clone: SnapshotDocument = {
        ...doc,
        manifest: { ...doc.manifest, sha256: '' },
    };
    return createHash('sha256').update(JSON.stringify(clone), 'utf8').digest('hex');
}

export function withChecksum(doc: SnapshotDocument): SnapshotDocument {
    const sha256 = checksumBytes(doc);
    return { ...doc, manifest: { ...doc.manifest, sha256 } };
}

export function assertChecksum(doc: SnapshotDocument): void {
    if (checksumBytes(doc) !== doc.manifest.sha256) {
        throw new Error('Snapshot checksum mismatch');
    }
}

export function assertCounts(doc: SnapshotDocument): void {
    const actual = countsOf(doc);
    const expected = doc.manifest.counts;
    const keys = Object.keys(actual) as (keyof SnapshotCounts)[];
    for (const key of keys) {
        if (actual[key] !== expected[key]) {
            throw new Error(`Snapshot count mismatch for ${key}: expected ${expected[key]}, got ${actual[key]}`);
        }
    }
}

export function assertFormatVersion(doc: SnapshotDocument): void {
    if (doc.formatVersion !== SNAPSHOT_FORMAT_VERSION || doc.manifest.formatVersion !== SNAPSHOT_FORMAT_VERSION) {
        throw new Error(`Unknown snapshot format version ${doc.formatVersion}`);
    }
}

export async function removeIfExists(absPath: string): Promise<void> {
    try {
        await fs.unlink(absPath);
    } catch (error: unknown) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
}

export async function writeSnapshotFile(
    absPath: string,
    doc: SnapshotDocument,
): Promise<{ byteSize: number; sha256: string }> {
    const signed = withChecksum(doc);
    const tmpPath = `${absPath}.tmp`;
    try {
        await fs.mkdir(path.dirname(absPath), { recursive: true });
        const compressed = await gzipAsync(Buffer.from(JSON.stringify(signed), 'utf8'));
        await fs.writeFile(tmpPath, compressed);
        await fs.rename(tmpPath, absPath);
        return { byteSize: compressed.length, sha256: signed.manifest.sha256 };
    } catch (error) {
        await removeIfExists(tmpPath);
        throw error;
    }
}

export async function writeSnapshotGzip(absPath: string, gzipBytes: Buffer): Promise<number> {
    const tmpPath = `${absPath}.tmp`;
    try {
        await fs.mkdir(path.dirname(absPath), { recursive: true });
        await fs.writeFile(tmpPath, gzipBytes);
        await fs.rename(tmpPath, absPath);
        return gzipBytes.length;
    } catch (error) {
        await removeIfExists(tmpPath);
        throw error;
    }
}

export async function readSnapshotBuffer(compressed: Buffer): Promise<SnapshotDocument> {
    const raw = await gunzipSnapshot(compressed);
    const doc = JSON.parse(raw.toString('utf8')) as SnapshotDocument;
    assertFormatVersion(doc);
    assertChecksum(doc);
    assertCounts(doc);
    return doc;
}

export async function readSnapshotFile(absPath: string): Promise<SnapshotDocument> {
    return readSnapshotBuffer(await fs.readFile(absPath));
}
