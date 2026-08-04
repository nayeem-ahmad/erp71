# CRM Dashboard — design

Status: **built** (designed and implemented 2026-08-04). This document is the
design as executed; where the build diverged from the plan, the text below says
so rather than pretending the plan was right.

A CRM-focused tenant — an agency, a distributor's inside-sales desk, a service
business — logs in and lands on `RetailDashboard`, which opens with today's sales,
stock alerts and top products. None of that is their work. Their work is a
pipeline: who came in, who is going cold, who is due a call today, what closed.

This is the design for a third dashboard that answers those questions, and for
where it lives.

---

## 1. Where it lives — the CRM > Overview question

**Yes, and no new menu entry is needed.**

`crm.overview` already exists and already points at `/crm`:

```ts
// packages/shared-types/navigation.ts:177
'crm.overview': { id: 'crm.overview', kind: 'link', icon: 'LayoutDashboard',
                  labelKey: 'sidebar.items.overview', href: '/crm', exact: true },
```

and sits at position 0 of the CRM module (`navigation.ts:360`). The page it opens,
`apps/frontend/src/app/(app)/crm/page.tsx`, is a `ModuleHub` — a grid of links to
the CRM pages, with three KPI tiles and a recent-campaigns card already passed
through the hub's `children` slot (`crm/page.tsx:138–200`).

So the dashboard is an **upgrade of `/crm` in place**, not a new route:

| Tenant | `/crm` renders |
|---|---|
| `premiumCrm` on | `<CrmDashboard />`, with the hub link grid kept below it |
| `premiumCrm` off | today's hub exactly as-is (Customers link only) |

The KPI tiles and campaign card currently inlined in `crm/page.tsx` move into
`CrmDashboard` — they are the seed of it, not a duplicate of it.

**Rejected: a separate `/crm/dashboard` route.** It costs a new node in the
navigation registry *and* a layout row for every tenant that has customised its
nav (`scripts/sync-nav-layout.ts` — the same migration `crm.setup` needed), and it
leaves "Overview" pointing at a link grid that only repeats the sidebar. Two
entries for one idea.

### The second link: the home dashboard

Landing page is the other half of "CRM-focused". `/dashboard` already switches on
a resolved variant (`apps/frontend/src/app/(app)/dashboard/page.tsx:94`), so the
CRM dashboard should be reachable there too, by the same three-layer rule that
already governs accounting:

```ts
// packages/shared-types/subscription-plans.ts
export const DASHBOARD_PREFERENCES = ['AUTO', 'RETAIL', 'ACCOUNTING', 'CRM'] as const;
export type DashboardVariant = 'RETAIL' | 'ACCOUNTING' | 'CRM';
```

`CrmDashboard` is then rendered from *two* places (`/crm` always, `/dashboard`
when the variant resolves to CRM) and must therefore stay a plain component
taking `DashboardIdentity` — same contract as `AccountingDashboard` and
`RetailDashboard`.

---

## 2. Who is a "CRM-focused tenant"

Mirror the accounting entitlement shape exactly rather than inventing a second one.

- **New plan feature `crmDashboard`** (boolean, default `false`, group `modules`),
  described as "Lands on the pipeline dashboard instead of the retail one." It
  carries the same warning `accountingDashboard` does at
  `subscription-plans.ts:164–175`: never grant it from an add-on, because
  `mergeAddonFeatures` ORs booleans in and would silently replace a retail
  tenant's dashboard.
- **`premiumCrm` is the floor.** It is already `true` on STANDARD and PREMIUM and
  `false` on FREE/BASIC/ACCOUNTING (`seed-platform.ts`), and it already guards
  every CRM controller (`@RequiresFeature('premiumCrm')`).
- **`VIEW_LEADS` is the user-level floor.** Every panel below reads leads; a user
  without it would see a wall of 403s, which is exactly the failure
  `resolveDashboardVariant` guards against for `VIEW_LEDGER`.

Resolution order in `resolveDashboardVariant` (the existing function, one branch
added):

1. `accountingOnly` → `ACCOUNTING`. Unchanged, still wins — that workspace has no
   CRM routes at all (`accounting-only-paths.ts:7` blocks `/crm`).
2. plan default: `accountingDashboard` → ACCOUNTING, else `crmDashboard` → CRM,
   else RETAIL.
3. tenant's `dashboard_preference`, when not `AUTO`, overrides the plan default.
4. fall back to `RETAIL` if the chosen variant is not loadable: CRM needs
   `premiumCrm` **and** `VIEW_LEADS`.

Settings surface: `settings/dashboard/page.tsx` gains a fourth radio, disabled
with the existing "not available on your plan" hint when `premiumCrm` is off.
`OPTIONS`, the label ternaries at lines 112–117 and `copy.variantX` all become
lookups keyed by preference — four options is where the ternary chain stops being
readable.

---

## 3. Backend — one aggregate endpoint, one trend endpoint

New module `apps/backend/src/crm-dashboard/`, guarded like every other CRM
controller (`JwtAuthGuard, SubscriptionAccessGuard` + `@RequiresFeature('premiumCrm')`
+ `TenantInterceptor`).

A new module rather than another method on `CrmLeadsService`, because the payload
spans four services (leads, follow-ups, conversations, campaigns) and the page
must not fire six requests to paint one screen. This is the same shape as
`GET /accounting/dashboard/overview` (`accounting.controller.ts:306`).

### `GET /crm/dashboard/overview?from=YYYY-MM-DD&to=YYYY-MM-DD`

```jsonc
{
  "filters": { "from": "2026-07-05", "to": "2026-08-04" },

  // Lead.status counts. `counts` is the whole book (open pipeline is a stock,
  // not a flow, so it ignores the window); the *_in_period figures are flows.
  "pipeline": {
    "counts": { "NEW": 0, "CONTACTED": 0, "QUALIFIED": 0, "CONVERTED": 0, "LOST": 0 },
    "open": 0,                    // NEW + CONTACTED + QUALIFIED — as getStatusSummary today
    "created_in_period": 0,
    "converted_in_period": 0,
    "lost_in_period": 0,
    "conversion_rate_pct": null,  // converted / (converted + lost) in period; null when both 0
    "avg_days_to_convert": null,  // closed_at - created_at, averaged; null when nothing closed
    "unassigned": 0,              // assigned_to IS NULL and status in (NEW, CONTACTED, QUALIFIED)
    "stale": 0                    // open, and last_contacted_at older than 14 days (or null)
  },

  // CrmFollowUp. due_today/overdue/total already exist in getSummary; the rest are new.
  "follow_ups": {
    "due_today": 0, "overdue": 0, "total_pending": 0, "completed_in_period": 0
  },

  // LeadConversation. by_type keyed by the denormalised `type` (channel code).
  "activity": {
    "logged_in_period": 0,
    "leads_touched": 0,
    "by_type": [{ "code": "CALL", "name": "Call", "count": 0 }]
  },

  // LeadSourceOption ⋈ Lead. Ordered by leads desc, top 6 + "other" folded in.
  "sources": [
    { "id": "…", "name": "Referral", "leads": 0, "converted": 0, "conversion_rate_pct": null }
  ],

  // Per assignee. Ordered by open_leads desc, top 6.
  "owners": [
    { "user_id": "…", "name": "Rahim", "open_leads": 0, "converted_in_period": 0, "overdue_follow_ups": 0 }
  ],

  // CrmCampaign, window on sent_at. attributed_* already tracked by attributeSale().
  "campaigns": {
    "sent_in_period": 0, "delivered": 0, "failed": 0,
    "attributed_revenue": 0, "attributed_orders": 0,
    "recent": [{ "id": "…", "name": "…", "status": "COMPLETED", "channel": "SMS",
                 "recipient_count": 0, "delivered_count": 0, "failed_count": 0 }]
  }
}
```

**Built with one schema change.** The plan had `avg_days_to_convert` shipping
dark for want of a conversion timestamp; in the build it became clear the same
gap sank `converted_in_period` and `lost_in_period` too, since `updated_at` moves
on any later edit and would re-date a June win to August. So `Lead.closed_at`
was added (migration `20260804140000_add_lead_closed_at`, backfilled from
`updated_at` for historical rows) and is stamped by every path that reaches a
terminal status — create, update, and convert. Only a *transition* stamps it:
re-saving an already-lost lead must not move it, and reopening clears it. The
import's upsert path deliberately does not touch it (a bulk sync is not a deal
closing, and it re-runs over unchanged rows).

Every other field maps to a column that already existed (`Lead`, `CrmFollowUp`,
`LeadConversation`, `CrmCampaign`, `LeadSourceOption`). Each block is a `groupBy`/`count` behind
`Promise.all`, all filtered on `tenant_id`; the indexes needed
(`[tenant_id, status]`, `[tenant_id, assigned_to]`, `[tenant_id, source_id]`,
`[tenant_id, status, due_at]`, `[tenant_id, created_at]`) are all already declared.

### `GET /crm/dashboard/trends?from&to`

```jsonc
{ "points": [{ "date": "2026-08-01", "leads_created": 0, "conversations": 0,
               "leads_converted": 0, "follow_ups_completed": 0 }] }
```

Daily buckets, feeding the KPI sparklines. Separate from the overview for the same
reason `getFinancialTrends` is: the dashboard requests the *previous* window's
overview too (for period deltas) and does not want its trend points twice.

`GET /crm/leads/summary`, `/crm/follow-ups/summary` and
`/crm/lead-conversations/summary` all stay — the leads and conversations pages use
them for their own stat tiles.

---

## 4. Frontend layout

`apps/frontend/src/components/dashboard/CrmDashboard.tsx`, following
`RetailDashboard`'s skeleton (`PageShell maxWidth="full"` → `space-y-4` →
`DashboardHeader` → labelled `<section>`s) so the three dashboards stay siblings
rather than three different pages.

```
DashboardHeader          greeting · tenant · range today|week|month   [reused]
─────────────────────────────────────────────────────────────────────────────
NEEDS ATTENTION          AttentionStrip                               [reused]
  overdue follow-ups (red)   → /crm/follow-ups
  due today (amber)          → /crm/follow-ups
  stale >14d (amber)         → /crm/leads?status=open&sort=last_contacted
  unassigned (blue)          → /crm/leads?assignedTo=none
  failed campaign sends (red, only when > 0) → /crm/campaigns
─────────────────────────────────────────────────────────────────────────────
PIPELINE HEALTH          4 × HealthKpiTile with sparkline + Δ vs prev [reused]
  New leads · Conversion rate · Conversations logged · Campaign revenue
─────────────────────────────────────────────────────────────────────────────
PIPELINE                 lg:grid-cols-[3fr_2fr]
  PipelineFunnel  (new)         │  RankedListPanel — Lead sources     [reused]
  5 ordinal blue stage bars     │  name · leads · conv %
─────────────────────────────────────────────────────────────────────────────
TEAM & ENGAGEMENT        lg:grid-cols-3
  RankedListPanel — Owners  │  Activity by channel  │  Recent campaigns
  [reused]                  │  (RankedListPanel)    │  (moved from crm/page.tsx)
```

The only new component is `PipelineFunnel`. Everything else is `DashboardHeader`,
`AttentionStrip`, `HealthKpiTile`, `RankedListPanel`, `Sparkline` — all already in
`components/dashboard/`.

`/crm/page.tsx` becomes: gate on `premiumCrm` → render `<CrmDashboard/>` above the
`ModuleHub`, otherwise render the hub alone. Its three `FinancialKpiTile`s go away
with the move, leaving `manufacturing/page.tsx` as the only remaining call site
blocking the "collapse the KPI tiles, drop the pastel hex" item in TODO.md.

**Two mount points, one component.** On `/crm` the module hub already supplies a
`PageShell` and a `PageHeader`, so `CrmDashboard` takes `variant="embedded"` there
and drops both its own shell and the greeting block — otherwise the page would
carry two headers and two max-widths. The range switcher survives the move, since
it is the one control the hub header does not provide; it was factored out of
`DashboardHeader` as `RangeTabs` for exactly that.

### PipelineFunnel

Funnel stages are **ordinal**, not categorical: NEW → CONTACTED → QUALIFIED →
CONVERTED, with LOST shown apart. So it is one hue in monotone lightness steps —
`blue-600 → blue-500 → blue-400 → blue-300`, which is also exactly what CLAUDE.md's
one-accent rule requires. LOST is `gray-300` (an outcome, not a stage); it never
gets `red` — losing a deal is not an error state.

Horizontal bars, not a tapered funnel polygon: a taper encodes the count in an
area nobody can compare, and the stages here are *not* nested subsets (a lead can
go NEW → LOST without ever being CONTACTED), so a shrinking silhouette would
assert a containment that is not true. Each bar is width-proportional to its
count, labelled `stage · count · % of created`, 2px surface gap between bars, 4px
rounded data-end, and the whole row is a link into `/crm/leads?status=…`. Plain
divs — no chart library, matching `AgingPanel`.

Deltas, empty states and the loading skeleton copy `RetailDashboard`
(`periodDelta`, the `animate-pulse` tile grid). Each panel degrades on its own via
`Promise.allSettled` — losing the trend request costs the sparklines, not the page.

The window helpers are new siblings rather than the existing ones:
`rangeToDateWindow`/`previousDateWindow` return `YYYY-MM-DD` bounds, because these
endpoints read a date as a whole *local* day. Handing them `rangeToWindow`'s ISO
instants would send a Dhaka midnight as the previous day in UTC, and "today" would
quietly cover two days. The server side guards the same boundary from the other
end: it parses date-only bounds as local midnight and formats buckets from local
calendar parts, never `toISOString()`.

---

## 5. i18n

New keys under `t.dashboardHome.crm` (beside `t.dashboardHome.accounting`), in
`lib/localization/messages/{en,bn,ms}/` — `crmHr.ts` holds the CRM strings today,
`core.ts` holds `dashboardHome`. Three locales, no exceptions; the dashboard
preference labels and the new sidebar-independent section headings all need them.

---

## 6. What shipped

1. **shared-types** — `crmDashboard` feature descriptor, `'CRM'` in
   `DASHBOARD_PREFERENCES`/`DashboardVariant`, the `resolveDashboardVariant`
   branch, cases in `plan-entitlements.test.ts` (note: `subscription-plans.test.ts`
   in the package is executed by nothing — see the standing TODO item).
2. **database** — `Lead.closed_at` + two indexes, migration
   `20260804140000_add_lead_closed_at`, and the three write paths that stamp it.
3. **backend** — `crm-dashboard` module, both endpoints, 12-case service spec.
4. **frontend data** — `api.getCrmDashboardOverview` / `getCrmDashboardTrends`,
   plus `rangeToDateWindow` / `previousDateWindow`.
5. **frontend UI** — `PipelineFunnel`, `CrmDashboard`, `RangeTabs` split out of
   `DashboardHeader`, `/crm/page.tsx` rewired.
6. **wiring** — `/dashboard` variant switch, the fourth radio in dashboard
   settings (its label/help/entitlement ternaries replaced by keyed lookups),
   i18n in all three locales.

**Still to do: look at it in a running browser at 360px and desktop.** Verified so
far by unit test, typecheck and lint only — the standing lesson from the accounting
dashboard is that jsdom cannot tell you whether the funnel's three-column row
(label · bar · count) collides at 360px or whether the KPI tiles fit.

## 7. Deliberately out of scope

- **Customer-side retention** (top customers, retention rate, loyalty liability —
  Epic 84 Stories 1–2, already tracked in TODO.md). Those join sales data and are
  a second endpoint; this dashboard is the lead/activity half.
- **Per-user dashboard override.** Same deferral as accounting: an inside-sales rep
  and an owner in one tenant plausibly want different landing pages, but that is a
  second preference layer and a second settings surface.
- **A "my pipeline" filter.** The owner leaderboard shows everyone; scoping the
  whole dashboard to the signed-in user is a toggle worth adding only once someone
  asks.
