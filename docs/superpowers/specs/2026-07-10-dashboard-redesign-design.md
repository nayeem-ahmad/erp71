# ERP71 Dashboard Redesign — "Business Monitor" v2

**Date:** 2026-07-10
**Status:** Approved (design) — ready for implementation planning
**Scope:** Redesign the existing owner dashboard at `apps/frontend/src/app/(app)/dashboard/page.tsx` into a gorgeous, glanceable, action-oriented home screen for small/medium Bangladeshi retailers.

---

## 1. Goals & Non-Goals

### Goals
- A visually premium dashboard that answers, in one glance: **"How's my business?"** (health) and **"What needs me?"** (actions).
- Feels equally polished on **phone and desktop** (owners are mobile-heavy but also use back-office PCs).
- Reuses existing data endpoints wherever possible; adds the minimum backend surface.
- Preserves existing behaviors: **accounting-only plan mode**, **i18n (en/bn/ms)**, multi-tenant scoping, per-widget loading/error states.
- Breaks the current 500-line `page.tsx` into focused, independently testable widget components.

### Non-Goals
- No drag-and-drop / user-customizable widget arrangement (deferred — YAGNI for v2).
- No new charting library dependency — charts stay hand-rolled (CSS/SVG) consistent with the existing `CashFlowChart`.
- No role-specific dashboards (cashier vs. owner) beyond the existing plan-mode gating.
- No changes to the underlying accounting/financial KPI calculations.

---

## 2. Visual System — "Clean & Airy"

| Token | Value |
|-------|-------|
| Canvas | `#f6f8fb` (light) |
| Card surface | `#ffffff`, 1px `#eef2f7` border, `0 1px 2px rgba(0,0,0,.04)` shadow |
| Primary accent | Indigo `#6366f1` |
| Positive / negative | `#16a34a` / `#dc2626` |
| Alert hues | red `#ef4444`, amber `#f59e0b`, blue `#3b82f6`, violet `#8b5cf6` |
| Radii | 12px (cards), 16px (page sections) |
| Section labels | 9px, 800 weight, uppercase, `#94a3b8` |

Reuses the existing `compactDensity` tokens (`@/lib/ui/compact-density`) and `PageShell` / `PageHeader` compact components so the redesign stays consistent with the rest of the app — just with more breathing room and a cleaner hierarchy. Light theme only for v2.

---

## 3. Layout

Top-to-bottom. Desktop uses the column counts below; **mobile collapses every grid to a single column**.

1. **Greeting header** — "Good {timeofday}, {firstName} 👋" + tenant name + a **Today / This week / Month** range toggle. The toggle holds the active range and drives every widget below.
2. **Quick actions** — New sale · Add product · Record expense · New purchase · Reports. Reuses `FrequentQuickLinks`.
3. **Business health** — 4-column KPI grid, each a value + delta-vs-previous-period + sparkline:
   - **Sales** (period gross)
   - **Net profit**
   - **Cash in hand**
   - **Receivables due** (with overdue count)
4. **Needs your attention** — 4-column strip of color-coded cards, urgency-sorted, each deep-linking to the fix:
   - Overdue receivables (red) → collect
   - Low stock (amber) → reorder
   - Orders awaiting delivery (blue) → view
   - Plan renewal countdown (violet) → renew
5. **Money in & where it comes from** — 2-up (3fr / 2fr):
   - **Sales vs expenses** trend chart (restyled existing `CashFlowChart`)
   - **Sales by category** donut — ৳ total in center, legend with % share
6. **Who & what is driving it** — 3-up:
   - **Top selling products** (rank · name · qty · revenue)
   - **Top customers** (rank · avatar-initials · name · orders · spend)
   - **Recent activity** live feed

### Plan-mode behavior
When `isAccountingOnlyPlan(planCode, features)` is true, hide retail-only panels (attention low-stock/delivery cards, sales-by-category, top products, top customers, inventory-derived KPIs) — same gating pattern as the current dashboard's `accountingOnlyMode`. The financial KPIs and Sales-vs-expenses chart remain.

---

## 4. Data Flow

### Reused endpoints (already in `@/lib/api`)
- `api.getMe()` — user + tenant + plan context (drives greeting, plan mode).
- `api.getFinancialKpis()` — financial snapshot (net cash, revenue, expense, receivables, payables, net profit).
- `api.getFinancialTrends()` — trend points for the Sales-vs-expenses chart.
- `api.getProducts()` — inventory / low-stock derivation.
- `api.getSales()` — recent activity, active orders.
- **Sales reports** (`apps/backend/src/sales-reports`): `by-customer` → **Top customers**; `by-product` → **Top selling products**; `summary` → period sales/deltas.

### New backend surface
- **`GET /sales-reports/by-category`** — new aggregation in `sales-reports.service.ts`: join sale items → products → `ProductGroup` / `ProductSubgroup` (via `subgroup_id`), sum net revenue per category, return `[{ categoryId, categoryName, revenue, share }]` sorted desc with an "Other" rollup beyond the top N (e.g. top 5 + Other). Scoped to `tenantId` (TenantInterceptor), honors `from`/`to` range filter like sibling report endpoints. Add a matching `api.getSalesByCategory(range)` client method.

### Attention strip data
Assembled **client-side** in v2 from existing signals (low-stock count from `getProducts`, overdue/receivables from financial KPIs + sales, pending deliveries from sales/orders, renewal days from tenant subscription in `getMe`). Only extract a dedicated `GET /dashboard/attention` aggregator endpoint later if client-side assembly proves slow.

### Range toggle
The Today/Week/Month selection is passed as `from`/`to` params to every range-aware fetch. Default range on load: **This week**.

---

## 5. Component Structure (frontend)

Decompose `page.tsx` from one 500-line file into focused units under `apps/frontend/src/components/dashboard/`:

| Component | Responsibility | Depends on |
|-----------|----------------|------------|
| `DashboardHeader` | Greeting + range toggle; owns range state, emits changes | i18n |
| `HealthKpiGrid` | 4 KPI tiles w/ sparkline | existing `KpiTile` (extend with sparkline) |
| `AttentionStrip` | Urgency-sorted alert cards | client-assembled attention data |
| `SalesExpenseChart` | Restyled trend chart | existing `CashFlowChart` logic |
| `SalesByCategoryDonut` | Donut + legend | new `by-category` endpoint |
| `TopProductsPanel` | Ranked product list | `by-product` report |
| `TopCustomersPanel` | Ranked customer list | `by-customer` report |
| `RecentActivityPanel` | Live activity feed | `getSales` |

`page.tsx` becomes a thin composition + data-fetch orchestrator (keeps `Promise.allSettled` fan-out pattern), passing the active range down and plan-mode flags to gate retail panels.

Each widget answers: **what it shows**, **what props it takes**, **what endpoint it depends on** — understandable and testable in isolation.

---

## 6. Loading / Error / Empty States

- **Loading:** per-widget skeleton (existing animate-pulse pattern), so widgets fill in independently rather than blocking on the slowest fetch.
- **Error:** inline amber notice inside the affected widget (existing pattern); one widget failing never blanks the page.
- **Empty:** friendly, intentional empty states so a brand-new shop still looks designed — e.g. "No sales yet this week", "No categories to show yet", "You're all caught up 🎉" for an empty attention strip.

---

## 7. Internationalization

All new copy goes through `t.dashboardHome` (extend the existing key set) with **en / bn / ms** translations added to `@/lib/localization/messages`. Currency via existing `formatBDT` / `formatCurrency`; dates via `formatDate`; interpolation via `formatMessage`. Greeting time-of-day and rank labels are localized.

---

## 8. Testing

- **Component tests** (RTL) per widget, following `page.test.tsx` — render with mock data, assert values/labels, loading and empty states.
- **Service spec** for the new `by-category` aggregation: category rollup math, "Other" bucket, tenant scoping, range filter, empty result.
- **E2E:** add the new endpoint + dashboard render to the `@readonly` nightly Playwright smoke suite.
- **Plan-mode:** test that accounting-only tenants hide retail panels and still render financial widgets.

---

## 9. Rollout / Risks

- **Backend first:** ship `GET /sales-reports/by-category` + client method behind the existing report auth/permissions, verify against real tenant data.
- **Frontend incremental:** extract components one at a time from `page.tsx`, keeping the page renderable at each step; swap visuals in as widgets land.
- **Risk — category cardinality:** shops with many product groups → cap slices at top 5 + "Other" to keep the donut readable.
- **Risk — performance:** attention strip assembled from multiple client calls; if slow, memoize/parallelize and reconsider a server aggregator.
- **Risk — sparse data:** new shops have little to show; empty states (section 6) cover this.

---

## 10. Open Questions

None blocking. Deferred ideas captured for later: user-customizable widgets, top suppliers / staff-performance panels, a profit trend line, and a dedicated attention-aggregator endpoint.
