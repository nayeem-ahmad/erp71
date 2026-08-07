# Referral Partner Portal — separate pages and dashboard charts

**Date:** 2026-08-06
**Status:** Approved, ready for planning

## Problem

The Referral Partner Portal is a single page, [`apps/frontend/src/app/(app)/referrals/page.tsx`](../../../apps/frontend/src/app/(app)/referrals/page.tsx). It stacks share cards, nine summary tiles, a signups table and a payments table into one scroll. The referee sidebar offers one destination, "Dashboard", so a partner who wants their payment history has to scroll past everything else to find it.

Two things follow from that:

1. Signups and payment history deserve their own pages and their own menu entries.
2. The dashboard, relieved of both tables, has room to answer the questions a partner actually opens the portal to ask — is my promotion working lately, where am I losing people, and am I being paid what I earned. Charts answer those; stacked tables do not.

## Scope

- Split the two tables onto their own routes with sidebar entries.
- Enrich both list pages beyond the four columns they carry today.
- Add three charts to the dashboard.
- Extend the ledger endpoint with the aggregates the charts and the payments page need.

Out of scope: the admin-side referral pages under `/admin/referrals`, commission calculation, and payout mechanics. None of those change.

## Routes and navigation

| Route | Page |
| --- | --- |
| `/referrals` | Dashboard — share cards, summary tiles, three charts |
| `/referrals/signups` | Signups list |
| `/referrals/payments` | Payment history list |

`routes.referralsPortal` in [`apps/frontend/src/lib/routes.ts`](../../../apps/frontend/src/lib/routes.ts) changes from the string `'/referrals'` to an object:

```ts
referralsPortal: {
    root: '/referrals',
    signups: '/referrals/signups',
    payments: '/referrals/payments',
},
```

Every existing reference to `routes.referralsPortal` becomes `routes.referralsPortal.root`. There are eight, in three files: [`layout.tsx`](../../../apps/frontend/src/app/(app)/layout.tsx) lines 101, 102, 216, 276 and 330; [`Sidebar.tsx`](../../../apps/frontend/src/components/Sidebar.tsx) line 217; [`auth-session.ts`](../../../apps/frontend/src/lib/auth-session.ts) lines 168 and 191. `select-account/page.tsx` uses the literal string `'/referrals'` twice and is unaffected.

Four of those call sites are `startsWith` or equality tests that gate access. Against `routes.referralsPortal.root` they keep working and cover both new sub-routes, so no new gating logic is needed — but each argument must become `.root`, or it silently compares a path against an object and the guard stops firing.

The sidebar's `refereeMode` branch ([`Sidebar.tsx:211`](../../../apps/frontend/src/components/Sidebar.tsx#L211)) gains two children beside Dashboard:

```text
Referrals
  ├── Dashboard        LayoutDashboard   exact
  ├── Signups          Users
  └── Payment history  Wallet
```

Dashboard keeps `exact: true` so it does not stay highlighted on the child routes.

## Backend

Both additions land in `ReferralsService.getLedger` ([`referrals.service.ts:533`](../../../apps/backend/src/referrals/referrals.service.ts#L533)). The portal keeps its single endpoint, `GET /referrals/me/ledger`, and all three pages share one fetch. Twelve rows of five numbers is a negligible payload, so the list pages carrying the chart aggregate costs nothing and saves a second endpoint and a second round trip.

### `activity` — twelve monthly buckets

A new top-level key on the ledger response:

```ts
activity: Array<{
    month: string;          // 'YYYY-MM'
    clicks: number;
    signups: number;
    earned_amount: number;  // BDT, commission earned that month
    paid_amount: number;    // BDT, payouts received that month
}>
```

Twelve buckets ending with the current month, oldest first. Months with no activity are present with zeros — the chart must not close a gap that really exists.

Bucketing rules, one per series:

| Series | Source | Date field |
| --- | --- | --- |
| `clicks` | `ReferralClick` | `occurred_at` |
| `signups` | `ReferralSignup` | `signed_up_at` |
| `earned_amount` | `ReferralSignup` where `earned_at` is not null | `earned_at` |
| `paid_amount` | `RefereePayment` | `paid_at` |

`earned_amount` sums `commission_amount` over rows with `status` in `EARNED` or `PAID`, matching the `total_earned_amount` rule already in `getLedger` — a `REVERSED` commission is not earned. Reversals are deliberately absent from the chart; the summary tiles and the signups list carry them.

Signups and payments are bucketed in the service from rows `getLedger` already loads — no new query. Clicks need one: the existing `referralClick.count` stays, because `summary.clicks` is an all-time total and the buckets only cover twelve months, and a second query fetches just the `occurred_at` of clicks inside the window.

That second query is a `findMany` selecting one column, not a `groupBy`. Prisma's `groupBy` can only group by a stored column, and grouping on a raw `DateTime` yields one group per distinct timestamp — useless for months. The alternative, `$queryRaw` with `date_trunc`, buys efficiency this workload does not need and costs testability against the mocked `db` object the existing specs use. Bucketing all four series in JS from fetched rows also means one shared helper covers them all. `ReferralClick` already has `@@index([referee_id, occurred_at])`, so both queries are indexed and the window is bounded.

Month boundaries use the server's local timezone, consistent with the rest of the platform's date handling.

### `payments[].commissions`

Each payment in the ledger response gains the commissions it settled — the same join `listPayments` already performs at [`referrals.service.ts:513`](../../../apps/backend/src/referrals/referrals.service.ts#L513):

```ts
include: { commissions: { include: { tenant: { select: { id: true, name: true } } } } }
```

mapped through the existing `mapSignup`. This is what lets a payout row expand to show what it covered.

## Dashboard

The dashboard keeps the share cards and the summary tiles exactly as they are, drops both tables, and gains three charts below the tiles.

Charts are hand-rolled SVG — this repo has no charting library — in `apps/frontend/src/components/referrals/`, following the established pattern in [`CashFlowChart.tsx`](../../../apps/frontend/src/components/dashboard/CashFlowChart.tsx): the `monotoneCubicPath` helper from `@/lib/charts/smooth-path`, a local `niceStep` for axis ticks, a fixed viewBox scaled by CSS.

### Palette

Two hues, both already in the repo's chart vocabulary:

- **Blue `#2563eb`** — clicks, and the funnel
- **Emerald `#047857`** — signups, earnings

Validated with the dataviz palette validator against both the light and dark chart surfaces: lightness band, chroma floor, CVD separation, normal-vision floor and contrast all pass. Deutan separation is ΔE 23.6 and normal-vision ΔE 25.4, but **tritan separation is ΔE 7.5**, inside the 6–8 floor band. That makes secondary encoding mandatory, not optional: every multi-series chart here carries a legend, direct labels, and a 2px surface gap between adjacent fills. Do not ship a version that relies on hue alone.

### Chart A — Activity over time

Full width. Twelve monthly buckets.

Clicks and signups are both counts, but a partner with two hundred clicks and three signups would see the signup series flattened to nothing on a shared scale — and a second y-axis is not an option. So this is **two panels stacked vertically sharing a single x-axis**, one figure with two plots:

- Top panel: clicks, blue area with a monotone-cubic line
- Bottom panel: signups, emerald columns

Each panel scales independently on its own y-axis; the shared month axis is drawn once, under the bottom panel. A legend labels the two panels.

### Chart B — Earnings and payouts

Half width. Grouped columns per month: commission earned (emerald) and payouts received (blue). Both are BDT on one axis. Legend plus direct labels on the tallest pair. Money is formatted with `formatBDT()`; axis ticks use the compact lakh notation already implemented in `CashFlowChart`.

### Chart C — Referral funnel

Half width. Four horizontal bars, descending: clicks → signups → earned → paid. Single blue hue, magnitude by length. Each bar is direct-labelled with its absolute count, and the drop-off percentage is printed between consecutive stages.

Counts come from the summary the ledger already returns: `clicks`, `total_referrals`, `earned + paid`, `paid`. Stages are cumulative, so the "earned" bar counts commissions that reached earned *or* went on to be paid; without that the funnel would appear to shrink and then grow.

When `clicks` is zero the drop-off percentages are undefined — render an em dash, never `NaN%` or a division by zero.

### Interaction and responsiveness

Charts A and B get hover tooltips — a crosshair with a shared month tooltip on A, a per-month tooltip on B — with hit targets wider than the marks. Chart C does not: every bar already carries its count and its drop-off as visible text, so a tooltip would only repeat what is on screen.

Each chart renders an empty state rather than empty axes when it has no data — a partner who has just joined sees a sentence explaining what will appear here, not three blank frames.

Below the `md` breakpoint, Chart A narrows to the last six months — twelve month labels collide at that width, and squeezing or rotating them is not an honest fix. Charts B and C stack full width. No horizontal body scroll at any width.

## Signups page

`/referrals/signups`. `PageShell` + `PageHeader`, breadcrumbs Home → Referrals → Signups. Fetches the same ledger and renders `ledger.commissions` through `DataTable`.

Columns: Business · Status · Plan amount · Commission % · Commission · Signed up · Earned on.

Every field is already in the payload: `mapSignup` returns `plan_amount`, `commission_pct` and `earned_at`, and the frontend `ReferralCommission` type already declares all three. No backend or type change is needed for this page.

Filter presets: All · Pending · Earned · Paid · Reversed.

`hideOnMobile` on Plan amount, Commission % and Earned on. The commission note now on the dashboard ("you earn once, at first paid subscription") moves here, above the table, where the question actually arises.

Search, sorting, pagination, column preferences and CSV/Excel/PDF export come from `DataTable` with no extra work.

## Payment history page

`/referrals/payments`. Same shell, breadcrumbs Home → Referrals → Payment history. Renders `ledger.payments`.

Columns: Date · Amount · Method · Reference · Notes. `mapPayment` already returns `notes` and the `RefereePayment` type already declares it, so only the expand panel needs new data.

A trailing action column opens a details modal listing the commissions that payout settled — business name, commission amount, date signed up — from the new `payments[].commissions`. A payment with no linked commissions (possible for rows written before the link existed) shows a short explanatory line rather than an empty panel.

The modal is deliberate: `DataTable` has no row-expansion support, and adding it to a component shared by every list screen in the product is far more change than this page justifies. `ModalShell` is the established pattern for detail panels here, including on the admin side of this same module.

`hideOnMobile` on Reference and Notes.

## Internationalisation

New keys under `referralPortal` in `en`, `bn` and `ms` ([`apps/frontend/src/lib/localization/messages/`](../../../apps/frontend/src/lib/localization/messages/)):

- `nav.signups`, `nav.payments` — sidebar labels
- `signupsPage.*` and `paymentsPage.*` — titles, subtitles, breadcrumbs, empty states, the new column headers, the filter preset labels
- `charts.activity.*`, `charts.earnings.*`, `charts.funnel.*` — titles, series labels, axis labels, empty states, the drop-off phrasing

Existing keys stay where they are. `commissions.*` and `payments.*` move meaning slightly — they now name pages rather than sections — but the strings themselves are reusable.

## Testing

**Backend** — unit tests on the monthly aggregator in `referrals.service.spec.ts`: twelve buckets always returned; empty months present with zeros; a reversed commission excluded from `earned_amount`; a commission that is `PAID` counted in `earned_amount` at its `earned_at`, not its `paid_at`; a referee with no activity yielding twelve zeroed buckets. Plus a test that ledger payments carry their linked commissions.

**Frontend** — the existing [`page.test.tsx`](../../../apps/frontend/src/app/(app)/referrals/page.test.tsx) splits into three, one per page. Dashboard: charts render, tables absent. Signups: columns present, filter presets filter. Payments: a row expands to its commissions.

Chart components get their own tests for the pure geometry — bucket-to-coordinate mapping, `niceStep`, and the funnel drop-off percentages including the zero-clicks case.

`Sidebar.test.tsx` gains a case asserting the two new referee nav items appear in `refereeMode` and stay absent outside it.

## Risks

**`routes.referralsPortal` changing shape** is the one change that can break something silently — a missed call site compares a string against an object and the redirect guard stops firing, exposing the portal shell to a non-referee. Grep every reference and let TypeScript confirm; do not rely on the three call sites named above being the complete set.

**The click aggregate** adds one grouped query per ledger load. It is indexed and bounded to twelve months, so the cost is small, but the ledger is the portal's only endpoint and every page hit pays it.
