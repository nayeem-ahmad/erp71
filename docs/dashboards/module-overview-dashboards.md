# Module Overview dashboards — design

Status: **proposed** (2026-08-04). Not started. Supersedes nothing; generalises
`docs/crm/crm-dashboard-design.md`, which is the one worked example.

Every module's **Overview** should answer "what is happening in this module right
now", the way CRM > Overview does since 2026-08-04. Today six of the seven are a
grid of links that repeats the sidebar the user is already looking at.

Scope decided with the user: **all seven modules with an Overview node** —
Sales, Purchases, Accounting, Inventory, CRM (done), HR, Admin. The shared
pattern is **extracted first**, before the second dashboard is written. The hub
link grid **stays visible** below the dashboard on every module.

---

## 1. What the CRM build established

Five decisions to copy verbatim, each with a cost attached to doing otherwise.

**1. No new route, no new nav node.** `<module>.overview` already points at the
module root — `navigation.ts:59` (`/sales`), `:93` (`/purchases`), `:110`
(`/accounting`), `:153` (`/inventory`), `:177` (`/crm`), `:192` (`/hr`), `:225`
(`/admin`). A `/x/dashboard` route costs a registry node *plus* a layout row for
every tenant that has customised its sidebar (`scripts/sync-nav-layout.ts`), and
leaves "Overview" pointing at a grid that only repeats the sidebar. Two entries
for one idea, seven times over.

**2. Dashboard above the hub, hub kept below.** `ModuleHub` renders `children`
directly under its `PageHeader` (`ModuleHub.tsx:83–90`), which is the mount
point. The dashboard takes `variant="embedded"` there and drops its own
`PageShell` and greeting block, because the hub already supplies both.

**3. One aggregate endpoint per module.** `GET /<module>/dashboard/overview?from&to`,
plus `/trends` where sparklines are wanted. Not six list calls — the page must
paint in one round trip. Same shape as `GET /accounting/dashboard/overview`
(`accounting.controller.ts:306`) and `/crm/dashboard/overview`.

**4. Degrade to the hub, never to a 403 wall.** `/crm` renders the plain hub for
a tenant without `premiumCrm`. Every module does the same against its own gate.

**5. Local calendar dates.** `rangeToDateWindow` / `previousDateWindow`
(`lib/dashboard-range.ts`), never `toISOString()` on a date bound — a Dhaka
midnight sent as UTC lands in the previous day and "today" silently covers two.
The server parses date-only bounds as local midnight at the other end.

---

## 2. Phase 0 — extract the shell before writing the second one

`CrmDashboard.tsx` is 484 lines. Roughly 120 of them are pattern rather than CRM,
and `AccountingDashboard.tsx:89–104` already contains the same 120 in slightly
different words — same five `useState`s, same `Promise.allSettled` of
current/previous/trends, same `animate-pulse` tile skeleton, same `periodDelta`
comparison. `RetailDashboard.tsx:111–122` is a third divergent copy. Writing five
more before extracting is how this ends as seven drifting dashboards.

### `lib/use-module-dashboard.ts`

```ts
export function useModuleDashboard<TOverview, TTrend>({
  fetchOverview,          // (window: {from, to}) => Promise<TOverview>
  fetchTrends,            // optional
  initialRange = 'month',
  unavailableMessage,
}): {
  range, setRange,
  overview: TOverview | null,
  previous: TOverview | null,   // comparison window; null costs a "—", not the page
  trends: TTrend[],
  loading, error,
  deltaContext: string,         // "vs previous week" etc., keyed off range
  compare: (current, prior) => { label: string; positive: boolean },
}
```

Owns the cancellation flag, the `Promise.allSettled` degradation rule (overview
failure sets `error`; previous/trends failures are silent), and the
`DELTA_CONTEXT` lookup that both existing dashboards hand-roll.

### `components/dashboard/ModuleDashboard.tsx`

Shell only — no data. Handles the `page` / `embedded` branch (`PageShell` +
`DashboardHeader`, versus a right-aligned `RangeTabs` alone), the amber error
banner, and `<DashboardSection label>` wrappers. Two more small pieces come with
it, both lifted from `CrmDashboard`'s render body:

- `KpiTileGrid` — the `grid-cols-2 xl:grid-cols-4` band of four `HealthKpiTile`s
  plus its four-tile skeleton and the `delta === '—' → no deltaContext` rule.
- `AttentionSection` — `AttentionStrip` plus its three-block skeleton.

### Standard band order, fixed once

```
Needs attention   AttentionStrip — red/amber/blue, links into the work
Health            4 × HealthKpiTile with sparkline + Δ vs previous window
Primary analysis  the one module-specific form (funnel, chart, aging table)
Ranked lists      2–3 × RankedListPanel
```

CRM currently renders Health above Attention; the extraction settles on
Attention first — the whole point of the strip is that it is the first thing
read — and `CrmDashboard.test.tsx` is updated with it.

### Acceptance for Phase 0

`CrmDashboard` refactored onto the shell with **no behaviour change**, and
`CrmDashboard.test.tsx` + `PipelineFunnel.test.tsx` green as the proof. Nothing
else ships in this phase.

---

## 3. Gating — no new plan feature, and no invented permissions

**No module Overview gets a new plan feature.** `crmDashboard` exists only
because CRM is a *landing* variant at `/dashboard`; a module Overview is reached
by clicking that module, so the tenant has already passed whatever gate the
module has. Adding `salesDashboard`, `hrDashboard` and five more would also each
need the "never grant from an add-on" warning that `mergeAddonFeatures` forces
(`subscription-plans.ts:164–175`), for no benefit.

**Each dashboard inherits its own module's existing guard stack**, which is
genuinely heterogeneous and must not be flattened into a uniform invented one:

| Module | Existing guard on its data | Overview dashboard gate |
|---|---|---|
| Sales | `StorePermissionGuard` + `@RequiresPlan('BASIC')` (`sales-reports.controller.ts:26–29`) | same |
| Purchases | `TenantRoleGuard` + `@RequiresPlan('BASIC')` (`purchase-reports.controller.ts:11–14`) | same |
| Accounting | `VIEW_LEDGER` (as `layout.tsx:256` already tests) | same |
| Inventory | `@RequiresFeature('premiumInventoryReports')` (`inventory-reports.controller.ts:11–13`) | same, with the non-premium subset still shown |
| CRM | `premiumCrm` + `VIEW_LEADS` | unchanged |
| HR | `JwtAuthGuard` only today (`employees.controller.ts:17–18`) | needs a decision — see §7 |
| Admin | `PlatformAdminGuard` (`admin-metrics.controller.ts:6–7`) | same |

There is **no** `VIEW_SALES`, `VIEW_PURCHASES`, `VIEW_INVENTORY` or
`VIEW_EMPLOYEES` in `StorePermission` (`packages/shared-types/index.ts:29–95`).
Any plan that assumes one is wrong.

On the frontend, one hook covers the whole gate: `useTenantPlanFeatures()`
already returns `{ planCode, features, permissions, ready }`. Adopting it also
deletes four hand-rolled `api.getMe()` blocks that do the same thing —
`sales/page.tsx:79–89`, `purchases/page.tsx:66`, `inventory/page.tsx:58`,
`accounting/page.tsx:25–35`.

**`ready` before rendering.** `/crm` waits for the plan rather than painting the
dashboard and pulling it away (`crm/page.tsx:84–90`); every module does the same.

---

## 4. Per module

Data sources listed only where they already exist; anything unlisted is new
aggregation in the module's `*-dashboard` service.

### Accounting — the pilot

Component and endpoint both exist and are already wired to each other; today
`AccountingDashboard` is reachable *only* if the tenant happens to land on it at
`/dashboard`. The work is: add the `variant?: 'page' | 'embedded'` prop it lacks
(`AccountingDashboard.tsx:84`), move it onto the Phase-0 shell, and embed it in
`accounting/page.tsx` behind `VIEW_LEDGER`. No new backend at all.

This is deliberately first: it proves the shell against a second consumer before
any new endpoint is written, and it closes a real gap for free.

### Inventory

- **Attention** — out of stock, below reorder point, negative stock, open stock takes
- **Health** — stock value, active SKUs, shrinkage in period, turnover
- **Primary** — stock aging (reuse `AgingPanel`)
- **Ranked** — reorder suggestions, valuation by category (`SalesByCategoryDonut`)
- **Sources** — `inventory-reports` already serves `reorder-suggestions`,
  `valuation`, `stock-aging`, `shrinkage-summary`. The new endpoint is mostly a
  `Promise.all` fan-in over existing service methods.

### Purchases

- **Attention** — overdue payables, POs awaiting receipt, quotations past validity
- **Health** — purchase value, PO count, average receipt lead time, returns
- **Primary** — purchase trend
- **Ranked** — top suppliers, top products by spend, recent POs
- **Sources** — `purchase-reports` serves `summary`, `trend`, `by-supplier`,
  `by-product`. Lands the standing "top-suppliers panel" item (TODO.md:264).

### Sales

The largest, and the one place to widen scope deliberately: build
`GET /sales/dashboard/overview` so it can **also** back `RetailDashboard`, which
currently fires eight requests to paint the landing page
(`RetailDashboard.tsx:142–152`).

- **Attention** — overdue receivables, pending deliveries, unfulfilled orders, expiring quotes
- **Health** — net sales, orders, average ticket, gross margin
- **Primary** — sales trend
- **Ranked** — top products, top customers, category mix
- **Sources** — `sales-reports` serves twelve endpoints including `summary`,
  `trend`, `by-product`, `by-customer`, `by-category`, `top-movers`.

Folding `RetailDashboard` onto the new endpoint is a **separate follow-up item**,
not a precondition — the Overview ships first, the landing page migrates after.

### HR

Most new backend: `attendance` and `salary-payments` expose only *per-employee*
summaries (`attendance.controller.ts:91`, `salary-payments.controller.ts:37`), so
`hr-dashboard` writes real tenant-wide aggregation.

- **Attention** — absent today, pending leave requests, unpaid salaries this month, probation/contract expiries
- **Health** — headcount, attendance rate, leave days taken, payroll cost
- **Primary** — attendance trend
- **Ranked** — headcount by department, upcoming leaves, recent salary payments

### Admin

Platform-scoped, not tenant-scoped — `PlatformAdminGuard`, no `TenantInterceptor`,
and it must not inherit the tenant shell's assumptions. It already has four stat
tiles and status badges fed by `GET /admin/metrics` (`admin/page.tsx:32,58–73`);
the work is promoting those to the standard bands.

- **Attention** — past-due subscriptions, expiring trials, open support threads, failed scheduled jobs
- **Health** — MRR, active tenants, signups in period, churn — with deltas, which
  the current tiles have none of
- **Ranked** — top tenants by revenue, recent signups

### CRM

Done. Its only Phase-0 change is the refactor onto the shell and the
Attention/Health band swap.

---

## 5. Sequence

| Phase | Work | Notes |
|---|---|---|
| 0 | Shared shell + hook; refactor `CrmDashboard` onto it | No user-visible change |
| 1 | **Accounting** | Component + endpoint exist; pilot for the shell |
| 2 | **Inventory**, then **Purchases** | Report endpoints exist; thin fan-in |
| 3 | **Sales** | Largest; new endpoint sized to also serve `RetailDashboard` later |
| 4 | **HR** | Most new aggregation |
| 5 | **Admin** | Platform-scoped, separate guard |

Rough cost after Phase 0: one backend module + spec, one component + test, i18n
×3 per module — 1–2 days each, Accounting well under, Sales and HR over.

---

## 6. Rules that hold across all seven

- **≤3 requests per page** — current window, previous window, trends. Every query
  tenant-scoped; check the index exists before shipping the `groupBy`.
- **`Promise.allSettled` per panel.** Losing trends costs the sparklines, not the page.
- **Reuse the kit.** `DashboardHeader`/`RangeTabs`, `AttentionStrip`,
  `HealthKpiTile`, `RankedListPanel`, `Sparkline`, `AgingPanel`, `CashFlowChart`,
  `SalesByCategoryDonut`, `PipelineFunnel` all exist. A new component needs a
  genuinely new form to justify itself.
- **One accent.** `blue-600`; emerald/amber/red only as success/warning/danger.
  Do not repeat `AttentionStrip`'s raw border hex in anything new.
- **i18n en/bn/ms** every phase, no exceptions.
- **A real browser pass at 360px and desktop, per module.** Both shipped
  dashboards carry an open TODO saying exactly this was skipped (TODO.md:206,
  `crm-dashboard-design.md` §6). jsdom cannot tell you whether six-digit taka
  figures fit a KPI tile.
- **`/dashboard` stays three variants** (RETAIL / ACCOUNTING / CRM). A module
  Overview is not a landing option — otherwise the dashboard preference setting
  grows to nine radios and every module needs the `crmDashboard`-style feature
  flag this design just avoided.

---

## 7. Open questions

1. **HR gating.** `employees.controller.ts` guards with `JwtAuthGuard` alone —
   every authenticated user in the tenant can read salary figures today. The HR
   dashboard surfaces payroll cost prominently, which makes that pre-existing
   gap much more visible. Either a new `VIEW_HR`/`VIEW_PAYROLL` permission lands
   first, or the payroll KPI is omitted until it does. **Recommend the former,
   tracked as its own item — it is a security fix, not dashboard work.**
2. **Inventory's non-premium subset.** `premiumInventoryReports` gates valuation
   and aging. Out-of-stock and reorder counts do not need it, so the Inventory
   Overview should show a reduced dashboard rather than none. Confirm the split
   when building.
3. **Where `RetailDashboard` ends up.** Once Sales > Overview exists, the retail
   landing dashboard and the sales module dashboard overlap by about half.
   Deliberately unresolved here: different altitude (business vs module) is a
   defensible reason to keep both, but it should be revisited after Phase 3 with
   both on screen.

---

## 8. Deliberately out of scope

- **Projects, Manufacturing, Expenses** have no `overview` node at all
  (`navigation.ts:373–383`) — `projects.list` sits at position 0. Adding one
  costs a registry entry plus a `sync-nav-layout` migration for every customised
  tenant, which is exactly the cost §1.1 rejects. Worth doing, as its own
  decision, not folded into this.
- **Account Settings > Overview** (`account-settings.overview` → `/settings`) is
  a settings hub, not a module with activity to report. It stays a link grid.
- **Per-user dashboard preference** — already deferred twice, unchanged here.
