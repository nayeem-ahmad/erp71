# Server-Side Pagination & Sorting — Foundation + Leads Slice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give `DataTable` an opt-in server-pagination + server-sort mode, add a reusable backend sort helper, and wire the CRM Leads page end-to-end so it shows the true total and makes every record reachable.

**Architecture:** `DataTable` gains one optional `serverPagination` prop; when present it uses TanStack `manualPagination`/`manualSorting`, drives the footer count from a server-supplied `total`, and forwards page/size/sort changes to callbacks. Backend list endpoints accept `sortBy`/`sortDir`, resolved through a shared `resolveOrderBy` allowlist helper that falls back to each endpoint's existing default order. The Leads page adds `page`/`pageSize`/`sort` state, passes them to the API, and reads the full `{ items, total }` envelope.

**Tech Stack:** NestJS + Prisma (backend), Next.js 15 + React + TanStack Table v8 (frontend), Jest for both apps.

## Global Constraints

- Client-side mode is the default: a `DataTable` with no `serverPagination` prop must behave exactly as today (no regression).
- Sort must be injection-safe: no client-supplied field name reaches Prisma directly; only allowlisted keys map to `orderBy` fragments.
- Unknown/absent `sortBy` falls back to the endpoint's **current** default `orderBy` (Leads: `[{ next_step_date: 'asc' }, { updated_at: 'desc' }]`).
- Response envelope stays `{ items, total, page, limit, pages }` (from `paginate()`), unchanged.
- Backend `limit` remains capped at 100.
- All backend business queries stay tenant-scoped (existing `where.tenant_id`).
- UI rules: one accent (`blue-600`), `formatBDT()` for money, no new arbitrary hex — not directly exercised here but do not violate.
- Server-mode pages must set `showSearch={false}` (they render their own server-backed search).
- Frontend default page size for server mode: `20` (matches backend default).

**All commands below run from the repo root unless stated. Backend commands: `cd apps/backend`. Frontend commands: `cd apps/frontend`.**

---

### Task 1: Backend `resolveOrderBy` sort helper

**Files:**
- Create: `apps/backend/src/common/sort.util.ts`
- Test: `apps/backend/src/common/sort.util.spec.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `type SortDir = 'asc' | 'desc'`
  - `type OrderByFragment = Record<string, unknown> | Record<string, unknown>[]`
  - `type SortableMap = Record<string, (dir: SortDir) => OrderByFragment>`
  - `function resolveOrderBy(sortBy: string | undefined, sortDir: string | undefined, sortable: SortableMap, fallback: OrderByFragment): OrderByFragment`

- [ ] **Step 1: Write the failing test**

Create `apps/backend/src/common/sort.util.spec.ts`:

```ts
import { resolveOrderBy, SortableMap } from './sort.util';

const sortable: SortableMap = {
    name: (dir) => ({ name: dir }),
    created_at: (dir) => ({ created_at: dir }),
};
const fallback = [{ next_step_date: 'asc' }, { updated_at: 'desc' }];

describe('resolveOrderBy', () => {
    it('maps an allowlisted key ascending', () => {
        expect(resolveOrderBy('name', 'asc', sortable, fallback)).toEqual({ name: 'asc' });
    });

    it('maps an allowlisted key descending', () => {
        expect(resolveOrderBy('created_at', 'desc', sortable, fallback)).toEqual({ created_at: 'desc' });
    });

    it('defaults direction to asc when sortDir is missing', () => {
        expect(resolveOrderBy('name', undefined, sortable, fallback)).toEqual({ name: 'asc' });
    });

    it('defaults direction to asc when sortDir is invalid', () => {
        expect(resolveOrderBy('name', 'sideways', sortable, fallback)).toEqual({ name: 'asc' });
    });

    it('falls back when sortBy is absent', () => {
        expect(resolveOrderBy(undefined, 'asc', sortable, fallback)).toBe(fallback);
    });

    it('falls back when sortBy is not allowlisted', () => {
        expect(resolveOrderBy('password', 'asc', sortable, fallback)).toBe(fallback);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/backend && npx jest src/common/sort.util.spec.ts`
Expected: FAIL — `Cannot find module './sort.util'`.

- [ ] **Step 3: Write minimal implementation**

Create `apps/backend/src/common/sort.util.ts`:

```ts
export type SortDir = 'asc' | 'desc';
export type OrderByFragment = Record<string, unknown> | Record<string, unknown>[];
export type SortableMap = Record<string, (dir: SortDir) => OrderByFragment>;

/**
 * Resolve a client-supplied (sortBy, sortDir) pair into a Prisma `orderBy`
 * fragment using a per-endpoint allowlist. Unknown/absent keys fall back to the
 * endpoint's default order. Injection-safe: only allowlisted keys are honored.
 */
export function resolveOrderBy(
    sortBy: string | undefined,
    sortDir: string | undefined,
    sortable: SortableMap,
    fallback: OrderByFragment,
): OrderByFragment {
    if (!sortBy || !Object.prototype.hasOwnProperty.call(sortable, sortBy)) {
        return fallback;
    }
    const dir: SortDir = sortDir === 'desc' ? 'desc' : 'asc';
    return sortable[sortBy](dir);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/backend && npx jest src/common/sort.util.spec.ts`
Expected: PASS — 6 passing.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/common/sort.util.ts apps/backend/src/common/sort.util.spec.ts
git commit -m "feat(backend): add resolveOrderBy sort allowlist helper"
```

---

### Task 2: Wire sort into the Leads list endpoint

**Files:**
- Modify: `apps/backend/src/crm-leads/crm-leads.controller.ts` (the `findAll` handler, ~lines 34-60)
- Modify: `apps/backend/src/crm-leads/crm-leads.service.ts` (the `findAll` method, ~lines 108-157)
- Test: `apps/backend/src/crm-leads/crm-leads.service.spec.ts` (add cases)

**Interfaces:**
- Consumes: `resolveOrderBy`, `SortableMap` from Task 1.
- Produces: `CrmLeadsService.findAll` now accepts `opts.sortBy?: string` and `opts.sortDir?: string`; controller reads `sortBy`/`sortDir` query params. Frontend (Task 4) relies on the leads endpoint accepting `sortBy`/`sortDir` query params whose valid keys are: `name`, `category`, `priority`, `status`, `score`, `next_step_date`, `created_at`.

- [ ] **Step 1: Write the failing test**

First inspect the existing spec to match its mocking style:

Run: `sed -n '1,60p' apps/backend/src/crm-leads/crm-leads.service.spec.ts`

Then add a `describe('findAll sorting', ...)` block to `apps/backend/src/crm-leads/crm-leads.service.spec.ts`. Use the spec's existing service/db-mock setup (reuse whatever `service` and mocked `db.lead.findMany`/`db.lead.count` the file already wires up — do not create a second mock harness). Add these cases, adapting the mock accessors to the file's existing names:

```ts
describe('findAll sorting', () => {
    it('passes an allowlisted sort to orderBy', async () => {
        // Arrange: mock db.lead.findMany -> [] and db.lead.count -> 0 (reuse existing mocks)
        await service.findAll('tenant-1', { sortBy: 'name', sortDir: 'desc' });
        const arg = (db.lead.findMany as jest.Mock).mock.calls[0][0];
        expect(arg.orderBy).toEqual({ name: 'desc' });
    });

    it('falls back to default order for an unknown sort key', async () => {
        await service.findAll('tenant-1', { sortBy: 'password', sortDir: 'asc' });
        const arg = (db.lead.findMany as jest.Mock).mock.calls[0][0];
        expect(arg.orderBy).toEqual([{ next_step_date: 'asc' }, { updated_at: 'desc' }]);
    });

    it('falls back to default order when no sort is given', async () => {
        await service.findAll('tenant-1', {});
        const arg = (db.lead.findMany as jest.Mock).mock.calls[0][0];
        expect(arg.orderBy).toEqual([{ next_step_date: 'asc' }, { updated_at: 'desc' }]);
    });
});
```

> If the existing spec exposes the db mock under a different name (e.g. `prisma`, `dbMock`), use that name. If the file mocks at module level rather than via an injected object, read the `mock.calls` off that same module mock. The assertions on `arg.orderBy` stay identical.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/backend && npx jest src/crm-leads/crm-leads.service.spec.ts -t "findAll sorting"`
Expected: FAIL — `orderBy` is still the hardcoded `[{ next_step_date: 'asc' }, { updated_at: 'desc' }]` for the first case (expected `{ name: 'desc' }`).

- [ ] **Step 3a: Implement — service**

In `apps/backend/src/crm-leads/crm-leads.service.ts`:

Add near the other imports at the top:

```ts
import { resolveOrderBy, SortableMap } from '../common/sort.util';
```

Add a module-level allowlist (place it above the `CrmLeadsService` class, after imports):

```ts
const LEAD_SORTABLE: SortableMap = {
    name: (dir) => ({ name: dir }),
    category: (dir) => ({ category: dir }),
    priority: (dir) => ({ priority: dir }),
    status: (dir) => ({ status: dir }),
    score: (dir) => ({ score: dir }),
    next_step_date: (dir) => ({ next_step_date: dir }),
    created_at: (dir) => ({ created_at: dir }),
};
const LEAD_DEFAULT_ORDER = [{ next_step_date: 'asc' as const }, { updated_at: 'desc' as const }];
```

Extend the `findAll` options type to include the two new fields (add these lines inside the existing `opts` type, alongside `page?: number; limit?: number;`):

```ts
            sortBy?: string;
            sortDir?: string;
```

Replace the hardcoded `orderBy` in the `db.lead.findMany` call. Change:

```ts
                orderBy: [{ next_step_date: 'asc' }, { updated_at: 'desc' }],
```

to:

```ts
                orderBy: resolveOrderBy(opts.sortBy, opts.sortDir, LEAD_SORTABLE, LEAD_DEFAULT_ORDER),
```

- [ ] **Step 3b: Implement — controller**

In `apps/backend/src/crm-leads/crm-leads.controller.ts`, extend the `findAll` handler. Add two query params to the signature (after `@Query('limit') limit?: string,`):

```ts
        @Query('sortBy') sortBy?: string,
        @Query('sortDir') sortDir?: string,
```

And pass them through in the `this.service.findAll(...)` options object (add after `limit: limit ? parseInt(limit, 10) : undefined,`):

```ts
            sortBy,
            sortDir,
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/backend && npx jest src/crm-leads/crm-leads.service.spec.ts`
Expected: PASS — including the 3 new sorting cases and all pre-existing cases.

Also confirm nothing else broke in the module:

Run: `cd apps/backend && npx jest src/crm-leads`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/crm-leads/crm-leads.service.ts apps/backend/src/crm-leads/crm-leads.controller.ts apps/backend/src/crm-leads/crm-leads.service.spec.ts
git commit -m "feat(crm-leads): accept sortBy/sortDir on the leads list endpoint"
```

---

### Task 3: DataTable server-pagination mode

**Files:**
- Modify: `apps/frontend/src/components/data-table/DataTable.tsx`
- Test: `apps/frontend/src/components/data-table/DataTable.test.tsx` (add a `describe` block)

**Interfaces:**
- Consumes: nothing new.
- Produces: `DataTableProps<T>` gains:

  ```ts
  serverPagination?: {
      total: number;
      page: number;                 // 1-based
      pageSize: number;
      onPageChange: (page: number) => void;
      onPageSizeChange: (size: number) => void;
      sort: { id: string; desc: boolean } | null;
      onSortChange: (sort: { id: string; desc: boolean } | null) => void;
  };
  ```

  Task 4 (Leads page) relies on this prop shape exactly.

- [ ] **Step 1: Write the failing test**

Add to `apps/frontend/src/components/data-table/DataTable.test.tsx` (after the existing tests, inside the top-level `describe` or as a new one):

```ts
describe('DataTable server pagination mode', () => {
    const serverBase = {
        total: 146,
        page: 1,
        pageSize: 10,
        onPageChange: jest.fn(),
        onPageSizeChange: jest.fn(),
        sort: null as { id: string; desc: boolean } | null,
        onSortChange: jest.fn(),
    };

    it('shows the server total in the footer, not the row count', () => {
        render(
            <DataTable
                {...defaultProps}
                showSearch={false}
                serverPagination={{ ...serverBase }}
            />,
        );
        // 3 rows are rendered but the footer reflects the server total of 146
        expect(screen.getByText(/of 146/i)).toBeInTheDocument();
    });

    it('calls onPageChange with the next 1-based page', () => {
        const onPageChange = jest.fn();
        render(
            <DataTable
                {...defaultProps}
                showSearch={false}
                serverPagination={{ ...serverBase, onPageChange }}
            />,
        );
        fireEvent.click(screen.getByRole('button', { name: '2' }));
        expect(onPageChange).toHaveBeenCalledWith(2);
    });

    it('emits onSortChange when a sortable header is clicked', () => {
        const onSortChange = jest.fn();
        render(
            <DataTable
                {...defaultProps}
                showSearch={false}
                serverPagination={{ ...serverBase, onSortChange }}
            />,
        );
        fireEvent.click(screen.getByText('Name'));
        expect(onSortChange).toHaveBeenCalledWith({ id: 'name', desc: false });
    });
});
```

> Note: the page-number buttons render their 1-based label (`p + 1`), so page index 1 shows as button "2". With `total: 146` and `pageSize: 10` there are 15 pages, so a "2" button exists.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/frontend && npx jest src/components/data-table/DataTable.test.tsx -t "server pagination"`
Expected: FAIL — footer shows "of 3" (client row count), `onPageChange`/`onSortChange` never called.

- [ ] **Step 3a: Implement — prop type**

In `apps/frontend/src/components/data-table/DataTable.tsx`, add to the `DataTableProps<T>` interface (after the `density?: UiDensity;` line, before the closing brace):

```ts
    /** Opt-in server-side pagination + sorting. When set, the table drives page/size/sort
     *  through these callbacks and uses `total` for the footer count instead of the
     *  client row count. Pages using this must also set `showSearch={false}` and render
     *  their own server-backed search. */
    serverPagination?: {
        total: number;
        page: number;
        pageSize: number;
        onPageChange: (page: number) => void;
        onPageSizeChange: (size: number) => void;
        sort: { id: string; desc: boolean } | null;
        onSortChange: (sort: { id: string; desc: boolean } | null) => void;
    };
```

- [ ] **Step 3b: Implement — destructure the prop**

Find where props are destructured in the component signature and add `serverPagination`. (Locate it: `grep -n "density," apps/frontend/src/components/data-table/DataTable.tsx` finds the destructure block; add `serverPagination,` alongside the other destructured props.)

- [ ] **Step 3c: Implement — derived server state**

These values are read inside the `useReactTable` config, so they must be declared BEFORE it. Add these lines just above `const table = useReactTable({` (~line 296):

```ts
    const isServer = !!serverPagination;
    const serverSorting: SortingState = serverPagination?.sort
        ? [{ id: serverPagination.sort.id, desc: serverPagination.sort.desc }]
        : [];
    const effectivePageSize = serverPagination ? serverPagination.pageSize : pageSize;
    const serverPageIndex = serverPagination ? serverPagination.page - 1 : 0;
```

- [ ] **Step 3d: Implement — table config**

Modify the `useReactTable({ ... })` config object:

Replace the `state` fields for `sorting` and `pagination`:

```ts
            sorting: isServer ? serverSorting : sorting,
```
```ts
            pagination: { pageIndex: serverPageIndex, pageSize: effectivePageSize },
```

Replace `onSortingChange: setSorting,` with:

```ts
        onSortingChange: isServer
            ? (updater) => {
                  const next =
                      typeof updater === 'function' ? updater(serverSorting) : updater;
                  const first = next[0] ?? null;
                  serverPagination!.onSortChange(
                      first ? { id: first.id, desc: first.desc } : null,
                  );
              }
            : setSorting,
```

Add an `onPaginationChange` handler (there is none today; add it near `onSortingChange`):

```ts
        onPaginationChange: isServer
            ? (updater) => {
                  const prev = { pageIndex: serverPageIndex, pageSize: effectivePageSize };
                  const next = typeof updater === 'function' ? updater(prev) : updater;
                  if (next.pageSize !== prev.pageSize) {
                      serverPagination!.onPageSizeChange(next.pageSize);
                  } else if (next.pageIndex !== prev.pageIndex) {
                      serverPagination!.onPageChange(next.pageIndex + 1);
                  }
              }
            : undefined,
```

Add these three config keys (anywhere in the config object, e.g. after `columnResizeMode: 'onChange',`):

```ts
        manualPagination: isServer,
        manualSorting: isServer,
        pageCount: isServer
            ? Math.max(1, Math.ceil(serverPagination!.total / serverPagination!.pageSize))
            : undefined,
```

- [ ] **Step 3e: Implement — footer counts**

Find `const totalRows = table.getFilteredRowModel().rows.length;` (~line 434) and replace with:

```ts
    const totalRows = isServer
        ? serverPagination!.total
        : table.getFilteredRowModel().rows.length;
```

Find `const currentPage = table.getState().pagination.pageIndex;` (~line 435) — this already reflects `serverPageIndex` via controlled state, so leave it. Then update `startRow`/`endRow` (~lines 437-438) to use `effectivePageSize`:

```ts
    const startRow = currentPage * effectivePageSize + 1;
    const endRow = Math.min((currentPage + 1) * effectivePageSize, totalRows);
```

- [ ] **Step 3f: Implement — page-size selector value**

Find the page-size `<select value={pageSize}` (~line 788) and change its value to the effective size:

```ts
                                value={effectivePageSize}
```

Leave `handlePageSizeChange` as-is — it calls `table.setPageSize(size)`, which now routes through `onPaginationChange` in server mode (firing `onPageSizeChange`) while still updating local state for client mode.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/frontend && npx jest src/components/data-table/DataTable.test.tsx`
Expected: PASS — the 3 new server-mode tests AND all pre-existing DataTable tests (proves client mode is unregressed).

- [ ] **Step 5: Commit**

```bash
git add apps/frontend/src/components/data-table/DataTable.tsx apps/frontend/src/components/data-table/DataTable.test.tsx
git commit -m "feat(data-table): add opt-in server-side pagination and sorting mode"
```

---

### Task 4: Wire the CRM Leads page to server pagination

**Files:**
- Modify: `apps/frontend/src/lib/api.ts` (the `getLeads` signature/query, ~lines 489-501)
- Modify: `apps/frontend/src/app/(app)/crm/leads/page.tsx`

**Interfaces:**
- Consumes: `DataTable`'s `serverPagination` prop (Task 3); the leads endpoint's `sortBy`/`sortDir` params (Task 2).
- Produces: user-facing behavior — Leads footer shows the real total; all rows reachable; column sort spans the whole dataset.

- [ ] **Step 1: Extend the API client**

In `apps/frontend/src/lib/api.ts`, update `getLeads`. Change the params type to add `sortBy`/`sortDir`:

```ts
    getLeads: (params?: { status?: string; source?: string; category?: string; priority?: string; assignedTo?: string; myActionsToday?: boolean; search?: string; page?: number; limit?: number; sortBy?: string; sortDir?: string }) => {
```

And append to the query builder (after the `if (params?.limit) query.set('limit', String(params.limit));` line):

```ts
        if (params?.sortBy) query.set('sortBy', params.sortBy);
        if (params?.sortDir) query.set('sortDir', params.sortDir);
```

- [ ] **Step 2: Add pagination + sort state to the Leads page**

In `apps/frontend/src/app/(app)/crm/leads/page.tsx`, alongside the other `useState` hooks (near `const [debouncedSearch, setDebouncedSearch] = useState('')`, ~line 87), add:

```ts
    const [total, setTotal] = useState(0);
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(20);
    const [sort, setSort] = useState<{ id: string; desc: boolean } | null>(null);
```

- [ ] **Step 3: Feed page/size/sort into the fetch and read the total**

Replace the body of `loadLeads` (~lines 110-127) so it sends pagination + sort and stores the total:

```ts
    const loadLeads = useCallback(async () => {
        setLoading(true);
        try {
            const data = await api.getLeads({
                search: debouncedSearch || undefined,
                status: statusFilter || undefined,
                category: categoryFilter || undefined,
                priority: priorityFilter || undefined,
                myActionsToday: myTodaysActions || undefined,
                page,
                limit: pageSize,
                sortBy: sort?.id,
                sortDir: sort ? (sort.desc ? 'desc' : 'asc') : undefined,
            });
            setLeads(data?.items ?? data ?? []);
            setTotal(data?.total ?? (Array.isArray(data) ? data.length : 0));
        } catch {
            setLeads([]);
            setTotal(0);
        } finally {
            setLoading(false);
        }
    }, [debouncedSearch, statusFilter, categoryFilter, priorityFilter, myTodaysActions, page, pageSize, sort]);
```

- [ ] **Step 4: Reset to page 1 when filters/search/sort change**

Add an effect right after the `useEffect(() => { void loadLeads(); }, [loadLeads]);` line (~line 129):

```ts
    // Any change to filters/search/sort returns to the first page.
    useEffect(() => {
        setPage(1);
    }, [debouncedSearch, statusFilter, categoryFilter, priorityFilter, myTodaysActions, sort]);
```

> Ordering note: this effect and `loadLeads` both react to filter changes. Because `setPage(1)` triggers a state change, `loadLeads` re-runs with `page === 1`. When already on page 1 the value is unchanged and React skips the extra render — no double fetch in the common case.

- [ ] **Step 5: Mark only allowlisted columns sortable, and disable the rest**

In the `columns` `useMemo` (~lines 170-233), add `enableSorting: false` to the column defs whose keys are NOT in the backend allowlist (`mobile`, `next_step`, `nextStepAssignee`), to the custom-field columns, and to the `actions` display column. The allowlisted sortable columns (`name`, `category`, `priority`, `status`, `score`, `next_step_date`) keep the default (sortable).

Concretely:
- `columnHelper.accessor('mobile', { header: m.fields.mobile })` → `columnHelper.accessor('mobile', { header: m.fields.mobile, enableSorting: false })`
- `columnHelper.accessor('next_step', { header: m.fields.nextStep, cell: ... })` → add `enableSorting: false,`
- `columnHelper.accessor('nextStepAssignee', { header: m.fields.nextStepAssignedTo, cell: ... })` → add `enableSorting: false,`
- each custom-field `columnHelper.accessor((row) => ..., { id: \`cf_${def.key}\`, header: def.label, cell: ... })` → add `enableSorting: false,`
- the `columnHelper.display({ id: 'actions', ... })` → add `enableSorting: false,`

> The accessorKey becomes the column `id`, so the sortable columns already emit the correct `sortBy` keys (`name`, `category`, `priority`, `status`, `score`, `next_step_date`) that Task 2's allowlist accepts.

- [ ] **Step 6: Pass `serverPagination` to the DataTable**

In the `<DataTable<Lead> ... />` usage (~line 345), add the `serverPagination` prop (place it near `data={leads}`):

```tsx
                serverPagination={{
                    total,
                    page,
                    pageSize,
                    onPageChange: setPage,
                    onPageSizeChange: (size) => { setPageSize(size); setPage(1); },
                    sort,
                    onSortChange: setSort,
                }}
```

`showSearch={false}` is already set on this table, satisfying the server-mode requirement.

- [ ] **Step 7: Typecheck and run the frontend suite**

Run: `cd apps/frontend && npx tsc --noEmit`
Expected: no new type errors in `api.ts`, `DataTable.tsx`, or `crm/leads/page.tsx`.

Run: `cd apps/frontend && npx jest src/components/data-table/DataTable.test.tsx`
Expected: PASS (unchanged).

- [ ] **Step 8: Commit**

```bash
git add apps/frontend/src/lib/api.ts "apps/frontend/src/app/(app)/crm/leads/page.tsx"
git commit -m "feat(crm-leads): drive leads table with server pagination and sorting"
```

---

### Task 5: End-to-end verification of the Leads slice

**Files:** none (verification only).

- [ ] **Step 1: Start backend + frontend**

Use the project's normal dev startup (e.g. `npm run dev` at the repo root, or per-app dev scripts). Ensure a tenant with >100 leads exists (the reported case: 146). If no such data exists locally, seed or import enough leads to exceed 100.

- [ ] **Step 2: Verify the footer total**

Open CRM → Leads. Confirm the footer reads "Showing 1–20 of 146" (or the true count), NOT "of 100" and NOT "of 20".
Expected: total matches `SELECT count(*)` for that tenant's leads.

- [ ] **Step 3: Verify all records are reachable**

Click through to the last page. Confirm you can reach leads beyond row 100 (e.g. the 146th).
Expected: last page shows the final rows; no rows are stranded.

- [ ] **Step 4: Verify sort spans the whole dataset**

Sort by Name ascending. Confirm page 1 starts with the globally-first name (e.g. a name starting with 'A'/'অ'), not merely the first of the previously-loaded page. Toggle to descending and confirm it flips.
Expected: sorting reorders across all 146 rows, not just the visible page.

- [ ] **Step 5: Verify search + filter still work and reset to page 1**

Navigate to page 3, then type in the search box / change a status filter. Confirm the list returns to page 1 and the total updates to the filtered count.
Expected: filtered total shown; page resets.

- [ ] **Step 6: Record the result**

Note the observed totals/behavior in the PR description or session notes. If any step fails, return to the relevant task rather than patching symptoms.

---

## Follow-up (out of scope for this plan — separate plans)

Once this slice is verified, replicate Tasks 2 + 4 per remaining page, grouped by the rollout order in the spec:

- Rollout step 3 (100-limit): crm/customers, crm/tasks, accounting/expenses, accounting/loans, admin/users, hr/leaves, hr/salary-payments, purchases/supplier-payments, sales/customer-payments.
- Rollout step 4 (20/50/200/500-limit): accounting/reconciliation, accounting/vouchers, crm/campaigns, hr/attendance, sales/customer-ledger, purchases/supplier-ledger, sales/price-lists/[id].

Each page: define its backend `SORTABLE` allowlist + default order, wire `sortBy`/`sortDir` through its controller/service, add `page`/`pageSize`/`sort` state to the page, and pass `serverPagination` to its DataTable. `DataTable` and `resolveOrderBy` need no further changes.

Documented limitation to carry forward: export/print in server mode covers the current page only.
