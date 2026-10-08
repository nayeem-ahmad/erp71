# App shell: a rail of apps instead of one 200-link menu

**Date:** 2026-10-08
**Status:** approved (Section 1 reviewed; Sections 2–5 approved under "go ahead yolo")
**Follow-up spec:** new modules (project-management additions and others), after this ships

## The problem

After login, every tenant gets one sidebar tree: 17 top-level entries and
about 200 links, in the same shape for an owner and a cashier. It has search,
collapse and resize, but nothing about it says "these are the parts of your
business": a shop that never uses Manufacturing still scrolls past it, and the
modules a shop could buy are invisible unless someone opens Billing.

The owner asked for it to **feel like apps** — an Odoo / Zoho-style model in
which each business sees the modules it uses, and add-ons are visible and
sellable.

## Decisions taken

| Question | Answer |
|---|---|
| What is wrong today | "Should feel like apps" |
| Who decides which apps a business sees | **Owner hides, plan grants** — the plan and add-ons decide what is available; the owner can hide available apps from everyone; no install step |
| Shell layout | **Rail + app menu** — a thin rail with one icon per app, always visible, and the current app's own menu beside it |
| Login landing / Home | **Grid + dashboard** — Home is a row of app tiles with one live count each, then today's dashboard unchanged; locked add-ons for owners/billing managers; a single-app user skips Home |

## 1. What an app is

**An app is a top-level `module` node of the existing nav layout.** Its
subgroups and links are that app's menu. `DEFAULT_TENANT_NAV_LAYOUT`, the
platform-admin nav editor, saved tenant layouts and `sync-nav-layout` all keep
working unchanged — no layout migration, nothing reorganised inside a module.

**Business apps** (rail, hideable by the owner): Sales, Online Store, Purchase,
Imports, Accounting, Expenses, Inventory, CRM, Projects, Manufacturing, HR.

**Utility apps** (bottom of the rail, never hideable): Chat; **Help**, one rail
entry whose panel holds the Help, Support and What's New modules (each still its
own layout node, so the nav editor is unaffected); Settings
(`account-settings`).

`dashboard` is not an app: it becomes the rail's Home entry.

### `APP_REGISTRY` and `resolveAppStates`

A new `packages/shared-types/apps.ts`:

```ts
export interface AppDefinition {
  id: string;                 // = the module node id in NAV_REGISTRY
  kind: 'business' | 'utility';
  /** Plan entitlement that grants it; absent = every plan. */
  entitlement?: PlanEntitlementKey;
  /** Also needs a paid plan (accounting's existing rule). */
  requiresPaidPlan?: boolean;
  /** Platform switch that must be on. */
  platformFeature?: PlatformFeatureKey;
  /** Shown in an accounting-only plan. */
  inAccountingOnly?: boolean;
  /** Another app this one is sold with — not offered as its own locked tile. */
  soldWith?: string;
  /**
   * Module-level permission gate, for the apps whose gate lives in the shell
   * today rather than in NAV_PERMISSIONS (accounting/expenses: VIEW_LEDGER,
   * projects: VIEW_PROJECTS). Owners bypass it.
   */
  permissionsAny?: readonly string[];
  /** Rail entries that share one icon (help, support, whats-new → 'help'). */
  railGroup?: string;
}

export type AppState = 'available' | 'hidden' | 'locked' | 'unavailable';
```

`resolveAppStates(input)` returns a state per app from plan features, plan
code, platform features, `hidden_apps`, `accountingOnly` and the viewer
(`isOwner`, `permissions`):

| State | Meaning | Shown to |
|---|---|---|
| `available` | granted by plan/add-ons and platform switch | everyone (subject to permissions, below) |
| `hidden` | available, but the owner switched it off | only the Apps settings page |
| `locked` | platform switch on, plan entitlement missing | owners and billing managers, as an upsell |
| `unavailable` | platform switch off, accounting-only plan, or the viewer fails `permissionsAny` | nobody |

`locked` wins over a failed `permissionsAny` for an owner (who bypasses it),
and a non-owner who cannot buy never sees `locked` anyway.

Every other permission check stays where it is: the sidebar's existing
`filterNavByPermissions` pass removes links and modules a member holds no
`NAV_PERMISSIONS` tag for, after app states have been applied. An app with no
remaining links simply does not appear for that member. Projects stays
untagged in `NAV_PERMISSIONS` (a test pins that); its `VIEW_PROJECTS` gate
moves from the shell's `canAccessProjects` boolean into `permissionsAny`.

The registry, with today's gates moved into it unchanged:

| App | entitlement | other |
|---|---|---|
| accounting | `premiumAccounting` | `requiresPaidPlan`, `inAccountingOnly`, `permissionsAny: ['VIEW_LEDGER']` |
| expenses | `premiumAccounting` | same as accounting, `soldWith: 'accounting'` |
| manufacturing | `premiumManufacturing` | `platformFeature: 'manufacturing'` |
| projects | — | `platformFeature: 'projects'`, `permissionsAny: ['VIEW_PROJECTS']` |
| chat (utility) | `teamChat` | not in accounting-only |
| help (utility) | — | `platformFeature: 'help'`, `inAccountingOnly`, `railGroup: 'help'` |
| support (utility) | — | `platformFeature: 'support'` *or* `feedback`, `inAccountingOnly`, `railGroup: 'help'` |
| whats-new (utility) | — | `railGroup: 'help'` |
| account-settings (utility) | — | `inAccountingOnly` |
| admin | — | platform admins only; never in the tenant shell |
| everything else | — | — |

The Sidebar's hardcoded module if-chain (`Sidebar.tsx`, the `.filter((module)
=> …)` over `buildNavModulesFromLayout`) is replaced by a lookup of these
states for the tenant shell. The platform-admin console, the referee portal and
the employee portal keep their own branches; they are not apps. A test pins
that every top-level `module` in `NAV_REGISTRY` other than `dashboard` has an
`APP_REGISTRY` entry, so a new module cannot silently skip the gate.

**Hiding declutters; it does not secure.** A hidden app's URLs still open and
its API is untouched. Permissions remain the only access control.

## 2. Shell layout (tenant mode, `appShell` on)

```text
┌────┬──────────────────┬──────────────────────────────
│mark│ Business name     │  header (unchanged, §2.12)
├────┼──────────────────┤
│ ⊞  │ 🔍 Search all apps│
│ S  │ Sales             │
│ P  │  Overview         │
│ I  │  Invoices         │
│ A  │  ▸ Reports        │
│ …  │  ▸ Setup          │
│    │                   │
│ 💬 │                   │
│ ?  │                   │
│ ⚙  │                   │
│ «  │                   │
└────┴──────────────────┴──────────────────────────────
```

**Rail** (56px, `bg-white`, `border-e`): brand mark (link to Home, as the logo
is today) in a cell the header's height; then Home (`LayoutGrid`); then the
business apps in layout order; a flexible gap; then the utility apps; then the
collapse toggle. Each item is a 44px touch target with a tooltip of the app's
name. Active app: `bg-blue-50 text-blue-600` with a 3px `blue-600` bar on the
inline-start edge. A utility with a live count (Chat unread) shows the existing
dot. An app any of whose links carries a count (Accounting's pending vouchers)
shows an amber dot.

**App panel** (resizable, default 232px, the existing resize handle and
min/max): business name row; search; the active app's name as a heading
(`text-xs font-semibold text-gray-500`); the app's children, rendered with the
current subgroup/link markup, accordion and expand-all/collapse-all unchanged.

**Which app is active** comes from the URL: the module owning the
longest-prefix-matching link href. On a path no app owns, the panel keeps the
last active app. On Home (`/dashboard`) and before any app has been visited,
the panel lists the apps themselves (icon + name, one link each).

**Clicking an app icon** on desktop navigates to the app's first link (its
Overview where it has one) — a real link, so it opens in a new tab with a
middle click. In the mobile drawer it only switches the panel, so a member can
reach "Sales › Invoices" without first loading Sales › Overview.

**Search** filters every app the member can see, not only the active one;
results render grouped by app with all groups open (today's search view).
`Ctrl+K` / `⌘K` focuses it from anywhere, expanding the panel first if it is
collapsed.

**Collapsed**: the panel disappears and only the rail remains (56px, against
today's 64px collapsed sidebar). Persisted in `localStorage` as today.

**Mobile** (`<md`): the existing drawer holds rail + panel side by side
(56 + 264 = 320px; fits 360px). It opens on the active app's menu, or the app
list on Home. The menu button's chat dot is unchanged.

**RTL**: logical properties throughout (`border-e`, `start-0`, `ms-*`), as the
current sidebar does.

**Header** is untouched — no app switcher goes there (§2.12).

## 3. Home

Route stays `/dashboard` (`routes.home`): bookmarks, redirects and the
onboarding check all point at it.

When `appShell` is on, the page renders, in order:

1. **App tiles** — one tile per available business app the member can reach
   (same resolution as the rail), in layout order. A tile: icon, name, and one
   **pulse line** (a count and what it counts) when the app has a non-zero
   metric. Clicking goes to the pulse's page if there is one, otherwise the
   app's first link. 2 columns on a phone, 4 on `md`, 6 on `xl`.
2. **"Add to your plan"** — owners and members with `MANAGE_USERS` (the
   existing `canManageBilling`) only: one muted tile per `locked` app (except
   those with `soldWith`), with a lock icon. Clicking opens a `ModalShell`
   sheet: the app's name, a one-paragraph description, and **See plans and
   add-ons** → `/billing`.
3. A **Manage apps** link (`/settings/apps`) for owners and managers.
4. The dashboard variant, unchanged.

### `GET /home/pulse`

One request for every tile (round trips dominate load time from Dhaka — see
the 2026-10-04 dashboard measurements). Response:

```ts
type HomePulse = Record<string, { count: number; href: string } | undefined>;
```

The service computes each app's metric only if the caller holds a permission
the metric's own page requires, each in its own `try`, in parallel; a metric
that fails or is not permitted is simply absent. Branch-scoped metrics use
`BranchScopeService` the way the module dashboards do. The labels are
client-side i18n keyed by app id, so the API carries no copy.

Metrics (one per app; an app without one shows no pulse line):

| App | Count | Links to |
|---|---|---|
| Sales | sales awaiting delivery | delivery list |
| Inventory | low-stock products | reorder report |
| Accounting | vouchers awaiting approval | vouchers |
| CRM | follow-ups due today or overdue | follow-ups |
| Projects | my open tasks | my tasks |
| HR | leave requests awaiting approval | leaves |
| Purchase | purchase orders still open | purchase orders |
| Online Store | online orders awaiting action | storefront orders |

(Exact queries and permission sets are fixed in the implementation plan from a
read of each module.)

### Single-app landing

If, after app states and permissions, a member can reach exactly **one**
business app, `/dashboard` redirects to that app's first link. Utilities do
not count. The onboarding redirect for a new owner runs first, as now.

## 4. Apps settings

`/settings/apps`, linked from the Settings hub and from Home's "Manage apps".

- Lists every business app with its state: **available** apps have a
  Shown / Hidden switch; **locked** apps show a lock and **See plans** →
  `/billing`; unavailable apps are not listed.
- Saving writes the whole hidden list; the `me` query is invalidated so the
  rail, tiles and search update without a reload.
- Restricted exactly like the dashboard setting: `OWNER` or `MANAGER`. Others
  see the list read-only.

**Storage**: `Tenant.hidden_apps String[] @default([])` — additive, safe under
`prisma db push`. `GET`/`PATCH /tenants/app-settings`, validated against the
business app ids in `APP_REGISTRY` (unknown and utility ids are rejected).
`/auth/me` returns `hidden_apps` on each tenant entry beside
`dashboard_preference`.

## 5. Rollout

A new platform switch, **`appShell`** (`app_shell_enabled`, default `false`),
in `PlatformFeatures` and in the tenant-overridable list. Off: the current
sidebar and the current dashboard, byte-for-byte. On: the rail, Home tiles and
the Apps settings page. That lets the platform admin pilot it on one tenant
from the tenant's Configuration panel, then switch the platform default on,
then (a later change) delete the old rendering path.

`resolveAppStates` replaces the if-chain in **both** modes, so the
gating refactor ships behind no switch and is covered by tests that pin the
old behaviour.

## Testing

- `apps.test.ts` (shared-types): the state matrix — plan × platform switch ×
  hidden × accounting-only × paid plan — and that every `APP_REGISTRY` id is a
  module in `NAV_REGISTRY`.
- `Sidebar.test.tsx`: the existing suite passes unchanged with `appShell` off;
  new cases for rail mode — rail lists available apps, hidden apps drop out,
  active app follows the URL, search spans apps, mobile tap switches the panel.
- `HomePulseService` spec: a metric the member lacks permission for is absent;
  a failing metric does not fail the response.
- `/settings/apps` page test and `tenants.service` spec for the hidden list.
- Dashboard page test: tiles render only with `appShell`; single-app redirect.
- i18n catalog parity across all nine locales (existing test).

## Not in this project

- Merging apps (Expenses into Accounting, Imports into Purchase) — possible
  today through the nav editor.
- Business-type presets at signup.
- Per-user pinned or recent items (needs a per-user preferences store).
- API-side enforcement of entitlements (capability tree Tasks 3–4).
- New modules — the next spec.
