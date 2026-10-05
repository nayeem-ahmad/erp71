# Branch filter on branch-aware pages and reports

**Date:** 2026-10-05
**Status:** Draft pending review
**Asked as:** “for UIs and reports where branch is a parameter — need filter
with branch (selected at the top) and filter all data in the UI / report with
that branch. If the user is not allowed to access other branches, branch
selection should be made disabled.”

---

## Problem

A branch is a `Store`. The app shell header has a branch dropdown that writes
`store_id` into the tab's workspace and sends it as `x-store-id` on every
request. `TenantInterceptor` validates that header against the member's
`UserStoreAccess` rows — but almost nothing then **filters data** by it:

- Every module dashboard, every transaction list (sales, orders, quotes,
  returns, purchases, vouchers, expenses, imports…) and most reports return the
  whole company whichever branch the header shows. Only the daily report reads
  the header store, and only as a fallback.
- Seven reports carry their own page-local branch `<select>` (five inventory
  reports, sales and purchase line items), each copied inline, each defaulting
  to “All branches” for everyone. The sales branch report and the accounting
  P&L / balance sheet / trial balance (`ReportScopeBar`) have their own pickers
  again. No shared component exists.
- Reports whose API already accepts `storeId` (sales summary, gross profit,
  purchase summary, Mushak, loans, investors, fund transfers…) never send it.

And the access rule is not enforced for any **query** store id. No endpoint
compares a `storeId` query/path/body parameter with the caller's branch
access. A member who may use only branch A sends `x-store-id: A` (which the
guard checks) and `?storeId=B` (which nothing checks) and reads B's sales,
purchases, stock, expenses, daily report, and — via `scope=branch` — its P&L,
balance sheet and trial balance. Omitting `storeId` returns all branches with
no `VIEW_CONSOLIDATED_REPORTS` check on any endpoint except accounting
P&L/BS/TB and `/sales-reports/consolidated`. A disabled picker in the UI would
be cosmetic without closing this.

## Goals

- Every page that shows branch-owned data has **one** branch filter, in the
  same place (`PageHeader` actions), behaving the same way.
- The filter **starts on the header's branch**. Changing it affects that page
  only; changing the header moves every page to the new branch.
- A member who can reach **only one branch** sees the filter **disabled** on
  that branch.
- **“All branches”** is offered only to members allowed to see the whole
  company (owner, or `VIEW_CONSOLIDATED_REPORTS`).
- The **backend enforces** the same rule on every branch-aware read: a
  requested branch must be one the member may use, and “all” requires the
  consolidated permission.

## Non-goals

- Enforcing `SWITCH_STORES` or `UserStoreAccess.access_level`. The lock rule
  is the set of access rows, which is what the backend already enforces
  (decision 2 below). The TODO about those two unenforced settings stays open.
- Company-level records with no branch of their own: customers, suppliers,
  products, employees, customer credit / AR.
- Voucher-ledger reports where most rows are company-level (cashbook,
  bankbook, account ledger, AR/AP aging, cash flow, VAT, ratios,
  budget-vs-actual, comparative P&L), HR attendance, and CRM — phase 5, later.
- Entry forms (new sale, new purchase, …). They keep recording against the
  header branch.
- A “my branches” union option for multi-branch members without the
  consolidated permission. They pick one branch at a time.
- Changing the header switcher itself (it still hides when the member has one
  branch and shows the branch name as text).

## Decisions

Confirmed with the user on 2026-10-05:

1. **Header link — page starts on header.** The page filter defaults to the
   header branch. A change on a page is page-local and lives in the URL
   (`?branch=`), so reloads and shared links keep it. Changing the header drops
   any `?branch=` from the current page and every page follows the new header
   branch. “All branches” exists only on pages, because the header branch is
   also the write context (where new sales and purchases are recorded) and the
   branch permission checks run against.
2. **Lock rule — has one branch.** The filter is disabled when the member has
   access rows for exactly one branch of a multi-branch tenant. Members with
   several branches pick among them. “All branches” needs owner or
   `VIEW_CONSOLIDATED_REPORTS`.
3. **Scope — phases 0–4** in the first delivery (foundation, access fix,
   reports, dashboards, transaction lists). Phase 5 stays in TODO.md.

## Access rules (single source of truth)

For a request in tenant T, by user U, with header branch H:

| Requested `storeId` | Allowed when | Resolves to |
|---|---|---|
| a branch id S | OWNER and S belongs to T; or U has a `UserStoreAccess` row for S in T **and** holds one of the endpoint's read permissions in S | `[S]` |
| `all` | OWNER; or U holds `VIEW_CONSOLIDATED_REPORTS` in H | whole tenant |
| omitted | always | OWNER / consolidated → whole tenant (today's behaviour, kept for old clients, the AI tools and scripts); everyone else → `[H]` (400 if H is unset, same as `StorePermissionGuard`) |

Anything else is **403** (`You do not have access to this branch` /
`VIEW_CONSOLIDATED_REPORTS permission required to view all branches`).

The consolidated check is made against the header branch's grants, the same
place `StorePermissionGuard` and the accounting reports check it today.
`/auth/me` reports the union of a member's grants across branches, so a member
whose per-branch matrix grants `VIEW_CONSOLIDATED_REPORTS` in some branches
but not in the header branch is offered “All branches” and gets a 403. Role
templates materialise the same permissions in every branch, so this needs a
hand-edited matrix. The page shows the 403 as an inline error and offers
switching back to the header branch.

Endpoints that are inherently one-branch (daily report, sales branch report,
cashier sessions, POS counters) call the resolver with `allowAll: false`: `all`
is a 400 and omitted resolves to `[H]` for everyone.

## Backend design

### `BranchScopeService` — `apps/backend/src/database/branch-scope.service.ts`

Lives next to `member-access.loader.ts` and is built only from its cached
loaders (`loadMemberStoreAccess`, `loadMemberStoreGrants`,
`storeBelongsToTenant`). It issues no uncached queries, so a report pays no
extra round trip in the common case.

```ts
type ResolveOptions = {
  /** Any-of read permissions the member must hold in the requested branch. */
  permissions?: readonly StorePermission[];
  /** One-branch endpoints: `all` is a 400, omitted is the header branch. */
  allowAll?: boolean; // default true
};

/** `undefined` = whole tenant; otherwise exactly one validated branch id. */
resolveStoreId(ctx: TenantContext, requested: string | undefined, opts?: ResolveOptions): Promise<string | undefined>;

/** Compare mode (accounting P&L/BS/TB): every id must pass the single-branch rule. */
resolveStoreIds(ctx: TenantContext, requested: string[], opts?: ResolveOptions): Promise<string[]>;

/** Whether the caller may see the whole tenant — OWNER or the consolidated grant in H. */
canSeeAllBranches(ctx: TenantContext): Promise<boolean>;
```

**Call-site pattern.** The controller resolves and overwrites the query's
store id before handing it to the service, so existing services that already
spread `...(query.storeId ? { store_id: query.storeId } : {})` need no change:

```ts
@Get('summary')
async summary(@Tenant() tenant: TenantContext, @Query() query: SalesReportQueryDto) {
  const storeId = await this.branchScope.resolveStoreId(tenant, query.storeId, { permissions: SALES_READ });
  return this.service.getSalesSummary(tenant.tenantId, { ...query, storeId });
}
```

DTOs whose `storeId` is `@IsUUID()` accept the literal `all` too. A shared
`IsStoreIdOrAll()` validator replaces the per-DTO decorator.

**Accounting P&L / BS / TB.** `parseReportScopeFromQuery` keeps
`scope`/`storeId`/`storeIds`. `scope=branch` runs `storeId` through
`resolveStoreId`. `scope=compare` runs `storeIds` through `resolveStoreIds`
after the existing consolidated check. `scope=company` keeps that check.

**Endpoints that today take no store id** (dashboards, transaction lists) gain
an optional `storeId` query param, validated the same way, and a
`store_id` filter in their `where`. Where the branch is reached through a
warehouse (stock, transfers, demands, stock takes, shrinkage, stock ledger),
the filter is `warehouse: { store_id }`. For transfers, the source **or**
destination warehouse is in the branch. Fund transfers match the source **or**
destination store. Vouchers with `store_id = null` (company-level) appear only
under “All branches”, matching the P&L branch scope.

**Also fixed in passing:**

- `daily-report.controller.ts:28` — the query id no longer overrides the
  validated header without a check.
- `sales-reports/branch-report` — the branch is checked against access, not
  only the tenant.
- `cashier-sessions/store/:storeId[/open]`, `counters?storeId=` — path and
  query ids are validated.
- `investors.service.ts` profit-run preview/create — stops hard-coding
  `hasConsolidatedAccess = true` and passes the real answer.
- `ai/tools/types.ts` `resolveStoreId` — validates against the member's
  branches (owner: all), not every tenant store.

### `/auth/me`

Each tenant entry gains `store_count` (the tenant's total branches, via a
`_count` on the query `/auth/me` already runs). The frontend needs it to tell
“the shop has one branch” (hide the filter — nothing to choose) from “this
member is limited to one of several” (show it disabled). No other payload
change: `stores` (accessible branches) and `permissions` (union) are already
there.

## Frontend design

### `useBranchScope` — `apps/frontend/src/lib/branch-scope.ts`

```ts
type BranchValue = string | 'all';

useBranchScope(opts?: { allowAll?: boolean /* default true */ }): {
  branches: { id: string; name: string }[]; // accessible, from /auth/me
  headerBranchId: string | null;            // getWorkspaceItem('store_id')
  value: BranchValue;                       // ?branch=… if valid, else headerBranchId
  setValue(next: BranchValue): void;        // router.replace with ?branch=, or drops it when next === headerBranchId
  canSeeAll: boolean;                       // allowAll && (OWNER || VIEW_CONSOLIDATED_REPORTS)
  locked: boolean;                          // branches.length === 1 && store_count > 1
  hidden: boolean;                          // store_count <= 1
  apiStoreId: BranchValue;                  // what to send as `storeId`; also goes in query keys
};
```

- An invalid `?branch=` (a branch the member cannot use, or `all` without
  `canSeeAll`) silently falls back to the header branch. The server would 403
  it anyway.
- `apiStoreId` is part of every affected query key, next to the existing
  `workspaceScope()`, so changing the filter is a fresh query, not a cache hit.
- `canViewConsolidatedReports` moves here from `accounting-report-scope.ts`
  (re-exported there for existing imports).

### `BranchFilter` — `apps/frontend/src/components/ui/BranchFilter.tsx`

Exported from `@/components/ui`. It takes the hook's result and renders the
shared `Select`:

- options: the accessible branches, plus “All branches” first when
  `canSeeAll`;
- `locked` → disabled, showing the one branch, with a `title` and
  `aria-describedby` hint “You have access to this branch only”;
- `hidden` → renders nothing;
- label “Branch” (visually hidden on `md+` beside the header, visible on
  mobile), `min-h-touch`, the standard compact form-field classes, no new
  colours.

Placed in `PageHeader`'s `actions` on every in-scope page, first in the row.
Pages with an existing inline branch select drop it. The inventory reports
keep their warehouse select, now filtered to the chosen branch (all warehouses
under “All branches”).

### App shell

`handleStoreChange` in `app/(app)/layout.tsx` also strips `branch` from the
current URL (`router.replace`) before its existing `resetWorkspaceQueries` +
`router.refresh()`, so the page snaps to the new header branch.

### `ReportScopeBar` (accounting P&L / BS / TB)

The “This branch / All branches” radios and the branch `<select>` go: the
page's `BranchFilter` drives them (`all` → `scope=company`, a branch →
`scope=branch&storeId=`). “Compare branches” stays as a checkbox for
`canConsolidate` members. When ticked it overrides the filter and shows the
existing branch checkboxes and the company-overhead toggle.

### Copy

New keys in all nine locales: `branchFilter.label` (“Branch”),
`branchFilter.all` (“All branches”), `branchFilter.lockedHint` (“You have
access to this branch only”), `branchFilter.forbidden` (the inline 403 text).
Existing per-page `allBranches` strings are removed with their selects.

## Rollout

| Phase | Pages (frontend) | Endpoints (backend) |
|---|---|---|
| **0 Foundation** | `useBranchScope`, `BranchFilter`, shell URL reset | `BranchScopeService`, `IsStoreIdOrAll`, `/auth/me` `store_count` |
| **1 Existing branch params + access fix** | inventory stock-on-hand, valuation, reorder, shrinkage, product-transaction-history; sales and purchase line items; sales branch report (`allowAll: false`); daily report (`allowAll: false`); accounting P&L, balance sheet, trial balance; cashier sessions (`allowAll: false`); Mushak 6.2 / 6.10 | `inventory-reports/*`, `sales-reports/line-items`, `purchase-reports/line-items`, `sales-reports/branch-report`, `daily-report`, accounting P&L/BS/TB scope parsing, `cashier-sessions/store/:storeId*`, `counters`, `mushak/*`; AI `resolveStoreId`; investor profit-run consolidated check |
| **2 Reports with unused `storeId`** | sales summary, products, customers, monthly; gross profit, bridge, exceptions, salespeople; purchase summary, by-product, by-supplier; expense reports; loans; investors; inter-branch fund transfers | `sales-reports/*` (monthly-by-customer gains `storeId`), `purchase-reports/*`, `expenses/summary`, `loans`, `investors` (list, profit runs), `fund-transfers` (source **or** destination) |
| **3 Dashboards** | main dashboard (`RetailDashboard`); sales, purchase, inventory, accounting dashboards | `sales/dashboard/*`, `purchases/dashboard/*`, `inventory/dashboard/*`, `accounting/dashboard/*`, plus the endpoints `RetailDashboard` composes: financial KPIs and trends (voucher-based, so a branch excludes company-level vouchers), sales by category, product and customer (already take `storeId`), low-stock count, and the sales list (phase 4's `storeId`) |
| **4 Transaction lists** | sales, orders, quotes, returns, warranty claims; purchases, orders, quotations, returns; imports (+ duty report, LC register); vouchers, journal; expenses; stock takes, shrinkage, transfers, demands, stock ledger | `GET /sales`, `/sales-orders`, `/sales-quotations`, `/sales-returns`, `/warranty-claims`; `/purchases`, `/purchase-orders`, `/purchase-quotations`, `/purchase-returns`; `/imports` (+ `lc-register`, `duty-report`); `/accounting/vouchers` (serves both the vouchers and journal pages); `/expenses/entries`; `/stock-takes`, `/inventory-shrinkage`, `/warehouse-transfers`, `/product-demands`, `/inventory/ledger` (inventory lists reach the branch through the warehouse). DataTable export honours the filter |
| **5 Later (TODO)** | cashbook, bankbook, ledger, AR/AP aging, cash flow, VAT, ratios, budget-vs-actual, comparative P&L; HR attendance; CRM | — |

Each phase lands as its own commit series on one integration branch and one
PR into `dev`. Phases 1–4 are page-by-page, so they parallelise. Per the
two-agents limit on this machine, they run at most two at a time.

## Behaviour changes users will notice

- **Members without `VIEW_CONSOLIDATED_REPORTS`** — the module *user* roles
  (Sales User, Purchase User, Inventory User, Accounting User, …) — stop seeing
  company-wide numbers on dashboards, lists and reports, and see their header
  branch instead. Owners, Tenant Admin and the module *manager* roles keep
  “All branches”. This is the point of the change, but it is visible and
  belongs in the release note.
- Every in-scope page now **opens on the header branch**, including for
  owners. The inventory reports and line-items reports used to open on “All
  branches”. One click (or a bookmarked `?branch=all`) gets it back.
- A crafted `storeId` for a branch the member cannot use now returns 403
  instead of that branch's data.

## Edge cases

- **Single-branch tenant** — `store_count === 1`: the filter is hidden.
  Requests carry the one branch, which equals the whole tenant.
- **Member with zero access rows** — no header branch, so omitted `storeId`
  fails with 400, as `StorePermissionGuard` already does. The filter renders
  nothing.
- **Bookmarked `?branch=` for a branch since removed from the member** — the
  frontend falls back to the header branch; the server would 403 it anyway.
- **Export / print** — DataTable export and the report print paths read the
  same filtered query, and print headers name the filtered branch (or the
  company under “All branches”).
- **Deep links that set a branch** (`?storeId=` on line-items today) —
  `?storeId=` is read once as an alias of `?branch=` and rewritten.

## Testing

- **`BranchScopeService` unit tests:** owner with any tenant branch; owner with
  a foreign tenant's branch (403); single-branch member (own branch ok, other
  403, `all` 403, omitted → H); multi-branch member without consolidated
  (each own branch ok, `all` 403, omitted → H); consolidated member (`all`
  ok, omitted → all); missing read permission in the requested branch (403);
  `allowAll: false` (`all` 400, omitted → H for owners too); compare ids with
  one foreign id (403).
- **Controller tests per endpoint group:** the resolved id reaches the service.
  A foreign id is rejected before the service runs. Add a regression test for
  each hole closed in phase 1.
- **Frontend:** `useBranchScope` (header default; URL override; invalid URL
  value falls back; `canSeeAll` gating; `locked` vs `hidden`) and
  `BranchFilter` rendering (disabled + hint; “All” only when allowed). Update
  the existing tests of each migrated page. Add a shell test that a header
  change drops `?branch=`.
- Suites run sequentially (backend then frontend) and `next lint --quiet` over
  the whole app before the PR.
