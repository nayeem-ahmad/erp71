# External-Sync Snapshot Extract and In-App Match Review Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the Express/Dizi import into extract-to-snapshot, in-app match review, and write-from-file so a lost vendor login cannot strand a migration and unclear masters get a human choice before anything posts.

**Architecture:** New `snapshot/` helpers persist gzipped `ProviderClient` payloads on disk. A `SnapshotClient` implements `ProviderClient` over that file. Extract is its own job (`ExternalSyncSnapshot`). Match candidates and manual `executeRun` read the snapshot; scheduled runs keep the live client. The tenant and admin pages share one review panel.

**Tech Stack:** NestJS, Prisma, Node `zlib`/`fs`/`crypto` (no new backend deps), Jest; Next.js 15, existing `xlsx` workbook export, React Testing Library.

**Spec:** `docs/superpowers/specs/2026-09-30-external-sync-snapshot-and-in-app-match-design.md`

## Global Constraints

- Backend tests: from repo root `npx jest --testPathPatterns="src/external-sync/..." --workspace apps/backend`, or from `apps/backend` `npx jest src/external-sync/...`.
- Frontend tests: `npm test --workspace apps/frontend -- <file>`.
- After schema changes: `npx prisma generate --schema packages/database/prisma/schema.prisma`.
- **Do not add `xlsx` or any spreadsheet library to `apps/backend`.** Snapshots are gzipped JSON. The Excel workbook stays a browser-side optional export.
- New snapshot code lives under `apps/backend/src/external-sync/snapshot/`. Do not grow `external-sync.service.ts` (~2000 lines) except to choose live vs snapshot client and to call file cleanup on connection delete.
- Every snapshot query is scoped by `tenant_id`. File paths are derived from the DB row after that check; the client never supplies a filesystem path.
- Snapshot ids and tenant ids in file paths may only contain `[A-Za-z0-9_-]`. Anything else throws before `fs` is touched.
- Manual `startRun` requires `snapshotId`. Scheduled `startRun` without it keeps today’s live client.
- Match algorithm (`match/normalize.ts`, `blocking.ts`, `score.ts`, `candidates.ts`) is unchanged.
- UI: `PageShell` / `PageHeader` / `CompactSection`, `blue-600` accent only, no `rounded-2xl`/`rounded-3xl`, `text-sm`/`text-xs` body, ≥44px (`min-h-touch`) targets. Money via `formatBDT()`.
- Commit after each task. Branch is `dev` — never commit to `main`.
- Do not add `xlsx` to backend. Do not store snapshots in Cloudinary or in a Postgres JSON/bytea column.

## Review Focus

- A snapshot or tenant id containing `../` must throw before any `fs` call, so one tenant cannot read another’s file. Test in Task 1.
- A manual import without `snapshotId` must 400 and must not construct the live provider client. Test in Task 7.
- A scheduled import without `snapshotId` must still construct the live client (nightly regression). Test in Task 7.
- Confirm that sends only the medium rows (dropping auto-matched ones) must be rejected as a row-count mismatch and write zero mappings. Test in Task 6.
- A `READY` row whose gzip has been deleted from disk must fail the import hard, not fall through to a live pull. Test in Task 7.

---

## File Structure

| File | Responsibility |
|---|---|
| `snapshot/snapshot.types.ts` | **new** — `SnapshotDocument`, `SnapshotManifest`, `SnapshotCounts`, `SNAPSHOT_FORMAT_VERSION` |
| `snapshot/snapshot-file.ts` | **new** — path, checksum, gzip temp-then-rename, read, delete |
| `snapshot/snapshot-client.ts` | **new** — `ProviderClient` over a `SnapshotDocument` |
| `snapshot/snapshot.service.ts` | **new** — extract job, upload, download, list, cancel, delete, conflict checks |
| `snapshot/window.ts` | **new** — `resolveSyncWindow` (moved out of the service so extract and import share it) |
| `packages/database/prisma/schema.prisma` | **modify** — `ExternalSyncSnapshot`; `ExternalSyncRun.snapshot_id`; relations |
| `packages/database/prisma/migrations/20260930120000_add_external_sync_snapshot/` | **new** |
| `external-sync.match.dto.ts` | **modify** — `snapshotId` on the decisions manifest |
| `external-sync.match.service.ts` | **modify** — candidates from a snapshot; decisions check `snapshotId` |
| `external-sync.dto.ts` | **modify** — `CreateSnapshotDto`; `RunExternalSyncDto.snapshotId` |
| `external-sync.service.ts` | **modify** — manual run requires snapshot; `executeRun` uses `SnapshotClient`; window helper; delete cleans files |
| `external-sync.controller.ts` / `tenant-external-sync.controller.ts` | **modify** — snapshot routes; match-candidates takes `snapshotId` |
| `external-sync.module.ts` | **modify** — register `ExternalSyncSnapshotService` |
| `route-authorization.baseline.ts` | **modify** — new tenant snapshot handlers |
| `.env.example`, `.env.production.example` | **modify** — `EXTERNAL_SYNC_SNAPSHOT_DIR` |
| `docker-compose.yml`, `docker-compose.prod.yml` | **modify** — named volume on the backend |
| `apps/frontend/src/types/match.ts` | **modify** — `snapshotId` on `MatchManifest` |
| `apps/frontend/src/lib/api.ts` | **modify** — snapshot + match calls |
| `apps/frontend/src/lib/match-review.ts` | **new** — assemble confirm payload, confirm-ready check |
| `apps/frontend/src/components/external-sync/SnapshotImportPanel.tsx` | **new** — extract/upload/review/import UI |
| `settings/data/external-import/page.tsx` | **modify** — use the panel; drop live-pull run as the primary action |
| `admin/tenants/[tenantId]/external-sync/page.tsx` | **modify** — same panel with admin API |
| `TODO.md` | **modify** — record the work |

---

## Task 1: Snapshot file format and disk helpers

**Files:**
- Create: `apps/backend/src/external-sync/snapshot/snapshot.types.ts`
- Create: `apps/backend/src/external-sync/snapshot/snapshot-file.ts`
- Test: `apps/backend/src/external-sync/snapshot/snapshot-file.spec.ts`

**Interfaces:**
- Consumes: Node `fs`, `path`, `zlib`, `crypto`; env `EXTERNAL_SYNC_SNAPSHOT_DIR` (default `/var/lib/erp71/external-sync-snapshots`)
- Produces:
  - `SNAPSHOT_FORMAT_VERSION = 1`
  - `SnapshotCounts`, `SnapshotManifest`, `SnapshotDocument` as in the spec
  - `snapshotRoot(): string`
  - `snapshotFilePath(tenantId: string, snapshotId: string): string` — `{root}/{tenantId}/{id}.json.gz`
  - `assertSafeId(label: string, value: string): string` — `/^[A-Za-z0-9_-]+$/` or throw `Error`
  - `countsOf(doc: Pick<SnapshotDocument, 'products' | 'customers' | 'suppliers' | 'sales' | 'purchases' | 'customerPayments' | 'supplierPayments' | 'saleReturns'>): SnapshotCounts`
  - `withChecksum(doc: SnapshotDocument): SnapshotDocument` — sha256 of `JSON.stringify` of the document with `manifest.sha256` omitted
  - `assertChecksum(doc: SnapshotDocument): void`
  - `assertCounts(doc: SnapshotDocument): void`
  - `assertFormatVersion(doc: SnapshotDocument): void`
  - `writeSnapshotFile(absPath: string, doc: SnapshotDocument): Promise<{ byteSize: number; sha256: string }>` — gzip to `absPath + '.tmp'`, then `rename`
  - `readSnapshotFile(absPath: string): Promise<SnapshotDocument>`
  - `removeIfExists(absPath: string): Promise<void>`

- [ ] **Step 1: Write the failing test**

```ts
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
    countsOf,
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
        const dest = path.join(dir, 'no-such-parent-will-be-created', 'snap-1.json.gz');
        // writeSnapshotFile must mkdirp the parent; to force failure, pass a path
        // whose parent is a file, not a directory.
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/external-sync/snapshot/snapshot-file.spec.ts --workspace apps/backend`

Expected: FAIL — `Cannot find module './snapshot-file'`

- [ ] **Step 3: Write minimal implementation**

`snapshot.types.ts` holds the interfaces. `snapshot-file.ts`:

- `assertSafeId` tests `/^[A-Za-z0-9_-]+$/`.
- `snapshotRoot` reads `process.env.EXTERNAL_SYNC_SNAPSHOT_DIR` or `/var/lib/erp71/external-sync-snapshots`.
- Checksum: clone the document, set `manifest.sha256` to `''`, `JSON.stringify`, `createHash('sha256')`. `withChecksum` writes that hex onto `manifest.sha256`. `assertChecksum` recomputes and compares.
- `writeSnapshotFile`: `mkdir(dirname, { recursive: true })`, gzip the UTF-8 JSON (include checksum), write `absPath + '.tmp'`, `rename` onto `absPath`. On throw, `unlink` the tmp (ignore ENOENT).
- `readSnapshotFile`: gunzip, `JSON.parse`, then `assertFormatVersion`, `assertChecksum`, `assertCounts`.

- [ ] **Step 4: Run tests and make sure they pass**

Run: `npx jest src/external-sync/snapshot/snapshot-file.spec.ts --workspace apps/backend`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/external-sync/snapshot/snapshot.types.ts \
        apps/backend/src/external-sync/snapshot/snapshot-file.ts \
        apps/backend/src/external-sync/snapshot/snapshot-file.spec.ts
git commit -m "feat(external-sync): gzip snapshot file format with checksums"
```

---

## Task 2: SnapshotClient

**Files:**
- Create: `apps/backend/src/external-sync/snapshot/snapshot-client.ts`
- Test: `apps/backend/src/external-sync/snapshot/snapshot-client.spec.ts`

**Interfaces:**
- Consumes: `SnapshotDocument`, `readSnapshotFile`, `ProviderClient`, `DateWindow`, `PaymentParty`
- Produces:
  - `class SnapshotClient implements ProviderClient`
  - `static async fromFile(absPath: string): Promise<SnapshotClient>`
  - `login(): Promise<ProviderSession>` — `{ organizationId: manifest.externalOrgId, user: { name: 'snapshot', username: 'snapshot', role: 'SNAPSHOT' } }`
  - `fetchProducts/Customers/Suppliers(): Promise<unknown[]>`
  - `fetchSaleDocuments(_window: DateWindow): Promise<unknown[]>` — ignores window, returns stored `sales`
  - `fetchPurchaseDocuments` — stored `purchases`
  - `fetchPayments(_window, party)` — `customerPayments` or `supplierPayments`
  - `fetchSaleReturnDocuments` — stored `saleReturns`
  - `getManifest(): SnapshotManifest`

- [ ] **Step 1: Write the failing test**

```ts
import { SnapshotClient } from './snapshot-client';
import { SNAPSHOT_FORMAT_VERSION } from './snapshot.types';
import type { SnapshotDocument } from './snapshot.types';

const doc: SnapshotDocument = {
    formatVersion: SNAPSHOT_FORMAT_VERSION,
    manifest: {
        formatVersion: SNAPSHOT_FORMAT_VERSION,
        tenantId: 't1', connectionId: 'c1', provider: 'DIZI_CASHIER',
        externalOrgId: 'org-dizi', windowFrom: '2026-01-01', windowTo: '2026-03-31',
        extractedAt: '2026-09-30T00:00:00.000Z',
        counts: { products: 1, customers: 0, suppliers: 0, sales: 1, purchases: 0, customerPayments: 2, supplierPayments: 1, saleReturns: 0 },
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/external-sync/snapshot/snapshot-client.spec.ts --workspace apps/backend`

Expected: FAIL — module not found

- [ ] **Step 3: Write minimal implementation**

`SnapshotClient` stores the document and returns the arrays. `fromFile` is `new SnapshotClient(await readSnapshotFile(absPath))`.

- [ ] **Step 4: Run tests and make sure they pass**

Run: `npx jest src/external-sync/snapshot/snapshot-client.spec.ts --workspace apps/backend`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/external-sync/snapshot/snapshot-client.ts \
        apps/backend/src/external-sync/snapshot/snapshot-client.spec.ts
git commit -m "feat(external-sync): ProviderClient that reads a snapshot file"
```

---

## Task 3: Prisma snapshot model

**Files:**
- Modify: `packages/database/prisma/schema.prisma` (`Tenant` around the existing `externalSyncRuns` relation; `ExternalSyncConnection`; `ExternalSyncRun`; new model)
- Create: `packages/database/prisma/migrations/20260930120000_add_external_sync_snapshot/migration.sql`

**Interfaces:**
- Consumes: existing ExternalSync* models
- Produces: `ExternalSyncSnapshot` as specified; `ExternalSyncRun.snapshot_id String?`; relations `snapshots` on Tenant and Connection; `snapshot` optional on Run

- [ ] **Step 1: Add the model**

On `Tenant`, add `externalSyncSnapshots ExternalSyncSnapshot[]`.

On `ExternalSyncConnection`, add `snapshots ExternalSyncSnapshot[]`.

On `ExternalSyncRun`:

```
snapshot_id String?
snapshot    ExternalSyncSnapshot? @relation(fields: [snapshot_id], references: [id], onDelete: SetNull)
```

New model:

```
model ExternalSyncSnapshot {
  id               String    @id @default(uuid())
  tenant_id        String
  connection_id    String
  /// EXTRACTING | READY | FAILED
  status           String    @default("EXTRACTING")
  window_from      DateTime
  window_to        DateTime
  counts           Json?
  byte_size        Int?
  sha256           String?
  error_message    String?
  phase            String?
  progress         Json?
  cancel_requested Boolean   @default(false)
  extracted_by     String?
  created_at       DateTime  @default(now())
  finished_at      DateTime?

  tenant     Tenant                 @relation(fields: [tenant_id], references: [id], onDelete: Cascade)
  connection ExternalSyncConnection @relation(fields: [connection_id], references: [id], onDelete: Cascade)
  runs       ExternalSyncRun[]

  @@index([tenant_id, created_at])
  @@index([connection_id, created_at])
}
```

SQL migration (additive):

```sql
CREATE TABLE "ExternalSyncSnapshot" (
  "id" TEXT NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "connection_id" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'EXTRACTING',
  "window_from" TIMESTAMP(3) NOT NULL,
  "window_to" TIMESTAMP(3) NOT NULL,
  "counts" JSONB,
  "byte_size" INTEGER,
  "sha256" TEXT,
  "error_message" TEXT,
  "phase" TEXT,
  "progress" JSONB,
  "cancel_requested" BOOLEAN NOT NULL DEFAULT false,
  "extracted_by" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finished_at" TIMESTAMP(3),
  CONSTRAINT "ExternalSyncSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ExternalSyncSnapshot_tenant_id_created_at_idx" ON "ExternalSyncSnapshot"("tenant_id", "created_at");
CREATE INDEX "ExternalSyncSnapshot_connection_id_created_at_idx" ON "ExternalSyncSnapshot"("connection_id", "created_at");

ALTER TABLE "ExternalSyncSnapshot"
  ADD CONSTRAINT "ExternalSyncSnapshot_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ExternalSyncSnapshot"
  ADD CONSTRAINT "ExternalSyncSnapshot_connection_id_fkey"
  FOREIGN KEY ("connection_id") REFERENCES "ExternalSyncConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ExternalSyncRun" ADD COLUMN "snapshot_id" TEXT;
ALTER TABLE "ExternalSyncRun"
  ADD CONSTRAINT "ExternalSyncRun_snapshot_id_fkey"
  FOREIGN KEY ("snapshot_id") REFERENCES "ExternalSyncSnapshot"("id") ON DELETE SET NULL ON UPDATE CASCADE;
```

- [ ] **Step 2: Generate the client**

Run: `npx prisma generate --schema packages/database/prisma/schema.prisma`

Expected: client includes `externalSyncSnapshot`.

- [ ] **Step 3: Commit**

```bash
git add packages/database/prisma/schema.prisma \
        packages/database/prisma/migrations/20260930120000_add_external_sync_snapshot
git commit -m "feat(db): ExternalSyncSnapshot and optional run.snapshot_id"
```

---

## Task 4: Shared window helper and extract job

**Files:**
- Create: `apps/backend/src/external-sync/snapshot/window.ts`
- Modify: `apps/backend/src/external-sync/external-sync.service.ts` — replace `private resolveWindow` with a call to `resolveSyncWindow`
- Create: `apps/backend/src/external-sync/snapshot/snapshot.service.ts`
- Test: `apps/backend/src/external-sync/snapshot/window.spec.ts`
- Test: `apps/backend/src/external-sync/snapshot/snapshot.service.spec.ts`
- Modify: `apps/backend/src/external-sync/external-sync.module.ts` — provide `ExternalSyncSnapshotService`

**Interfaces:**
- Consumes: `ProviderClient` from `getProviderDefinition`, `EncryptionService`, `writeSnapshotFile`, `snapshotFilePath`, `withChecksum`, `countsOf`, `removeIfExists`
- Produces:
  - `resolveSyncWindow(connection, dto): { from: Date; to: Date }` — same rules as today’s `resolveWindow` (including `history_start_date` clamp and the 5-year fullResync fallback)
  - `ExternalSyncSnapshotService.startExtract(tenantId, dto: { provider?: string; dateFrom?: string; dateTo?: string; fullResync?: boolean }, userId?: string)`
  - `cancelExtract(tenantId, snapshotId)`
  - `getSnapshot(tenantId, snapshotId)`
  - `listSnapshots(tenantId, provider?: string)`
  - `assertNoInFlight(connectionId)` — throws `ConflictException` if a snapshot is `EXTRACTING` or a run is `RUNNING`

Extract writes a row `EXTRACTING`, then in the background (same fire-and-forget pattern as `startRun`): login, org-id guard, `fetchProducts/Customers/Suppliers`, then for each `def.planWindows` chunk concatenate documents and payments, `withChecksum`, `writeSnapshotFile`, set `READY` with counts/byte_size/sha256. On error: `FAILED`, `removeIfExists` of both tmp and final. Check `cancel_requested` between collections and between chunks.

- [ ] **Step 1: Write the failing tests**

`window.spec.ts` — copy the three cases implied by the current method: explicit dates, rolling `window_days`, `fullResync` clamped by `history_start_date`, `from > to` throws.

`snapshot.service.spec.ts` (db mocked; fake `ProviderClient` whose fetch methods return tiny arrays; `EXTERNAL_SYNC_SNAPSHOT_DIR` is a tmp dir):

```ts
it('reaches READY only after the gzip exists and has matching counts', async () => { /* await the in-process extract by making startExtract await executeExtract in tests via a hook, OR spy and flush microtasks: expose executeExtract as package-private and call it */ });
it('marks FAILED and deletes the file when fetchProducts throws', async () => {});
it('honours cancel_requested between collections', async () => {});
it('refuses a second extract while one is EXTRACTING', async () => {});
it('refuses an extract while a run is RUNNING', async () => {});
```

To keep extract testable without racing `void this.executeExtract(...)`, structure the service like `startRun`: `startExtract` creates the row and calls `void this.executeExtract(id)`. Tests call `executeExtract` directly (make it `async executeExtract(snapshotId: string)` as a public method used by the controller only via `startExtract`, but callable from tests).

Fake client:

```ts
const client = {
    login: jest.fn().mockResolvedValue({ organizationId: 'org-9', user: { name: 'a', username: 'a', role: 'OWNER' } }),
    fetchProducts: jest.fn().mockResolvedValue([{ id: 1 }]),
    fetchCustomers: jest.fn().mockResolvedValue([]),
    fetchSuppliers: jest.fn().mockResolvedValue([]),
    fetchSaleDocuments: jest.fn().mockResolvedValue([]),
    fetchPurchaseDocuments: jest.fn().mockResolvedValue([]),
    fetchPayments: jest.fn().mockResolvedValue([]),
    fetchSaleReturnDocuments: jest.fn().mockResolvedValue([]),
};
```

Stub `getProviderDefinition` by injecting a factory, **or** construct the service with the real adapter and mock `db` so `createClient` is never reached — better: pass the client in by stubbing `getProviderDefinition` is hard because it is a module export. Mock `EncryptionService.decrypt`. For extract tests, add an optional `clientOverride` only in tests — do **not** add a test-only setter on the service.

Cleaner: extract the “build client from connection” to a tiny `createLiveClient(connection, decrypt)` in `snapshot/live-client.ts` and mock that module in the spec with `jest.mock`. Prefer: `ExternalSyncSnapshotService` constructor takes nothing extra; the spec `jest.mock('../provider-adapter')` to return `createClient: () => client` and `planWindows: () => [{ from: '2026-01-01', to: '2026-01-31' }]`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest src/external-sync/snapshot/window.spec.ts src/external-sync/snapshot/snapshot.service.spec.ts --workspace apps/backend`

Expected: FAIL — modules missing

- [ ] **Step 3: Implement `resolveSyncWindow` by moving the body of `resolveWindow` verbatim, then the service**

`startExtract` must call `assertNoInFlight`. Org-id mismatch throws `ConflictException` with the same message the run uses, and the snapshot goes `FAILED`.

Progress: rewrite `phase` as `'Products'`, `'Customers'`, … and `{ done, total }` where total is `3 + chunks.length * 4` (sales, purchases, two payment parties, returns per chunk — masters are the 3). Close enough that the UI can poll; exact formula: `3 + chunks.length * 5` (purchases, sales, customer payments, supplier payments, sale returns).

- [ ] **Step 4: Run tests and make sure they pass**

Run: `npx jest src/external-sync/snapshot --workspace apps/backend`

Also run: `npx jest src/external-sync/external-sync.ordering.spec.ts --workspace apps/backend`

Expected: PASS. Existing window behaviour preserved.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/external-sync/snapshot apps/backend/src/external-sync/external-sync.service.ts \
        apps/backend/src/external-sync/external-sync.module.ts
git commit -m "feat(external-sync): extract a provider pull into a snapshot file"
```

---

## Task 5: Upload, download, delete, list, and connection cleanup

**Files:**
- Modify: `apps/backend/src/external-sync/snapshot/snapshot.service.ts`
- Modify: `apps/backend/src/external-sync/snapshot/snapshot.service.spec.ts`
- Modify: `apps/backend/src/external-sync/external-sync.service.ts` — `deleteConnection` lists snapshots for the connection, `removeIfExists` each file, then deletes the connection (cascade drops rows)

**Interfaces:**
- Produces:
  - `uploadSnapshot(tenantId, connectionProvider: string | undefined, buffer: Buffer): Promise<row>`
  - `openFile(tenantId, snapshotId): Promise<{ path: string; filename: string; byteSize: number }>` — asserts tenant, status READY, file exists
  - `deleteSnapshot(tenantId, snapshotId)` — READY or FAILED only; EXTRACTING is `ConflictException`
  - `removeFilesForConnection(tenantId, connectionId)` 

Upload: gunzip+parse via writing the buffer to a temp file and `readSnapshotFile` (which already asserts checksum/counts/version), then compare `manifest.tenantId === tenantId`, `manifest.connectionId === connection.id`, `manifest.provider === connection.provider`, `manifest.externalOrgId === connection.external_org_id` (when the connection has one). Mismatch → `BadRequestException`, nothing stored. Success → create `READY` row, `writeSnapshotFile` to the canonical path (or `rename` the temp into place).

Download filename: `${provider}-${windowFrom}-to-${windowTo}.json.gz`.

- [ ] **Step 1: Write the failing tests**

```ts
it('rejects an upload whose manifest tenantId disagrees', async () => {});
it('rejects an upload whose provider disagrees with the connection', async () => {});
it('rejects an upload whose externalOrgId disagrees', async () => {});
it('creates a READY row for a valid gzip', async () => {});
it('openFile throws when the gzip is missing on disk', async () => {});
it('deleteSnapshot refuses EXTRACTING', async () => {});
it('deleteConnection removes the gzip files', async () => {});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest src/external-sync/snapshot/snapshot.service.spec.ts --workspace apps/backend`

Expected: FAIL on the new cases

- [ ] **Step 3: Implement**

- [ ] **Step 4: Run tests and make sure they pass**

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/external-sync/snapshot/snapshot.service.ts \
        apps/backend/src/external-sync/snapshot/snapshot.service.spec.ts \
        apps/backend/src/external-sync/external-sync.service.ts
git commit -m "feat(external-sync): upload, download and delete snapshots"
```

---

## Task 6: Match candidates from a snapshot

**Files:**
- Modify: `apps/backend/src/external-sync/match/match.types.ts` — `MatchManifest.snapshotId: string`
- Modify: `apps/backend/src/external-sync/external-sync.match.dto.ts` — `MatchManifestDto.snapshotId`
- Modify: `apps/backend/src/external-sync/external-sync.match.service.ts`
- Modify: `apps/backend/src/external-sync/external-sync.match.service.spec.ts`
- Modify: `apps/frontend/src/types/match.ts` — same `snapshotId: string`
- Modify: `apps/frontend/src/lib/match-workbook.ts` — `parseMatchWorkbook` reads `manifestFields.snapshotId`
- Modify: `apps/frontend/src/lib/match-workbook.test.ts` — fixture manifest includes `snapshotId`; round-trip asserts it

**Interfaces:**
- Consumes: `readSnapshotFile`, `snapshotFilePath`, existing `build*Candidates`
- Produces:
  - `getCandidates(tenantId: string, snapshotId: string)` — no live client
  - `applyDecisions` also checks `dto.manifest.snapshotId` equals a READY snapshot for that connection; missing/mismatch → `BadRequestException`

`getCandidates` loads the snapshot row (`tenant_id` + id, status READY), reads the file, maps products/customers/suppliers with `def.mappers` (claimed sets as today), scores against ERP71 `deleted_at: null` rows, returns `{ manifest: { tenantId, connectionId, provider, snapshotId, generatedAt, rowCount }, rows }`.

- [ ] **Step 1: Write the failing tests**

In `external-sync.match.service.spec.ts`:

```ts
it('getCandidates maps from the snapshot and never decrypts the connection password', async () => {
    // db returns a READY snapshot; mock readSnapshotFile via jest.mock('./snapshot/snapshot-file')
    // encryption.decrypt must not be called
});

it('rejects applyDecisions when snapshotId is missing', async () => {});
it('rejects applyDecisions when snapshotId does not match a READY snapshot for the connection', async () => {});
it('rejects applyDecisions when rowCount is the medium subset only', async () => {
    // two rows in "truth" but manifest.rowCount and rows.length are 1
    // already covered by row count mismatch — add an explicit test name that says "medium-only body"
    await expect(service.applyDecisions('tenant-1', file({}, { rowCount: 1, snapshotId: 'snap-1' }, /* rows default 1 */)))
        // strengthen: pass two expected source ids somehow
});
```

The medium-only case is the existing row-count mismatch if the client sends `rowCount: rows.length` for a subset. Pin it like this: `getCandidates` is not in this test; `applyDecisions` cannot know the true candidate count except via `manifest.rowCount`. Add: when `manifest.rowCount === rows.length` but the snapshot’s product+customer+supplier counts disagree, reject.

Implement that extra check in `applyDecisions`: load snapshot `counts` and require `rows.length === counts.products + counts.customers + counts.suppliers`. That is the Review Focus item.

```ts
it('rejects a body whose row count does not equal snapshot master counts', async () => {
    db.externalSyncSnapshot.findFirst.mockResolvedValue({
        id: 'snap-1', connection_id: 'conn-1', status: 'READY',
        counts: { products: 10, customers: 4, suppliers: 2, sales: 0, purchases: 0, customerPayments: 0, supplierPayments: 0, saleReturns: 0 },
    });
    await expect(service.applyDecisions('tenant-1', file({}, { snapshotId: 'snap-1' }))).rejects.toThrow(/count/i);
    expect(db.$transaction).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest src/external-sync/external-sync.match.service.spec.ts --workspace apps/backend`

Expected: FAIL — `snapshotId` not on DTO / new cases fail

- [ ] **Step 3: Implement**

Rewrite `getCandidates(tenantId, snapshotId)`. Remove the live `client.login` / `fetchProducts` path.

Keep `applyDecisions` all-or-nothing `$transaction`.

In `parseMatchWorkbook`, set `snapshotId: manifestFields.snapshotId ?? ''`. `buildWorkbookBuffer` already writes every enumerable manifest field, so adding `snapshotId` to `MatchManifest` is enough on the write side. Extend `match-workbook.test.ts`'s fixture with `snapshotId: 'snap-1'` and assert the parsed manifest keeps it.

- [ ] **Step 4: Run tests and make sure they pass**

Also run: `npx jest src/external-sync/match --workspace apps/backend`

Expected: PASS. Algorithm tests untouched.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/external-sync/match apps/backend/src/external-sync/external-sync.match.dto.ts \
        apps/backend/src/external-sync/external-sync.match.service.ts \
        apps/backend/src/external-sync/external-sync.match.service.spec.ts \
        apps/frontend/src/types/match.ts apps/frontend/src/lib/match-workbook.ts \
        apps/frontend/src/lib/match-workbook.test.ts
git commit -m "feat(external-sync): score match candidates from a snapshot"
```

---

## Task 7: Manual import reads the snapshot

**Files:**
- Modify: `apps/backend/src/external-sync/external-sync.dto.ts` — optional `@IsString() @MaxLength(64) snapshotId?` on `RunExternalSyncDto`
- Modify: `apps/backend/src/external-sync/external-sync.service.ts` — `startRun` / `executeRun`
- Test: `apps/backend/src/external-sync/external-sync.snapshot-run.spec.ts`

**Interfaces:**
- Consumes: `SnapshotClient.fromFile`, `assertNoInFlight` (or duplicate the run+extract conflict check here and have extract call the same helper — put `assertNoInFlight` on `ExternalSyncSnapshotService` and call it from `startRun`)
- Produces: `startRun` behaviour:
  - `trigger === 'MANUAL'` and no `dto.snapshotId` → `BadRequestException('Manual imports run from a snapshot. Extract or upload one first.')`
  - `trigger === 'MANUAL'` with `snapshotId` → load READY snapshot for this tenant+connection, `assertNoInFlight`, create run with `snapshot_id`, `window_from/to` copied from the snapshot (ignore dateFrom/fullResync for the window; steps still apply)
  - `trigger === 'SCHEDULED'` → today’s path, `snapshot_id` null, live client
- `executeRun(..., snapshotId: string | null)`:
  - if `snapshotId`: `client = await SnapshotClient.fromFile(snapshotFilePath(tenantId, snapshotId))`. Missing file → throw (run goes FAILED). `chunks = [{ from: toDateString(window.from), to: toDateString(window.to) }]`. Do **not** call `def.createClient`.
  - else: today’s `def.createClient` + `def.planWindows`

- [ ] **Step 1: Write the failing test**

```ts
describe('startRun snapshot vs live', () => {
    it('rejects a manual run without snapshotId and does not create a client', async () => {
        const createClient = jest.fn();
        // service constructed with mocked db; spy provider-adapter if needed
        await expect(service.startRun('tenant-1', { provider: 'EXPRESS_RETAIL_PRO' }, 'MANUAL', 'u1'))
            .rejects.toThrow(/snapshot/i);
        expect(createClient).not.toHaveBeenCalled();
    });

    it('a scheduled run without snapshotId still uses the live client', async () => {
        // existing startRun path: executeRun is fire-and-forget, so assert createClient is invoked
        // by injecting a mock definition OR by asserting the run row has snapshot_id null
        const run = await service.startRun('tenant-1', {}, 'SCHEDULED');
        expect(run.snapshot_id ?? null).toBeNull();
    });

    it('a manual run with a READY snapshot never calls createClient', async () => {
        // write a real gzip in tmpdir; db returns that snapshot; mock createClient
    });

    it('a READY snapshot whose file is missing fails the run and does not createClient', async () => {
        db.externalSyncSnapshot.findFirst.mockResolvedValue({
            id: 'snap-1', tenant_id: 'tenant-1', connection_id: 'conn-1', status: 'READY',
            window_from: new Date('2026-01-01'), window_to: new Date('2026-01-31'),
        });
        // no file on disk
        await service.startRun('tenant-1', { snapshotId: 'snap-1' }, 'MANUAL', 'u1');
        // wait for executeRun: expose a returned promise in tests by awaiting executeRun directly
    });
});
```

Because `executeRun` is private, test it by making `executeRun` package-visible (`async executeRun(...)` public, like extract) **or** by having `startRun` return after awaiting in a test double. Prefer: extract the client-selection into

```ts
export async function clientForRun(args: {
    snapshotId: string | null;
    tenantId: string;
    connection: { id: string; provider: string; base_url: string; username: string; password_encrypted: string; external_org_id: string | null };
    decrypt: (cipher: string) => string;
    createLiveClient: (creds: { baseUrl: string; username: string; password: string }) => ProviderClient;
}): Promise<ProviderClient>
```

in `snapshot/client-for-run.ts`, unit-test that: snapshot id → SnapshotClient.fromFile; missing file throws; null id → createLiveClient. Then `executeRun` calls `clientForRun` and if `snapshotId` uses a single window.

That keeps `external-sync.service.ts` from gaining a large test surface.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest src/external-sync/snapshot/client-for-run.spec.ts src/external-sync/external-sync.snapshot-run.spec.ts --workspace apps/backend`

Expected: FAIL

- [ ] **Step 3: Implement `clientForRun`, wire `startRun`/`executeRun`**

`startRun` for MANUAL must also `assertNoInFlight` so an extract and an import cannot overlap.

When the snapshot file is missing, `executeRun` catches, sets run `FAILED` with `error_message` mentioning the missing snapshot, and does not call `createLiveClient`.

- [ ] **Step 4: Run tests and make sure they pass**

Also: `npx jest src/external-sync --workspace apps/backend`

Expected: PASS. Scheduler still calls `startRun(tenantId, {}, 'SCHEDULED')`.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/external-sync
git commit -m "feat(external-sync): manual import writes from a snapshot file"
```

---

## Task 8: HTTP routes, env, docker volume, route baseline

**Files:**
- Modify: `apps/backend/src/external-sync/external-sync.dto.ts` — `CreateSnapshotDto` (`provider?`, `dateFrom?`, `dateTo?`, `fullResync?`)
- Modify: `apps/backend/src/external-sync/external-sync.controller.ts`
- Modify: `apps/backend/src/external-sync/tenant-external-sync.controller.ts`
- Modify: `apps/backend/src/external-sync/external-sync.match.controller.spec.ts`
- Create: `apps/backend/src/external-sync/external-sync.snapshot.controller.spec.ts`
- Modify: `apps/backend/src/auth/route-authorization.baseline.ts`
- Modify: `.env.example`, `.env.production.example`
- Modify: `docker-compose.yml`, `docker-compose.prod.yml`
- Modify: `apps/backend/Dockerfile` if a `VOLUME` or mkdir is needed — create `/var/lib/erp71/external-sync-snapshots` in the image (`RUN mkdir -p ...`) so the mount has a directory

**Interfaces:**
- Tenant and admin, same shapes:

| Method | Path | Handler |
|---|---|---|
| POST | `/snapshots` | `startExtract` |
| GET | `/snapshots` | `listSnapshots` (`?provider=`) |
| GET | `/snapshots/:id` | `getSnapshot` |
| POST | `/snapshots/:id/cancel` | `cancelExtract` |
| GET | `/snapshots/:id/file` | `openFile` → `StreamableFile` |
| POST | `/snapshots/upload` | `FileInterceptor('file')`, `limits: { fileSize: 100 * 1024 * 1024 }` |
| DELETE | `/snapshots/:id` | `deleteSnapshot` |
| GET | `/match-candidates?snapshotId=` | **breaking change** of the query param |

Download: `new StreamableFile(createReadStream(path), { type: 'application/gzip', disposition: \`attachment; filename="${filename}"\` })`.

Upload: `if (!file) throw new BadRequestException('No file uploaded')`, then `uploadSnapshot(tenantId, provider, file.buffer)`.

Every new `TenantExternalSyncController` method calls `assertAllowed` first.

Baseline entries, same reason string as the existing ones: `"every handler asserts OWNER in the service (assertAllowed)"`.

Env:

```
# Directory for gzipped external-ERP extracts (per-tenant subdirs).
EXTERNAL_SYNC_SNAPSHOT_DIR=/var/lib/erp71/external-sync-snapshots
```

Compose (backend service):

```yaml
environment:
  - EXTERNAL_SYNC_SNAPSHOT_DIR=/var/lib/erp71/external-sync-snapshots
volumes:
  - external_sync_snapshots:/var/lib/erp71/external-sync-snapshots
```

Top-level `volumes: external_sync_snapshots:` in both compose files.

- [ ] **Step 1: Write the failing controller tests**

`external-sync.match.controller.spec.ts`: `getMatchCandidates` now takes `snapshotId`. Update existing tests to pass `'snap-1'` and expect `getCandidates('tenant-1', 'snap-1')`. Non-owner still forbidden.

`external-sync.snapshot.controller.spec.ts`: owner vs manager vs feature-off for `startExtract`; admin controller passes `tenantId` from the URL; upload without a file throws `BadRequestException`.

- [ ] **Step 2: Run the authorization ratchet**

Run: `npx jest src/auth/route-authorization --workspace apps/backend`

Expected: FAIL listing the new tenant handlers as open, until they are in the baseline **and** they call `assertAllowed`.

- [ ] **Step 3: Implement routes, baseline, env, compose, mkdir in Dockerfile**

- [ ] **Step 4: Run tests**

Run:

```
npx jest src/external-sync src/auth/route-authorization --workspace apps/backend
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/external-sync apps/backend/src/auth/route-authorization.baseline.ts \
        apps/backend/Dockerfile .env.example .env.production.example \
        docker-compose.yml docker-compose.prod.yml
git commit -m "feat(external-sync): snapshot HTTP routes and snapshot disk volume"
```

---

## Task 9: Frontend API and confirm-payload helpers

**Files:**
- Modify: `apps/frontend/src/lib/api.ts` — types + calls
- Create: `apps/frontend/src/lib/match-review.ts`
- Test: `apps/frontend/src/lib/match-review.test.ts`
- Modify: `apps/frontend/src/types/match.ts` if Task 6 did not already (it should have)

**Interfaces:**
- Produces API (mirror admin + tenant, same as today’s pairing):

```ts
export type ExternalSyncSnapshot = {
    id: string;
    tenant_id: string;
    connection_id: string;
    status: 'EXTRACTING' | 'READY' | 'FAILED';
    window_from: string;
    window_to: string;
    counts: Record<string, number> | null;
    byte_size: number | null;
    sha256: string | null;
    error_message: string | null;
    phase: string | null;
    progress: { done: number; total: number } | null;
    created_at: string;
    finished_at: string | null;
};

startMySnapshotExtract(data: { provider?: string; dateFrom?: string; dateTo?: string; fullResync?: boolean }): Promise<ExternalSyncSnapshot>
listMySnapshots(provider?: string): Promise<ExternalSyncSnapshot[]>
getMySnapshot(id: string): Promise<ExternalSyncSnapshot>
cancelMySnapshotExtract(id: string): Promise<{ cancelling: boolean }>
downloadMySnapshotFile(id: string): Promise<{ blob: Blob; filename: string }>  // fetchBlobWithAuth
uploadMySnapshot(file: File, provider?: string): Promise<ExternalSyncSnapshot>  // FormData field "file"
deleteMySnapshot(id: string): Promise<{ deleted: boolean }>
getMyMatchCandidates(snapshotId: string): Promise<{ manifest: MatchManifest; rows: CandidateRow[] }>
startMyExternalSyncRun({ snapshotId, dryRun, steps }: { snapshotId: string; dryRun?: boolean; steps?: ExternalSyncStep[] })
```

Admin twins take `tenantId` first.

`match-review.ts`:

```ts
export function decisionKey(entity: string, externalId: string): string {
    return `${entity}:${externalId}`;
}

export function seedDecisions(rows: CandidateRow[]): Record<string, MatchDecision | ''> {
    const out: Record<string, MatchDecision | ''> = {};
    for (const row of rows) out[decisionKey(row.entity, row.externalId)] = row.decision;
    return out;
}

export function isConfirmReady(rows: CandidateRow[], decisions: Record<string, MatchDecision | ''>): boolean {
    return rows
        .filter((row) => row.confidence === 'medium')
        .every((row) => {
            const value = decisions[decisionKey(row.entity, row.externalId)];
            return value === 'accept' || value === 'new' || value === 'alt1' || value === 'alt2' || value === 'alt3' || value === 'skip';
        });
}

export function assembleDecisionRows(
    rows: CandidateRow[],
    decisions: Record<string, MatchDecision | ''>,
): { entity: string; externalId: string; decision: string; matchId?: string | null; altIds?: string[]; notes?: string }[] {
    return rows.map((row) => ({
        entity: row.entity,
        externalId: row.externalId,
        decision: decisions[decisionKey(row.entity, row.externalId)] || row.decision,
        matchId: row.matchId,
        altIds: row.altIds,
        notes: row.notes,
    }));
}
```

- [ ] **Step 1: Write the failing test**

```ts
import { seedDecisions, isConfirmReady, assembleDecisionRows, decisionKey } from './match-review';
import type { CandidateRow } from '@/types/match';

function row(overrides: Partial<CandidateRow> = {}): CandidateRow {
    return {
        entity: 'PRODUCT', externalId: '1', source: 'Dizi', sourceName: 'Napa 500mg',
        sourceExtra: '500mg', suggestedMatch: 'Napa 500 mg', matchId: 'p1',
        confidence: 'medium', score: 0.6, altCandidates: ['Other'], altIds: ['p2'],
        decision: '', notes: '', ...overrides,
    };
}

describe('isConfirmReady', () => {
    it('is false while a medium row is blank', () => {
        const rows = [row(), row({ externalId: '2', confidence: 'high', decision: 'accept' })];
        const decisions = seedDecisions(rows);
        expect(isConfirmReady(rows, decisions)).toBe(false);
        decisions[decisionKey('PRODUCT', '1')] = 'alt1';
        expect(isConfirmReady(rows, decisions)).toBe(true);
    });
});

describe('assembleDecisionRows', () => {
    it('emits every row, including auto-matched high ones', () => {
        const rows = [
            row({ confidence: 'high', decision: 'accept', externalId: 'h' }),
            row({ confidence: 'medium', decision: '', externalId: 'm' }),
        ];
        const decisions = seedDecisions(rows);
        decisions[decisionKey('PRODUCT', 'm')] = 'new';
        const body = assembleDecisionRows(rows, decisions);
        expect(body).toHaveLength(2);
        expect(body.find((r) => r.externalId === 'h')?.decision).toBe('accept');
        expect(body.find((r) => r.externalId === 'm')?.decision).toBe('new');
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test --workspace apps/frontend -- match-review`

Expected: FAIL — module not found

- [ ] **Step 3: Implement helpers and API methods**

`getMyMatchCandidates` URL: `/tenants/external-sync/match-candidates?snapshotId=`

`startMyExternalSyncRun` body must include `snapshotId` (update the existing function’s type; callers in Task 10).

Upload:

```ts
uploadMySnapshot: (file: File, provider?: string) => {
    const body = new FormData();
    body.append('file', file);
    const qs = provider ? `?provider=${encodeURIComponent(provider)}` : '';
    return fetchWithAuth(`/tenants/external-sync/snapshots/upload${qs}`, { method: 'POST', body });
}
```

Do not set `Content-Type` on FormData (the browser sets the boundary).

- [ ] **Step 4: Run tests**

Run: `npm test --workspace apps/frontend -- match-review`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/frontend/src/lib/api.ts apps/frontend/src/lib/match-review.ts \
        apps/frontend/src/lib/match-review.test.ts apps/frontend/src/types/match.ts
git commit -m "feat(frontend): snapshot API helpers and match confirm payload"
```

---

## Task 10: Shared review panel on tenant and admin pages

**Files:**
- Create: `apps/frontend/src/components/external-sync/SnapshotImportPanel.tsx`
- Test: `apps/frontend/src/components/external-sync/SnapshotImportPanel.test.tsx`
- Modify: `apps/frontend/src/app/(app)/settings/data/external-import/page.tsx`
- Modify: `apps/frontend/src/app/(app)/admin/tenants/[tenantId]/external-sync/page.tsx`
- Modify: `TODO.md` — under the Express Retail / Dizi sections, add a completed-style note only after the panel is wired; also keep an open follow-up if anything from the spec is deferred (none should be)

**Interfaces:**
- Consumes: the API adapter:

```ts
export type SnapshotImportAdapter = {
    listSnapshots: (provider: string) => Promise<ExternalSyncSnapshot[]>;
    startExtract: (body: { provider: string; dateFrom?: string; dateTo?: string; fullResync?: boolean }) => Promise<ExternalSyncSnapshot>;
    getSnapshot: (id: string) => Promise<ExternalSyncSnapshot>;
    cancelExtract: (id: string) => Promise<{ cancelling: boolean }>;
    downloadFile: (id: string) => Promise<{ blob: Blob; filename: string }>;
    uploadFile: (file: File, provider: string) => Promise<ExternalSyncSnapshot>;
    deleteSnapshot: (id: string) => Promise<{ deleted: boolean }>;
    getMatchCandidates: (snapshotId: string) => Promise<{ manifest: MatchManifest; rows: CandidateRow[] }>;
    applyMatchDecisions: (payload: { manifest: MatchManifest; rows: ReturnType<typeof assembleDecisionRows> }) => Promise<{ applied: number; skipped: number }>;
    startRun: (body: { snapshotId: string; dryRun: boolean; steps: ExternalSyncStep[] }) => Promise<ExternalSyncRun>;
    downloadWorkbook?: (manifest: MatchManifest, rows: CandidateRow[]) => void; // default downloadMatchWorkbook
};
```

`SnapshotImportPanel` props: `{ provider: string; providerLabel: string; connectionId: string | null; adapter: SnapshotImportAdapter; steps: ExternalSyncStep[]; dryRunDefault?: boolean }`.

Behaviour:

1. Lists snapshots for the provider. Poll every 5s while any is `EXTRACTING` (same interval as runs).
2. **Extract** button uses the same dateFrom/dateTo/fullResync fields the page already has — lift those into the panel or pass them as props (`windowForm`). Pass them as props `windowForm` from the parent so the parent keeps the date fields next to extract, not next to a live pull.
3. **Download** on a READY row uses `downloadFile` then `URL.createObjectURL` + `<a download>`.
4. **Upload** hidden file input, `accept=".gz,.json.gz,application/gzip"`.
5. Selecting a READY snapshot loads `getMatchCandidates`. Three sub-tabs: Products, Customers, Suppliers. Default filter chip: “Needs decision (N)”. Collapsed `<details>` for auto-matched and create-as-new.
6. Each medium row: source name, extra, suggested match, a `<select>` of accept / alt1.. / new / skip (labels: suggested name, each alt name, “Create as new”, “Skip”). `min-h-touch`.
7. Confirm button disabled until `isConfirmReady`. On click, `assembleDecisionRows` + `applyMatchDecisions`. Toast applied count.
8. **Start import** / **Start dry run** call `startRun({ snapshotId, dryRun, steps })`. Disabled without a READY snapshot or while extract/import running.
9. Optional “Download review workbook” still calls `downloadMatchWorkbook(manifest, rows)`.

Replace the parent’s live `Start dry run` / `Start import` that posted without `snapshotId`. Keep run progress + recent runs as they are.

Admin page: pass adapter wrapping `api.startSnapshotExtract(tenantId, …)` etc.

- [ ] **Step 1: Write the failing panel test**

Use `@testing-library/react`. Stub `adapter.getMatchCandidates` with one medium product and one high product. Render the panel with a READY snapshot already selected (props `initialSnapshotId` **or** mock `listSnapshots` to return one READY). Assert:

- the medium row’s select is in the document
- Confirm is disabled
- choosing “Create as new” enables Confirm
- clicking Confirm calls `applyMatchDecisions` with **two** rows (high + medium)

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test --workspace apps/frontend -- SnapshotImportPanel`

Expected: FAIL — module not found

- [ ] **Step 3: Implement the panel and wire both pages**

Follow `docs/ui-design-guidelines.md`. Do not introduce a new accent. Existing `StatusBadge` for EXTRACTING/READY/FAILED.

On the tenant page, remove the “Review matches” workbook-only section as the primary flow; keep the workbook button inside the panel.

- [ ] **Step 4: Run tests and lint**

```
npm test --workspace apps/frontend -- SnapshotImportPanel match-review match-workbook
cd apps/frontend && npx next lint --quiet
```

Expected: PASS / lint clean for touched files.

- [ ] **Step 5: Update TODO.md**

In the Express Retail Pro import section and the Dizi Cashier section, add a short completed bullet once this ships (the implementer fills the date), and a remaining open item: “Exercise extract → review → import against a real Express/Dizi account; thresholds still tune off the first real snapshot.”

- [ ] **Step 6: Commit**

```bash
git add apps/frontend/src/components/external-sync \
        apps/frontend/src/app/(app)/settings/data/external-import/page.tsx \
        apps/frontend/src/app/\(app\)/admin/tenants/\[tenantId\]/external-sync/page.tsx \
        TODO.md
git commit -m "feat(external-sync): in-app snapshot extract and match review"
```

---

## Self-review (author)

**Spec coverage**

| Spec requirement | Task |
|---|---|
| Gzipped ProviderClient payloads + manifest + sha256 | 1 |
| SnapshotClient ignores window; payments split by party | 2 |
| ExternalSyncSnapshot model, run.snapshot_id, docker volume, env | 3, 8 |
| Extract job, temp-then-rename, FAILED deletes file, cancel, one-at-a-time | 4 |
| Download / upload with manifest checks | 5 |
| Connection delete removes files | 5 |
| Candidates from snapshot; Excel remains optional export | 6, 10 |
| Confirm all-or-nothing + snapshotId + master-count check | 6 |
| Manual import requires snapshot; scheduled live | 7 |
| Missing snapshot file does not live-pull | 7 |
| HTTP on tenant + admin, OWNER + feature gate | 8 |
| In-app review UI, shared component, both pages | 10 |
| Direct path = extract then review then import, download optional | 10 |

**Placeholder scan:** none of TBD / “handle edge cases” / “similar to Task N”.

**Type consistency:** `SnapshotDocument` / `SNAPSHOT_FORMAT_VERSION` / `getCandidates(tenantId, snapshotId)` / `MatchManifest.snapshotId` / `RunExternalSyncDto.snapshotId` used the same way in later tasks.

**Review Focus tests:** path traversal (Task 1), manual without snapshotId (Task 7), scheduled without snapshotId (Task 7), medium-only body via master counts (Task 6), missing gzip on READY (Task 7).
