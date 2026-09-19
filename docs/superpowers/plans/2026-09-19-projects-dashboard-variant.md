# Projects Dashboard Variant Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give a member who holds only the Project User role a dashboard made of
tiles they can actually load, instead of the retail dashboard's grid of 403s.

**Architecture:** `DashboardVariant` gains a fourth value, `PROJECTS`.
`resolveDashboardVariant` — a pure function in shared-types — gains one branch
that returns it when the member holds `VIEW_PROJECTS` and no other module's read
permission. A new `ProjectsDashboard` component renders four tiles from endpoints
the API client already exposes; `app/(app)/dashboard/page.tsx` gains one line to
mount it. No backend work, no migration.

**Tech Stack:** TypeScript, Next.js 15 (App Router, client components), React,
Jest + Testing Library, Tailwind.

**Spec:** `docs/superpowers/specs/2026-09-19-projects-dashboard-variant-design.md`

## Global Constraints

- Work on `dev`. `.githooks/` blocks commits on `main`.
- **UI rules** (`docs/ui-design-guidelines.md`, non-negotiable): use `PageShell`
  and the shared primitives from `@/components/ui`; one accent colour,
  `blue-600`; semantic colours emerald/amber/red; no arbitrary hex Tailwind
  classes; no `rounded-2xl`/`rounded-3xl`; compact density (`text-sm`/`text-xs`
  body, `p-3 md:p-4` padding, `space-y-4` sections); ≥44px touch targets
  (`min-h-touch`); money always via `formatBDT()`, never a literal `$`.
- **Locales:** `apps/frontend/src/lib/localization/messages/catalog.test.ts`
  asserts every locale's key paths equal English's. A new key must be added to
  **all eight**: `en`, `bn`, `ar`, `de`, `es`, `fr`, `hi`, `ms`, `ur` — each at
  `<locale>/core.ts`, under `dashboardHome`. (That is nine directories; `en` is
  the baseline and the other eight must match it.)
- **Permission names are verified.** `VIEW_PURCHASES` and `VIEW_INVENTORY` do
  **not** exist in `StorePermission`. Use the exact eleven names in Task 1.
- Run tests from the package root: `packages/shared-types` and
  `apps/frontend` each have their own `jest` (`npm test`).
- End commit messages with:
  `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`
- **After finishing, update `TODO.md`** per `CLAUDE.md`: tick items, move them to
  `## COMPLETED` with today's date, add newly discovered work.

## File Structure

| File | Responsibility |
|---|---|
| `packages/shared-types/subscription-plans.ts` | Modify: add `PROJECTS` to `DashboardVariant`, add `NON_PROJECT_MODULE_READ_PERMISSIONS`, add the branch to `resolveDashboardVariant` |
| `packages/shared-types/subscription-plans.test.ts` | Modify: extend the `resolveDashboardVariant` describe |
| `apps/frontend/src/components/dashboard/ProjectsDashboard.tsx` | Create: the variant component |
| `apps/frontend/src/components/dashboard/ProjectsDashboard.test.tsx` | Create: its test |
| `apps/frontend/src/app/(app)/dashboard/page.tsx` | Modify: mount the variant |
| `apps/frontend/src/app/(app)/dashboard/page.test.tsx` | Modify: assert the mount |
| `apps/frontend/src/lib/localization/messages/{en,bn,ar,de,es,fr,hi,ms,ur}/core.ts` | Modify: add the `dashboardHome.projects` key block |

Task 1 is shared-types only and ships on its own. Task 2 adds locale keys (which
the catalog test gates). Task 3 builds the component. Task 4 wires it up. Each
task ends green and committed.

---

### Task 1: The resolver branch

**Files:**
- Modify: `packages/shared-types/subscription-plans.ts` (`DashboardVariant` at :555, `resolveDashboardVariant` at :573)
- Test: `packages/shared-types/subscription-plans.test.ts` (extend the `resolveDashboardVariant` describe, ~:99)

**Interfaces:**
- Consumes: nothing.
- Produces: `DashboardVariant` now includes `'PROJECTS'`.
  `NON_PROJECT_MODULE_READ_PERMISSIONS: readonly string[]` exported from
  `subscription-plans.ts`. `resolveDashboardVariant(preference, features, permissions)`
  keeps its exact signature and may now return `'PROJECTS'`.

- [ ] **Step 1: Write the failing tests**

Add inside the existing `describe('resolveDashboardVariant', ...)` block in
`packages/shared-types/subscription-plans.test.ts`:

```ts
describe('the projects-only member', () => {
    const PROJECT_USER = ['VIEW_PROJECTS', 'MANAGE_PROJECT_TASKS', 'LOG_PROJECT_TIME', 'USE_TEAM_CHAT'];
    const retail = () => normalizePlanFeatures({ premiumAccounting: true }, 'STANDARD');

    it('lands a projects-only member on the projects dashboard', () => {
        expect(resolveDashboardVariant('AUTO', retail(), PROJECT_USER)).toBe('PROJECTS');
    });

    it('ignores the tenant preference, which cannot select this variant', () => {
        // Earned by permissions, never chosen: a workspace must not be able to
        // put everyone on one member's personal dashboard.
        expect(resolveDashboardVariant('ACCOUNTING', retail(), PROJECT_USER)).toBe('PROJECTS');
        expect(resolveDashboardVariant('RETAIL', retail(), PROJECT_USER)).toBe('PROJECTS');
    });

    it('drops back to the plan default when the member reads any other module', () => {
        for (const extra of NON_PROJECT_MODULE_READ_PERMISSIONS) {
            expect(resolveDashboardVariant('AUTO', retail(), [...PROJECT_USER, extra])).toBe('RETAIL');
        }
    });

    it('does not move an accounting-only tenant, which has no projects routes', () => {
        const features = normalizePlanFeatures(
            { premiumAccounting: true, accountingOnly: true },
            'ACCOUNTING',
        );
        expect(resolveDashboardVariant('AUTO', features, PROJECT_USER)).toBe('ACCOUNTING');
    });

    it('leaves a member with no projects permission alone', () => {
        expect(resolveDashboardVariant('AUTO', retail(), ['CREATE_SALE'])).toBe('RETAIL');
        expect(resolveDashboardVariant('AUTO', retail(), [])).toBe('RETAIL');
    });

    it('lists only real permissions, so a rename breaks the build not the gate', () => {
        for (const permission of NON_PROJECT_MODULE_READ_PERMISSIONS) {
            expect(StorePermission[permission as keyof typeof StorePermission]).toBe(permission);
        }
    });
});
```

Extend the import at the top of the file to add `NON_PROJECT_MODULE_READ_PERMISSIONS`
to the existing `from './subscription-plans'` list, and add a new import line:

```ts
import { StorePermission } from './index';
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd packages/shared-types && npx jest subscription-plans -t "projects-only member"`
Expected: FAIL — `NON_PROJECT_MODULE_READ_PERMISSIONS` is not exported.

- [ ] **Step 3: Add the constant and the type value**

In `packages/shared-types/subscription-plans.ts`, change `DashboardVariant` (:555):

```ts
/** What the dashboard page actually renders once the preference is resolved. */
export type DashboardVariant = 'RETAIL' | 'ACCOUNTING' | 'CRM' | 'PROJECTS';
```

Leave `DASHBOARD_PREFERENCES` (:550) **unchanged** — `PROJECTS` is deliberately
not selectable, so `Tenant.dashboard_preference` needs no migration.

Add above `resolveDashboardVariant`:

```ts
/**
 * Holding any of these means the member reads some module other than Projects,
 * so the projects dashboard is not their landing page.
 *
 * A new module's read permission belongs in this list. Leaving it out does not
 * fail loudly — it silently gives that module's users the projects dashboard.
 *
 * Deliberately module *read* markers rather than "every permission outside the
 * Projects module": USE_TEAM_CHAT and SWITCH_STORES sit in half the role
 * templates and say nothing about which dashboard fits. Names are exact —
 * VIEW_PURCHASES and VIEW_INVENTORY do not exist.
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

- [ ] **Step 4: Add the branch**

In `resolveDashboardVariant`, immediately **after** the `accountingOnly` early
return and **before** `let planDefault` is computed:

```ts
  // Earned by permissions, not chosen by the tenant: a member who reads only
  // Projects lands there whatever the plan or preference says. Placed before
  // the plan default so the narrowest role wins; placed after accountingOnly
  // because such a workspace has no projects routes to land on.
  const readsOnlyProjects =
    permissions.includes('VIEW_PROJECTS')
    && !NON_PROJECT_MODULE_READ_PERMISSIONS.some((entry) => permissions.includes(entry));
  if (readsOnlyProjects) {
    return 'PROJECTS';
  }
```

Then update the function's doc comment (:561-572) — it currently says the
variant comes from "the plan's default, the tenant's own choice, and what the
user can actually load". Add a fourth sentence:

```
 * One case inverts that order. A member who reads only Projects gets the
 * projects dashboard before the plan is consulted at all, because the retail
 * fallback would hand them a page of tiles they have no permission to load.
 * That makes this function person-shaped, not only tenant-shaped.
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd packages/shared-types && npx jest subscription-plans`
Expected: PASS — the new describe and every pre-existing case.

- [ ] **Step 6: Commit**

```bash
git add packages/shared-types/subscription-plans.ts packages/shared-types/subscription-plans.test.ts
git commit -m "$(cat <<'EOF'
feat(dashboard): resolve a projects-only member to their own variant

A member holding only Project User landed on RETAIL, whose every tile
reads an endpoint they have no permission for. Adds PROJECTS to
DashboardVariant and one resolver branch, placed before the plan default
so the narrowest role wins. Not selectable as a tenant preference.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Locale keys

**Files:**
- Modify: `apps/frontend/src/lib/localization/messages/en/core.ts` (`dashboardHome`, ~:1494)
- Modify: the same block in `bn`, `ar`, `de`, `es`, `fr`, `hi`, `ms`, `ur` `/core.ts`
- Test: `apps/frontend/src/lib/localization/messages/catalog.test.ts` (existing, do not edit)

**Interfaces:**
- Consumes: nothing.
- Produces: `t.dashboardHome.projects` with exactly these eight keys —
  `title`, `subtitle`, `myOpenTasks`, `hoursToday`, `hoursThisWeek`,
  `activeProjects`, `timerRunning`, `nothingAssigned`.

- [ ] **Step 1: Run the catalog test to confirm it is green first**

Run: `cd apps/frontend && npx jest catalog`
Expected: PASS. (If it already fails, stop — that is a pre-existing problem, not
yours.)

- [ ] **Step 2: Add the English keys**

In `apps/frontend/src/lib/localization/messages/en/core.ts`, inside the
`dashboardHome: {` object, add:

```ts
        projects: {
            title: 'My Work',
            subtitle: 'Your tasks, your hours',
            myOpenTasks: 'My Open Tasks',
            hoursToday: 'Hours Today',
            hoursThisWeek: 'Hours This Week',
            activeProjects: 'Active Projects',
            timerRunning: 'Timer running',
            nothingAssigned: 'Nothing assigned yet',
        },
```

- [ ] **Step 3: Run the catalog test to verify it fails**

Run: `cd apps/frontend && npx jest catalog`
Expected: FAIL — eight locales no longer match the English baseline, each
reported as a missing `dashboardHome.projects.*` path.

- [ ] **Step 4: Add the same block to the other eight locales**

Add the identical key block to the `dashboardHome` object in each of
`bn`, `ar`, `de`, `es`, `fr`, `hi`, `ms`, `ur` `/core.ts`. Translate the eight
string values into that locale; keep the key names byte-identical — the test
compares key paths, and a translated *key* fails it.

- [ ] **Step 5: Run the catalog test to verify it passes**

Run: `cd apps/frontend && npx jest catalog`
Expected: PASS — all nine locales agree.

- [ ] **Step 6: Commit**

```bash
git add apps/frontend/src/lib/localization/messages
git commit -m "$(cat <<'EOF'
i18n(dashboard): add the projects dashboard's keys to every locale

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: The ProjectsDashboard component

**Files:**
- Create: `apps/frontend/src/components/dashboard/ProjectsDashboard.tsx`
- Test: `apps/frontend/src/components/dashboard/ProjectsDashboard.test.tsx`

**Interfaces:**
- Consumes: `t.dashboardHome.projects` (Task 2). `DashboardIdentity` from
  `./dashboard-identity` — `{ greeting: string; tenantName: string; renewalEnd: string | null }`.
  `PageShell` from `@/components/ui/compact/PageShell`. `KpiTileGrid`,
  `DashboardSection`, `type KpiTileSpec` from `./ModuleDashboard`.
- Produces: `export default function ProjectsDashboard(props: DashboardIdentity)`.

**Why this component fetches directly rather than via `useModuleDashboard`:**
that hook exists for module Overviews that ask one endpoint for a window, a
prior window and a trend series. This dashboard reads four unrelated endpoints
and needs no deltas or sparklines, so the hook would be scaffolding around a
shape it does not have. Keep the fetching local and plain.

- [ ] **Step 1: Write the failing test**

Create `apps/frontend/src/components/dashboard/ProjectsDashboard.test.tsx`:

```tsx
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import ProjectsDashboard from './ProjectsDashboard';
import { api } from '@/lib/api';

jest.mock('@/lib/i18n', () => {
    const { enMessages } = require('@/lib/localization/messages/en');
    const actual = jest.requireActual('@/lib/i18n');
    return {
        useI18n: () => ({ t: enMessages, locale: 'en' }),
        formatMessage: actual.formatMessage,
    };
});

jest.mock('@/lib/api', () => ({
    api: {
        getMe: jest.fn(),
        getProjectTasks: jest.fn(),
        getProjectTimeReport: jest.fn(),
        getProjects: jest.fn(),
        getProjectTimer: jest.fn(),
    },
}));

jest.mock('next/link', () => ({
    __esModule: true,
    default: ({ children, href }: any) => <a href={href}>{children}</a>,
}));

jest.mock('lucide-react', () => new Proxy({}, { get: () => () => null }));

const identity = { greeting: 'Good morning, Nayeem 👋', tenantName: 'Acme', renewalEnd: null };

beforeEach(() => {
    jest.clearAllMocks();
    (api.getMe as jest.Mock).mockResolvedValue({ id: 'user-1', name: 'Nayeem' });
    (api.getProjectTasks as jest.Mock).mockResolvedValue({
        data: [
            { id: 'task-1', title: 'Wire the invoice printer', project: { id: 'p1', name: 'Till rollout' } },
            { id: 'task-2', title: 'Fix the chalan layout', project: { id: 'p1', name: 'Till rollout' } },
        ],
        total: 2,
    });
    (api.getProjectTimeReport as jest.Mock).mockResolvedValue({ summary: { hours: 6.5 }, rows: [] });
    (api.getProjects as jest.Mock).mockResolvedValue({ data: [{ id: 'p1', name: 'Till rollout' }], total: 1 });
    (api.getProjectTimer as jest.Mock).mockResolvedValue(null);
});

it('shows the four tiles built from the member\'s own rows', async () => {
    render(<ProjectsDashboard {...identity} />);

    expect(await screen.findByText('My Open Tasks')).toBeInTheDocument();
    expect(screen.getByText('Hours Today')).toBeInTheDocument();
    expect(screen.getByText('Hours This Week')).toBeInTheDocument();
    expect(screen.getByText('Active Projects')).toBeInTheDocument();
});

it('asks only for its own hours, whatever the record scope says', async () => {
    // A wide Project User would otherwise see the team's hours under a tile
    // labelled "my hours". The label has to be true at either scope.
    render(<ProjectsDashboard {...identity} />);

    await waitFor(() => expect(api.getProjectTimeReport).toHaveBeenCalled());
    for (const call of (api.getProjectTimeReport as jest.Mock).mock.calls) {
        expect(call[0].userId).toBe('user-1');
    }
});

it('lists the member\'s open tasks', async () => {
    render(<ProjectsDashboard {...identity} />);

    expect(await screen.findByText('Wire the invoice printer')).toBeInTheDocument();
    expect(screen.getByText('Fix the chalan layout')).toBeInTheDocument();
});

it('renders an empty workload without crashing', async () => {
    (api.getProjectTasks as jest.Mock).mockResolvedValue({ data: [], total: 0 });
    (api.getProjects as jest.Mock).mockResolvedValue({ data: [], total: 0 });
    (api.getProjectTimeReport as jest.Mock).mockResolvedValue({ summary: { hours: 0 }, rows: [] });

    render(<ProjectsDashboard {...identity} />);

    expect(await screen.findByText('Nothing assigned yet')).toBeInTheDocument();
});

it('survives an endpoint failing', async () => {
    (api.getProjectTimer as jest.Mock).mockRejectedValue(new Error('boom'));

    render(<ProjectsDashboard {...identity} />);

    expect(await screen.findByText('My Open Tasks')).toBeInTheDocument();
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/frontend && npx jest ProjectsDashboard`
Expected: FAIL — cannot resolve `./ProjectsDashboard`.

- [ ] **Step 3: Write the component**

Create `apps/frontend/src/components/dashboard/ProjectsDashboard.tsx`. Follow
the UI rules in Global Constraints. Structure:

```tsx
'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { routes } from '@/lib/routes';
import PageShell from '@/components/ui/compact/PageShell';
import { DashboardSection, KpiTileGrid, type KpiTileSpec } from './ModuleDashboard';
import type { DashboardIdentity } from './dashboard-identity';

type OpenTask = { id: string; title: string; project?: { id: string; name: string } | null };

/** Today and the last seven days, as the ISO dates the time report wants. */
function windows() {
    const today = new Date();
    const iso = (date: Date) => date.toISOString().slice(0, 10);
    const weekAgo = new Date(today);
    weekAgo.setDate(weekAgo.getDate() - 6);
    return { today: iso(today), weekStart: iso(weekAgo) };
}

/**
 * The landing page for a member who reads only Projects — their tasks, their
 * hours, the projects they are on.
 *
 * `userId` is sent explicitly on both hour queries rather than left to the
 * viewer's record scope. A *wide* Project User (scope ALL) would otherwise see
 * the team's hours under a tile that says "my hours"; a narrow one is filtered
 * server-side anyway, so the two simply agree.
 *
 * The running timer is reflected, never started here: the FloatingPanel tracker
 * is already mounted shell-wide for this member, and a second control would be
 * two ways to reach one feature (UI spec §2.8).
 */
export default function ProjectsDashboard({ greeting, tenantName }: Readonly<DashboardIdentity>) {
    const { t } = useI18n();
    const copy = t.dashboardHome.projects;

    const [tasks, setTasks] = useState<OpenTask[]>([]);
    const [openCount, setOpenCount] = useState(0);
    const [hoursToday, setHoursToday] = useState(0);
    const [hoursWeek, setHoursWeek] = useState(0);
    const [activeProjects, setActiveProjects] = useState(0);
    const [timerRunning, setTimerRunning] = useState(false);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        let cancelled = false;
        const { today, weekStart } = windows();

        (async () => {
            const me = await api.getMe().catch(() => null);
            const userId = me?.id;
            if (cancelled || !userId) return;

            // Each tile fails on its own: one dead endpoint must not blank the page.
            const [taskPage, todayReport, weekReport, projectPage, timer] = await Promise.all([
                api.getProjectTasks({ assigneeId: userId, status: 'OPEN', limit: 5 }).catch(() => null),
                api.getProjectTimeReport({ from: today, to: today, groupBy: 'date', userId }).catch(() => null),
                api.getProjectTimeReport({ from: weekStart, to: today, groupBy: 'date', userId }).catch(() => null),
                api.getProjects({ status: 'ACTIVE', limit: 1 }).catch(() => null),
                api.getProjectTimer().catch(() => null),
            ]);
            if (cancelled) return;

            setTasks(taskPage?.data ?? []);
            setOpenCount(taskPage?.total ?? 0);
            setHoursToday(todayReport?.summary?.hours ?? 0);
            setHoursWeek(weekReport?.summary?.hours ?? 0);
            setActiveProjects(projectPage?.total ?? 0);
            setTimerRunning(Boolean(timer));
            setLoading(false);
        })();

        return () => { cancelled = true; };
    }, []);

    const tiles: KpiTileSpec[] = [
        { key: 'tasks', title: copy.myOpenTasks, value: String(openCount), delta: { label: '—', positive: true } },
        { key: 'today', title: copy.hoursToday, value: hoursToday.toFixed(1), delta: { label: '—', positive: true } },
        { key: 'week', title: copy.hoursThisWeek, value: hoursWeek.toFixed(1), delta: { label: '—', positive: true } },
        { key: 'projects', title: copy.activeProjects, value: String(activeProjects), delta: { label: '—', positive: true } },
    ];

    return (
        <PageShell maxWidth="full">
            <div className="space-y-4">
                <div>
                    <h1 className="text-lg font-semibold text-gray-900">{greeting}</h1>
                    <p className="text-xs text-gray-500">{tenantName} • {copy.subtitle}</p>
                </div>

                {timerRunning && (
                    <p className="text-xs font-medium text-emerald-600">{copy.timerRunning}</p>
                )}

                <KpiTileGrid tiles={tiles} loading={loading} deltaContext="" />

                <DashboardSection label={copy.myOpenTasks}>
                    {tasks.length === 0 ? (
                        <p className="text-sm text-gray-500">{copy.nothingAssigned}</p>
                    ) : (
                        <ul className="space-y-2">
                            {tasks.map((task) => (
                                <li key={task.id}>
                                    <Link
                                        href={routes.projects.taskDetail(task.id)}
                                        className="flex min-h-touch items-center justify-between rounded-lg border border-gray-200 p-3 text-sm text-gray-900 hover:border-blue-600"
                                    >
                                        <span>{task.title}</span>
                                        {task.project && (
                                            <span className="text-xs text-gray-500">{task.project.name}</span>
                                        )}
                                    </Link>
                                </li>
                            ))}
                        </ul>
                    )}
                </DashboardSection>
            </div>
        </PageShell>
    );
}
```

Before writing, open `ModuleDashboard.tsx` and confirm the real `KpiTileSpec`
shape and `KpiTileGrid` props, and `@/lib/routes` for the correct tasks route
constant. Adjust the code above to match what is actually there rather than
forcing these names — the types are the source of truth, this block is the
intent.

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd apps/frontend && npx jest ProjectsDashboard`
Expected: PASS — all five cases.

- [ ] **Step 5: Commit**

```bash
git add apps/frontend/src/components/dashboard/ProjectsDashboard.tsx apps/frontend/src/components/dashboard/ProjectsDashboard.test.tsx
git commit -m "$(cat <<'EOF'
feat(dashboard): add the projects-only member's dashboard

Four tiles and an open-task list, all from endpoints the client already
has. Sends userId explicitly so the "my hours" tiles stay true for a
wide Project User as well as a narrow one, and reflects the running
timer rather than offering a second way to start one.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Mount the variant

**Files:**
- Modify: `apps/frontend/src/app/(app)/dashboard/page.tsx` (:94-98)
- Test: `apps/frontend/src/app/(app)/dashboard/page.test.tsx`

**Interfaces:**
- Consumes: `ProjectsDashboard` (Task 3), `'PROJECTS'` from `DashboardVariant` (Task 1).
- Produces: nothing downstream.

- [ ] **Step 1: Write the failing test**

This file renders the variants **for real** and asserts on visible text (see the
`describe('DashboardPage — variant selection')` block, ~:240). Follow that.

Add to that describe, and add the five `api` methods Task 3 uses to the
`jest.mock('@/lib/api', ...)` factory at the top of the file if they are not
already listed:

```tsx
    it('renders the projects dashboard for a member who reads only Projects', async () => {
        (api.getMe as jest.Mock).mockResolvedValue({
            id: 'user-1',
            name: 'Nayeem',
            tenants: [{
                id: 't1',
                name: 'Acme',
                permissions: ['VIEW_PROJECTS', 'MANAGE_PROJECT_TASKS', 'LOG_PROJECT_TIME'],
                subscription: { plan: { code: 'STANDARD', features_json: { premiumAccounting: true } } },
            }],
        });
        (api.getProjectTasks as jest.Mock).mockResolvedValue({ data: [], total: 0 });
        (api.getProjectTimeReport as jest.Mock).mockResolvedValue({ summary: { hours: 0 }, rows: [] });
        (api.getProjects as jest.Mock).mockResolvedValue({ data: [], total: 0 });
        (api.getProjectTimer as jest.Mock).mockResolvedValue(null);

        render(<DashboardPage />);

        expect(await screen.findByText('My Open Tasks')).toBeInTheDocument();
        expect(screen.getByText('Hours This Week')).toBeInTheDocument();

        // Not the retail dashboard, and none of its endpoints are touched.
        expect(api.getProducts).not.toHaveBeenCalled();
        expect(api.getSalesList).not.toHaveBeenCalled();
    });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/frontend && npx jest "app/\(app\)/dashboard"`
Expected: FAIL — the retail dashboard renders instead.

- [ ] **Step 3: Mount it**

In `apps/frontend/src/app/(app)/dashboard/page.tsx`, add the import beside the
other three variants:

```tsx
import ProjectsDashboard from '@/components/dashboard/ProjectsDashboard';
```

and one line before the retail fallback at the end of the component:

```tsx
    if (resolved.variant === 'ACCOUNTING') return <AccountingDashboard {...identity} />;
    if (resolved.variant === 'CRM') return <CrmDashboard {...identity} />;
    if (resolved.variant === 'PROJECTS') return <ProjectsDashboard {...identity} />;
    return <RetailDashboard {...identity} />;
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd apps/frontend && npx jest "app/\(app\)/dashboard"`
Expected: PASS.

- [ ] **Step 5: Run the whole frontend and shared-types suites**

Run: `cd packages/shared-types && npm test` then `cd apps/frontend && npm test`
Expected: PASS. Investigate any failure before committing — do not assume it is
unrelated.

- [ ] **Step 6: Commit**

```bash
git add "apps/frontend/src/app/(app)/dashboard/page.tsx" "apps/frontend/src/app/(app)/dashboard/page.test.tsx"
git commit -m "$(cat <<'EOF'
feat(dashboard): mount the projects variant on /dashboard

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 7: Update TODO.md**

Per `CLAUDE.md`: tick the completed items, move them to `## COMPLETED` with
`— done 2026-09-19`, and add anything this work surfaced. Commit separately.

---

## Verification

Manual check, since no test proves the real thing:

1. In a workspace, give a test member **only** the Project User role
   (Team → Roles), and set its record scope to **Own records only**.
2. Sign in as them and open `/dashboard`. Expect the four tiles, populated —
   not the retail dashboard, and no 403s in the console.
3. Give the same member a second role carrying any permission from
   `NON_PROJECT_MODULE_READ_PERMISSIONS`. Expect the retail dashboard again.

## Known gaps this plan does not close

Both are recorded in the spec's "Out of scope" section:

- `GET /projects/:id/burndown` leaks private-project data to non-members
  (`projects.controller.ts:261` drops the viewer). **Approved, separate work.**
- `project-tasks.service.ts:274-277` returns a task's time entries with logger
  names and no `timeFilter`, so a narrow member still reads teammates' hours on
  any task they can see. **Not yet approved**, and it is the one that actually
  undercuts the "own hour logs only" boundary.

Also open: the Projects nav has no per-link permission filtering, so **Setup**
shows for a Project User and 403s on entry.
