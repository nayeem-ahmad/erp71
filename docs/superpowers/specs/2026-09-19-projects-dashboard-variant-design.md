# A dashboard for the projects-only user

**Date:** 2026-09-19
**Status:** approved, not yet implemented

## The problem

A member holding only the seeded **Project User** role — `VIEW_PROJECTS`,
`MANAGE_PROJECT_TASKS`, `LOG_PROJECT_TIME`, `USE_TEAM_CHAT` — lands on the
`RETAIL` dashboard, because that is what `resolveDashboardVariant` falls back
to. Every tile on it reads a sales or inventory endpoint they have no
permission for, so their first screen of the product is a grid of empty cards
and 403s.

This is the same class of bug the resolver's own doc comment already warns
about in the other direction: sending a cashier to the accounting dashboard.
The fallback is missing a case, not misbehaving.

## What this is not

This does **not** change who can see what. Project visibility and
`TenantRole.record_scope` already decide that, and both are enforced server
side (`ProjectAccessService`). This is a landing-page fix. A narrow user's
dashboard narrows itself because the endpoints behind it are already filtered.

Two genuine enforcement gaps were found while investigating and are recorded at
the end. Neither is fixed here.

## Design

### 1. A fourth variant

`DashboardVariant` gains `PROJECTS`:

```ts
export type DashboardVariant = 'RETAIL' | 'ACCOUNTING' | 'CRM' | 'PROJECTS';
```

`DASHBOARD_PREFERENCES` does **not** gain it, and `Tenant.dashboard_preference`
is untouched — no migration. A tenant may not put its whole workspace on a
personal dashboard; this variant is earned by the user's own permissions or not
at all. That keeps the stored preference meaning exactly what it means today.

### 2. The rule

In `resolveDashboardVariant` (`packages/shared-types/subscription-plans.ts`),
after the `accountingOnly` early return and **before** `planDefault` is
computed:

```
if permissions include VIEW_PROJECTS
   and permissions include none of NON_PROJECT_MODULE_READ_PERMISSIONS
   → PROJECTS
```

Placement is the design. After `accountingOnly`, because such a workspace has
no projects routes to land on. Before the plan default, because that is what
makes the narrowest role win: a projects-only person gets the projects
dashboard whatever the workspace's plan or preference says.

This makes the function genuinely person-shaped for the first time. It already
takes `permissions`, so the signature does not change, but its doc comment
must be rewritten — "which dashboard a tenant uses" stops being the whole
truth.

### 3. The exclusion set

The fragile part. A module read permission added later will not be in this
list, and a user holding only that module plus Projects would wrongly get the
projects dashboard. Two mitigations, both taken:

**A named constant beside the resolver**, so there is one obvious place to
update:

```ts
/**
 * Holding any of these means the member reads some module other than Projects,
 * so the projects dashboard is not their landing page.
 *
 * A new module's read permission belongs in this list. Leaving it out does not
 * fail loudly — it silently gives that module's users the projects dashboard.
 *
 * Deliberately a list of module *read* markers rather than "every permission
 * outside the Projects module": USE_TEAM_CHAT and SWITCH_STORES sit in half
 * the role templates and say nothing about which dashboard fits.
 */
export const NON_PROJECT_MODULE_READ_PERMISSIONS = [
  'VIEW_PRODUCT_CATALOG',
  'CREATE_INVENTORY_MOVEMENTS',
  'CREATE_SALE',
  'CREATE_PURCHASE',
  'VIEW_LEDGER',
  'VIEW_LEADS',
  'VIEW_CRM_INTERACTIONS',
  'VIEW_HR',
  'VIEW_LOANS',
  'VIEW_INVESTORS',
  'MANAGE_USERS',
] as const;
```

These names are verified against `StorePermission` in
`packages/shared-types/index.ts`. Note `VIEW_PURCHASES` and `VIEW_INVENTORY`
do **not** exist — the markers for those modules are `CREATE_PURCHASE` and
`CREATE_INVENTORY_MOVEMENTS`.

**A test that fails on drift**: assert every entry is a key of
`StorePermission`. A renamed or removed permission then breaks the build
instead of silently un-gating. No test can know that a *new* permission ought
to have been added; the comment is what carries that.

### 4. The component

`apps/frontend/src/components/dashboard/ProjectsDashboard.tsx`, built on the
same shell as its three siblings — `PageShell`, `DashboardHeader`,
`KpiTileGrid`, `DashboardSection` from `ModuleDashboard.tsx` — and taking the
same `identity` prop (`greeting`, `tenantName`, `renewalEnd`). So
`app/(app)/dashboard/page.tsx` gains one line:

```tsx
if (resolved.variant === 'PROJECTS') return <ProjectsDashboard {...identity} />;
```

**Four KPI tiles**, all from endpoints the API client already exposes — no new
backend work:

| Tile | Source |
|---|---|
| My open tasks | `getProjectTasks({ assigneeId: me, status: open })` |
| Hours today | `getProjectTimeReport({ from, to, groupBy: 'date', userId: me })` |
| Hours this week | the same call, wider window |
| Active projects | `getProjects({ status: 'ACTIVE' })` — already visibility-filtered |

**Below the tiles:** my open tasks (linking into task detail), my recent hour
logs, and a running-timer indicator from `getProjectTimer()`.

The timer is **reflected, not duplicated**. The `FloatingPanel` tracker is
already mounted shell-wide for this user (`canTrackTime`), so a second start
control on the dashboard would be two ways to reach one feature — what §2.8 of
the UI spec argues against. The dashboard shows what is running and links to
it.

**`userId: me` is passed explicitly** on the time calls rather than relying on
record scope. A *wide* Project User (scope `ALL`) would otherwise see
team-wide hours under a tile labelled "my hours". The label has to be true at
either scope; for a narrow user the server narrows it anyway and the two
simply agree.

### 5. Testing

- **Resolver** (`subscription-plans.test.ts`, extending the existing
  `resolveDashboardVariant` describe): a projects-only permission set resolves
  to `PROJECTS`; adding any one entry of the exclusion set drops it back to the
  plan default; an `accountingOnly` tenant still pins to `ACCOUNTING` even for
  a projects-only member; an explicit tenant preference does not override
  `PROJECTS`; the exclusion set is a subset of `StorePermission`.
- **Component** (`ProjectsDashboard.test.tsx`), following
  `HrDashboard.test.tsx`: mocked `api`, `useI18n` bound to real `enMessages` so
  a missing key fails; renders tiles from fixture data; sends `userId` on the
  time calls; renders the empty state without crashing when the user has no
  tasks, no hours and no running timer.
- **Page** (`dashboard/page.test.tsx`): the `PROJECTS` variant renders
  `ProjectsDashboard`.

### 6. i18n

Labels go through `useI18n` like every sibling, so keys are added to the locale
files under the existing dashboard namespace. Binding the component test to
real `enMessages` is what keeps a missing key from shipping as a blank tile.

## Risk

Low and contained. One new branch in a resolver that is pure and well tested,
one new component, one line in the page. Nobody's *permissions* change; only
which page they land on. The worst plausible failure is a user landing on the
wrong dashboard, which is what already happens today.

## Out of scope — found, not fixed

Two real enforcement gaps surfaced while investigating. Both predate this work
and neither is touched here:

1. **`GET /projects/:id/burndown`** leaks private-project data to non-members.
   `projects.controller.ts:261` passes `tenant.tenantId` where every sibling
   route passes `tenant`, so `projects.service.ts:170` never sees a viewer.
   The fix is approved and pending as separate work.
2. **`project-tasks.service.ts:274-277`** includes a task's `timeEntries` with
   each logger's name and no `timeFilter`, so a `record_scope = OWN` viewer
   reads teammates' hours on any task they can see. This is the only place the
   OWN scope is bypassed, and it is the one that actually undercuts the
   "own hour logs only" boundary. Not yet approved.

Also noted, not gaps but worth knowing: `PATCH`/`DELETE /project-time/:id` are
gated only by `LOG_PROJECT_TIME`, so at default scope one member can edit or
delete another's entry; and the Projects nav has no per-link permission
filtering, so **Setup** shows for a Project User and 403s on entry.
