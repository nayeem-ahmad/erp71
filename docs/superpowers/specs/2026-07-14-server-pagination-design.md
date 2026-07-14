# Server-Side Pagination & Sorting for DataTable

**Date:** 2026-07-14
**Status:** Approved — ready for implementation plan

## Problem

The CRM Leads page footer reads "Showing 1–10 of 100" while the database holds 146
leads. The shared `DataTable` component
([`apps/frontend/src/components/data-table/DataTable.tsx`](../../../apps/frontend/src/components/data-table/DataTable.tsx))
paginates **entirely client-side**:

```ts
const totalRows = table.getFilteredRowModel().rows.length;
```

`totalRows` is just the length of the array the table was handed. The Leads page
fetches one capped page and discards the real total:

```ts
const data = await api.getLeads({ ..., limit: 100 });
setLeads(data?.items ?? data ?? []);   // total is thrown away
```

The backend already hard-caps `limit` at 100 and returns a proper envelope
`{ items, total, page, limit, pages }` via the `paginate()` helper — so the true
total (146) is present in the response and simply ignored.

### Two real consequences (not cosmetic)

1. The "of N" count is wrong — it shows the fetched count, not the DB total.
2. **Records beyond the fetch limit are unreachable.** Leads 101–146 are never
   fetched, so no amount of clicking "next" reveals them.

### Scope — systemic, not Leads-only

`DataTable` is client-side for every consumer. Any page that hands it a
server-capped slice has the same latent bug. Pages that pass an explicit `limit`:

| limit | pages |
|------|-------|
| 100 | crm/leads, crm/customers, crm/tasks, accounting/expenses, accounting/loans, admin/users, hr/leaves, hr/salary-payments, purchases/supplier-payments, sales/customer-payments |
| 20 | accounting/reconciliation, accounting/vouchers |
| 50 | crm/campaigns |
| 200 | hr/attendance, sales/customer-ledger |
| 500 | purchases/supplier-ledger, sales/price-lists/[id] |

Each tips into the bug once its record count exceeds its limit (the 100-limit
pages hit it first).

## Chosen approach

**Full correctness: server-side pagination *and* server-side sorting.**

Server pagination alone would make sorting misleading — clicking a column header
would reorder only the current page (e.g. 10 of 146 rows). We therefore lift both
pagination and sorting to the server. Search and filters are already server-side
on most of these pages (e.g. Leads renders its own search box with
`showSearch={false}` and passes `status`/`category`/`priority` to the API).

Rejected alternatives:

- **Server pagination, page-scoped sort (frontend-only)** — leaves sorting
  operating on a single page; a visible UX regression.
- **Fetch-all client-side** — keeps all features correct but doesn't scale to
  large tables (ledgers, sales lists) and produces heavy payloads.

## Design

### 1. DataTable server mode (opt-in)

Add one optional prop to `DataTableProps<T>`. When absent, the table remains 100%
client-side — **no regression** for tables that pass their full dataset.

```ts
serverPagination?: {
  total: number;                 // real DB total → drives "Showing X–Y of TOTAL"
  page: number;                  // 1-based current page
  pageSize: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
  sort: { id: string; desc: boolean } | null;
  onSortChange: (sort: { id: string; desc: boolean } | null) => void;
};
```

When `serverPagination` is provided, the table:

- sets TanStack `manualPagination: true` and `manualSorting: true`;
- sets `rowCount: total` and derives `pageCount = Math.ceil(total / pageSize)`;
- computes the footer range from `page`/`pageSize`/`total` instead of array length;
- routes the first/prev/next/last and page-size controls through
  `onPageChange` / `onPageSizeChange`;
- forwards header-click sort changes through `onSortChange` (emitting the first
  sort descriptor, or `null` when cleared) instead of sorting locally;
- expects the built-in global search to be off (pages render their own
  server-backed search box).

**Column `id` == `sortBy` key.** The value emitted in `sort.id` is the TanStack
column `id`. Only columns whose `id` is in the backend allowlist are marked
sortable. Where a column's natural `id` doesn't match a DB field, set the column
`id` to the allowlisted key so the two line up.

**Client mode is unchanged.** Existing consumers that don't pass
`serverPagination` keep full client-side search/sort/filter/pagination/export.

### 2. Backend sort contract

Uniform across every list endpoint.

- **Query params** (all optional): `page` (1-based), `limit`, `sortBy` (field
  key), `sortDir` (`'asc' | 'desc'`).
- **Per-endpoint allowlist:** each service declares a `SORTABLE` map of accepted
  `sortBy` keys → Prisma `orderBy` fragments. Example for leads:

  ```ts
  const LEAD_SORTABLE = {
    name: (dir) => ({ name: dir }),
    status: (dir) => ({ status: dir }),
    next_step_date: (dir) => ({ next_step_date: dir }),
    created_at: (dir) => ({ created_at: dir }),
  };
  ```

- **Fallback:** an unknown or absent `sortBy` uses the endpoint's **current**
  default `orderBy` (leads keeps `[{ next_step_date: 'asc' }, { updated_at: 'desc' }]`).
  This preserves today's ordering and makes sort injection-safe — no raw field
  name from the client ever reaches Prisma.
- **Shared helper** in `apps/backend/src/common/` so services don't reinvent it:

  ```ts
  resolveOrderBy(sortBy, sortDir, sortable, fallback)
  ```

  Returns the mapped fragment when `sortBy` is allowlisted, otherwise `fallback`.
  `sortDir` defaults to `'asc'` and is validated to the two legal values.
- **Response envelope** stays the existing `{ items, total, page, limit, pages }`
  from `paginate()` — already correct, no change.

### 3. Per-page wiring

Each affected page follows the same pattern:

- add `page`, `pageSize`, and `sort` state (defaults: `page = 1`,
  `pageSize = 20` to match the backend default; `sort = null`);
- reset `page` to 1 whenever a search, filter, or sort input changes;
- pass `page` / `limit` / `sortBy` / `sortDir` into the existing `api.getX(...)`
  call;
- read the envelope fully: `setItems(data.items)` **and** `setTotal(data.total)`;
- pass the `serverPagination` bundle to `<DataTable>`.

### Rollout order (each step independently shippable)

1. `DataTable` server mode + `common/resolveOrderBy` helper (foundation; no
   behavior change on its own).
2. **Leads** as the reference vertical slice — verified against the real 146-row
   case end to end.
3. Remaining 100-limit pages: crm/customers, crm/tasks, accounting/expenses,
   accounting/loans, admin/users, hr/leaves, hr/salary-payments,
   purchases/supplier-payments, sales/customer-payments.
4. The 20 / 50 / 200 / 500-limit pages: accounting/reconciliation,
   accounting/vouchers, crm/campaigns, hr/attendance, sales/customer-ledger,
   purchases/supplier-ledger, sales/price-lists/[id].

## Testing

- **Backend unit:** `resolveOrderBy` — allowlisted key maps correctly, unknown
  key falls back, direction honored, illegal `sortDir` rejected/defaulted.
- **Backend per-service:** at least the leads service spec asserts `sortBy` /
  `sortDir` reach `orderBy` and bad input falls back to the default order.
- **Frontend:** extend `DataTable.test.tsx` for server mode — `total` drives the
  footer count, page/size/sort callbacks fire, a header click emits
  `onSortChange`.
- **Manual / verify:** Leads footer reads "of 146", every row reachable via
  next-page, column sort reorders across the whole dataset (not just the page).

## Out of scope (documented limitations)

- **Export / print** in server mode covers the **current page only.** Full-dataset
  export is a separate follow-up.
- Adding *new* sortable columns beyond what each endpoint reasonably supports —
  allowlists start with the fields already meaningful for each entity.
