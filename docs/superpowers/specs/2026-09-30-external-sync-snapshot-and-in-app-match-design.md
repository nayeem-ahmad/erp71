# External-sync snapshot extract and in-app match review

**Date:** 2026-09-30
**Status:** Draft pending review
**Supersedes (delivery, not matching rules):** the review *surface* in
`docs/superpowers/specs/2026-09-21-external-sync-match-review-design.md`.
Normalization, blocking, scoring, confidence tiers, and
`ExternalSyncMapping` as the decision store are unchanged.

**Context:** Express Retail Pro and Dizi Cashier imports. Matching already
scores candidates and can round-trip them through an Excel workbook. The
write path still talks to the live provider in the same run as the pull.

---

## Problem

Two failure modes sit on the same import:

1. **The pull and the write are one run.** Credentials, the vendor API, or
   the old server can disappear mid-migration. Nothing durable remains, and
   Dizi’s pull is thousands of per-document GETs.
2. **Ambiguous matches are decided in Excel, or not at all.** The workbook
   exists on the tenant Data Management page only. The person importing
   still has no in-app way to pick among likely products, customers, or
   suppliers before documents are billed against a mapping that cannot be
   rewritten once posted.

## Goals

- Pull the other system **once**, keep a file, and import from that file
  after access is gone.
- Show **in-app choices** for unclear product, customer, and supplier
  matches, then write only after those choices are confirmed.
- Keep a **direct** path: extract, review, and import without the operator
  having to handle the file, while still producing a downloadable copy.

## Non-goals

- Resuming a half-finished extract.
- Teaching the nightly scheduler to read snapshots. Scheduled runs stay a
  live pull.
- Warehouse attribution on imported stock.
- Changing `post_impacts`, Dizi opening-balance rules, or posted-document
  immutability.
- Replacing the match algorithm. Thresholds, blocking, and phone-as-identity
  stay as in the 2026-09-21 spec.

---

## Pipeline

```
Extract (live API) → snapshot (ours + downloadable)
                         ↓
              Score vs current ERP71
                         ↓
         In-app review (unclear rows first)
                         ↓
         Import from snapshot (no live API)
```

A **direct** run is the same three stages on the snapshot just extracted;
download is optional.

**Manual** tenant and admin imports always go through a snapshot. There is
no manual live pull that writes documents. **Scheduled** runs keep calling
the provider.

Extract every source you will need (Express and Dizi) while access exists,
even if you will import them in sequence. Import order is still
load-bearing for matching: finish and apply one source before reviewing the
second, so the second snapshot’s candidates include what the first created.

---

## Snapshot

### What the file holds

The assembled `ProviderClient` payloads, gzipped JSON:

| Collection | Source |
|---|---|
| `products` | `fetchProducts()` |
| `customers` | `fetchCustomers()` |
| `suppliers` | `fetchSuppliers()` |
| `sales` | `fetchSaleDocuments(window)` — headers plus the line/detail payload the sale mapper already consumes |
| `purchases` | `fetchPurchaseDocuments(window)` |
| `customerPayments` | `fetchPayments(window, 'CUSTOMER')` |
| `supplierPayments` | `fetchPayments(window, 'SUPPLIER')` |
| `saleReturns` | `fetchSaleReturnDocuments(window)` |

These are **provider-shaped assembled documents**, not the `Mapped*` write
shapes. Mapping runs later, at review and at import, through the current
`ProviderMappers`. A mapper fix can be re-applied without the live system.

Express monthly windowing happens during extract. The snapshot stores the
union of every chunk for the requested range. Import from a snapshot does
not call the provider. `executeRun` plans **one** window equal to the
snapshot range, so the existing per-chunk loop runs once. `SnapshotClient`
ignores the window argument on `fetch*` — the collections are already
filtered — and `fetchPayments` still splits by party.

### Manifest

```
formatVersion: 1
tenantId
connectionId
provider
externalOrgId
windowFrom            YYYY-MM-DD
windowTo              YYYY-MM-DD
extractedAt           ISO-8601
counts                { products, customers, suppliers, sales, purchases,
                        customerPayments, supplierPayments, saleReturns }
sha256                hex digest of the uncompressed JSON
```

`formatVersion` other than `1` is rejected on upload and on import.

### Storage

New model `ExternalSyncSnapshot`:

| Column | Role |
|---|---|
| `id` | UUID |
| `tenant_id` | tenant scope |
| `connection_id` | which provider connection |
| `status` | `EXTRACTING` \| `READY` \| `FAILED` |
| `window_from` / `window_to` | requested range |
| `counts` | JSON, filled when READY |
| `byte_size` | gzip size |
| `sha256` | same as manifest |
| `error_message` | set on FAILED |
| `phase` / `progress` | extract observability, same idea as `ExternalSyncRun` |
| `cancel_requested` | stop between provider calls |
| `extracted_by` | user id |
| `created_at` / `finished_at` | |

File path: `{EXTERNAL_SYNC_SNAPSHOT_DIR}/{tenantId}/{id}.json.gz`. Default
dir `/var/lib/erp71/external-sync-snapshots`. Production compose mounts a
named volume there so a container recreate does not drop READY snapshots.
The downloadable file is the copy that still survives a lost volume.

The HTTP client never supplies a filesystem path. Handlers load the row by
id, assert `tenant_id`, then open that row’s file.

Not Cloudinary (private company data). Not a Postgres JSON/bytea column
(multi-ten-MB extracts).

On connection delete: cascade the rows and delete the files.

### Extract job

`POST …/snapshots` starts an extract using the same window rules as today’s
run (`dateFrom` / `dateTo` / `fullResync` / `window_days` /
`history_start_date`). The HTTP response is the snapshot row; work continues
in the background.

Extract is the only step that uses provider credentials. It logs in, applies
the existing org-id guard, walks masters then windowed documents, writes a
temp file, and becomes `READY` only after a successful rename to the final
path. Progress is rewritten as collections complete.

One extract **or** import at a time per connection. A second extract while
one is `EXTRACTING`, or while a run is `RUNNING`, is a conflict.

Cancel is honoured between provider calls. Cancel and any crash, login
failure, org-id mismatch, or disk error mark the snapshot `FAILED` and
delete the temp (and any partial final) file. Retry is a new extract. There
is no resume of a half-finished pull.

The existing step checkboxes (MASTERS, PURCHASES, …) do **not** apply to
extract. A snapshot is the full window so a later import step never needs
the old system.

### Download and upload

- `GET …/snapshots/:id/file` streams the gzip with a content-disposition
  filename `{provider}-{windowFrom}-to-{windowTo}.json.gz`.
- `POST …/snapshots/upload` is multipart. The whole file is rejected, and
  nothing is stored, when the gzip is corrupt, `sha256` disagrees, a
  collection’s length disagrees with `counts`, or the manifest’s
  `tenantId`, `connectionId`, `provider`, `externalOrgId`, or
  `formatVersion` disagrees with the target connection. A valid upload
  creates a `READY` snapshot.

---

## Match review

### Scoring source

`GET …/match-candidates` takes `snapshotId` (required). It maps the
snapshot’s products, customers, and suppliers with the current mappers and
scores them against live ERP71 rows (`deleted_at: null`), using the existing
`match/` modules. It does not call Express or Dizi.

The Excel workbook remains an **optional export** of those same candidates
(`downloadMatchWorkbook`). It is no longer the primary picker. The live
provider pull that today’s `getCandidates` performs is removed.

### In-app UI

On Settings → Data Management → External ERP import, and on the platform
admin tenant external-sync page (the two pages already duplicate most of
this flow; the new snapshot + review controls are a **shared component**
used by both).

Once a snapshot is `READY`:

- Three lists: products, customers, suppliers.
- Default filter: `medium` (needs a decision), with a count.
- Collapsed groups: auto-matched (`high`, pre-filled `accept`) and create
  as new (`low` / `none`, pre-filled `new`). Either group can be opened and
  overridden.
- Each unclear row shows source name, extra (pack/strength, phone, or
  code), the suggested ERP71 record, up to three alternatives, and four
  choices: accept suggested, pick an alternative, create as new, skip.
- Search filters the current list by source name.
- Confirm is disabled until every `medium` row has a choice. It posts the
  existing `ApplyMatchDecisionsDto` (decision values unchanged: `accept` /
  `new` / `alt1` / `alt2` / `alt3` / `skip`).
- The decisions manifest includes `snapshotId`. Confirm is all-or-nothing:
  unknown/duplicate `external_id`, a blank medium decision, an alternate
  that was never offered, a deleted `match_id`, or a snapshot/connection
  mismatch refuses the whole body and writes no mappings.

UI rules: `PageShell` / `PageHeader` / `CompactSection`, `blue-600` accent
only, `text-sm` / `text-xs` body, ≥44px touch targets, no `rounded-2xl` /
`rounded-3xl`. Money, if shown, via `formatBDT()`.

---

## Import from a snapshot

`POST …/runs` for a **manual** trigger requires `snapshotId`. The run
constructs a `SnapshotClient` that implements `ProviderClient` by reading
that file:

- `login()` returns the manifest’s `externalOrgId` (org-id guard still runs).
- `fetch*` returns the stored collections. `fetchPayments` still takes a
  party and returns the matching collection.

`executeRun` keeps its mapper, mapping-table, adoption, impacts, steps, and
progress behaviour. The live client is unused. A missing file, a snapshot
that is not `READY`, a tenant mismatch, or an already-running import is a
hard stop.

`ExternalSyncRun` gains optional `snapshot_id`. Per-document warnings
(`POSTED_IMMUTABLE`, unresolved parent, unmapped product) stay on the run
as they do today.

Dry run from a snapshot is allowed and still writes no masters.

Scheduled `startRun` without `snapshotId` keeps today’s live client.

---

## API surface

Tenant routes stay under `/tenants/external-sync`, owner-gated, behind the
`externalImport` feature. Admin routes stay under
`/admin/tenants/:tenantId/external-sync`. Same shapes on both.

| Method | Path | Role |
|---|---|---|
| POST | `/snapshots` | start extract |
| GET | `/snapshots` | list for the connection |
| GET | `/snapshots/:id` | poll extract progress |
| POST | `/snapshots/:id/cancel` | stop extract |
| GET | `/snapshots/:id/file` | download |
| POST | `/snapshots/upload` | restore from a downloaded file |
| DELETE | `/snapshots/:id` | drop a READY/FAILED snapshot and its file |
| GET | `/match-candidates?snapshotId=` | score from snapshot |
| POST | `/match-decisions` | confirm (existing; manifest + `snapshotId`) |
| POST | `/runs` | manual: `{ snapshotId, steps, dryRun }` |

---

## Components

| Unit | Does | Depends on |
|---|---|---|
| Snapshot file format + read/write helpers | gzip JSON, checksum, temp-then-rename | fs, `EXTERNAL_SYNC_SNAPSHOT_DIR` |
| `SnapshotClient` | `ProviderClient` over a READY file | file helpers, manifest |
| Snapshot service | extract job, upload validation, download, cancel, delete | `ProviderClient` from the adapter, file helpers |
| Existing `match/` modules | normalize, block, score, assemble rows | nothing I/O |
| Match service | candidates from a snapshot; apply decisions | snapshot file, `match/`, Prisma |
| `executeRun` | write path; chooses live client vs `SnapshotClient` | adapter, mappings, impacts |
| Shared frontend snapshot + review section | extract/download/upload, review table, confirm, start import from snapshot | tenant and admin API helpers |

`external-sync.service.ts` is already ~2000 lines. Extract, file I/O, and
`SnapshotClient` go in new files under `apps/backend/src/external-sync/`
(e.g. `snapshot/`). Do not fold them into the service.

---

## Error handling

| Event | Result |
|---|---|
| Extract crash, cancel, login failure, org mismatch, disk error | snapshot `FAILED`; temp/partial file deleted |
| Second extract or import on the same connection | `409` |
| Corrupt gzip, bad checksum, count mismatch, manifest mismatch, unknown `formatVersion` | upload rejected; nothing stored |
| Confirm with a blank medium row, bad alternate, deleted id, snapshot mismatch | whole body refused; no mappings written |
| Import with snapshot not READY, missing file, wrong tenant | hard stop; run `FAILED` if a row was created |
| Access lost after READY | review and import continue |
| Access lost during extract | that snapshot is `FAILED`; start a new extract while access exists |

---

## Testing

No live ERP.

- File helpers: write assembled payloads, gunzip, checksum, equal counts and
  ids. Temp-then-rename; a thrown write leaves no READY file.
- Manifest rejection: wrong tenant, provider, org, version, truncated gzip,
  checksum mismatch.
- `SnapshotClient`: each `fetch*` returns the stored collection;
  `fetchPayments` splits by party; `login` exposes `externalOrgId`.
- Extract: reaches READY only after rename; FAILED leaves no READY row and
  no leftover file; cancel between calls.
- Candidates: built from the snapshot; the live client is not constructed.
- Confirm: blank medium, deleted `match_id`, unknown alternate, snapshot
  mismatch — all refused with zero mapping writes; a valid set writes every
  mapping in one transaction.
- Import: `executeRun` with a snapshot never constructs the live client;
  a stubbed live client would fail the test if called.
- Frontend: medium rows first; Confirm disabled until each has a choice;
  accept / alternative / create new / skip emit the existing decision
  values.

---

## Implementation notes

- Add `EXTERNAL_SYNC_SNAPSHOT_DIR` to backend env examples and a named
  Docker volume in `docker-compose.prod.yml` (and local compose if the
  backend container should retain extracts across restarts).
- Multipart upload limit sized for a full-history Dizi dump (order of
  100 MB), not the JSON body parser default.
- `MatchManifest` / `MatchManifestDto` gain `snapshotId`.
- `ExternalSyncRun.snapshot_id` is nullable so scheduled live runs stay
  valid.
- Existing adoption fixes from 2026-09-21 (`deleted_at: null`, no customer
  match on `customer_code`) remain in force; import-from-snapshot still
  consults mappings first.

---

## Out of scope

- Checkpoint / resume of a partial extract.
- Snapshot-backed scheduled sync.
- Warehouse id on imported documents.
- In-app review of sales/purchase *documents* (masters only).
- Changing confidence thresholds without a real dry run against a snapshot.
