# Project Staffing Matrix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Project Management a people × projects matrix and a remaining-hours load chart, so a manager can see who is on which project and where remaining work sits.

**Architecture:** One `GET /projects/staffing` read, derived from `ProjectMember`, `Project.manager_id`, and open-task remaining hours. A pure `mergeStaffing` builds the payload. The page at `/projects/staffing` renders a heatmap matrix (md+) and stacked load bars (every viewport) from that one payload. No schema, no new permission.

**Tech Stack:** NestJS, Prisma, Next.js 15, Tailwind, Jest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-11-11-project-staffing-matrix-design.md`

## Global Constraints

- Work on `dev`. `.githooks/` blocks commits on `main`.
- **UI rules** (`docs/ui-design-guidelines.md`): `PageShell` + `PageHeader`; `ModalShell` unused here; one accent `blue-600`; emerald/amber/red semantic only; no arbitrary hex; no `rounded-2xl`/`rounded-3xl`; compact density; ≥44px touch targets; notifications through the global toaster; money unused (hours are hours).
- Heat and bar colours are the written-out Tailwind pairs in the spec. A test asserts every class string appears as a literal in source.
- **Locales:** a new key must land in all nine of `en,bn,ar,de,es,fr,hi,ms,ur`. `catalog.test.ts` gates structure.
- `GET /projects/staffing` is declared **above** `@Get(':id')` on `ProjectsController`.
- Visibility and record scope go through `ProjectAccessService` (`projectFilter`, `ownRecordsOnly`, `memberProjectsOnly`). Do not add a second predicate.
- Person keys are `user:<id>` / `employee:<id>` / `unassigned`, matching member-candidates and the Tasks assignee filter.
- Run backend tests from `apps/backend` (`npx jest --config ./jest.config.js … --runInBand`). Run frontend tests from `apps/frontend`.
- After finishing, update `TODO.md` per `CLAUDE.md`.

## Review Focus

- An `OWN`-scoped viewer must not receive another person's row or the Unassigned row.
- A PRIVATE project the viewer is not on must not appear as a column, even if they hold `VIEW_PROJECTS`.
- An employee linked to a workspace user must be one row; hours on either assignee column add.
- A project manager with no `ProjectMember` row still occupies a MANAGER cell.
- At 360px the page body does not scroll horizontally; the matrix table is unmounted below `md`.

Each of those has a test in the task that owns the code.

---

## File Structure

| File | Responsibility |
|---|---|
| `apps/backend/src/projects/staffing.util.ts` | `personKey`, `parseStaffingStatuses`, `mergeStaffing`, `OVERLOAD_THRESHOLD` |
| `apps/backend/src/projects/staffing.util.spec.ts` | Pure merge cases |
| `apps/backend/src/projects/projects.staffing.service.ts` | Load visible projects, members, hours; call merge; apply OWN |
| `apps/backend/src/projects/projects.staffing.service.spec.ts` | Access + default status |
| `apps/backend/src/projects/project.dto.ts` | `StaffingQueryDto` |
| `apps/backend/src/projects/projects.controller.ts` | `GET staffing` |
| `apps/backend/src/projects/projects.module.ts` | Provider |
| `packages/shared-types/navigation.ts` | Node, both default layouts, sync comment |
| `apps/frontend/src/lib/routes.ts` | `projects.staffing` |
| `apps/frontend/src/lib/api.ts` | `getProjectStaffing` |
| `apps/frontend/src/lib/voice-nav-routes.ts` | `staffing` target |
| `apps/frontend/src/lib/staffing-heat.ts` | `staffingHeatClass` |
| `apps/frontend/src/components/projects/StaffingMatrix.tsx` | Heatmap table |
| `apps/frontend/src/components/projects/StaffingLoadChart.tsx` | Stacked bars + coverage |
| `apps/frontend/src/app/(app)/projects/staffing/page.tsx` | Page |
| nine `core.ts` / nine `projects.ts` | Copy |

---

### Task 1: Pure merge

**Files:**
- Create: `apps/backend/src/projects/staffing.util.ts`
- Test: `apps/backend/src/projects/staffing.util.spec.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `OVERLOAD_THRESHOLD = 3`
  - `STAFFING_DEFAULT_STATUSES = ['ACTIVE', 'ON_HOLD']`
  - `personKey(kind: 'user' | 'employee', id: string): string`
  - `parseStaffingStatuses(raw: string | undefined): string[]`
  - `mergeStaffing(input: MergeStaffingInput): StaffingResponse`

`StaffingResponse` / `StaffingCell` match the spec payload. `MergeStaffingInput` is `{ projects, members, managers, hours, linkedEmployees }` as in the spec.

- [ ] **Step 1: Write the failing tests**

In `staffing.util.spec.ts`:

```ts
it('keys a user and an employee the way the Tasks filter does', () => {
    expect(personKey('user', 'u1')).toBe('user:u1');
    expect(personKey('employee', 'e1')).toBe('employee:e1');
});

it('defaults status to ACTIVE and ON_HOLD, and ALL keeps every ProjectStatus', () => {
    expect(parseStaffingStatuses(undefined)).toEqual(['ACTIVE', 'ON_HOLD']);
    expect(parseStaffingStatuses('')).toEqual(['ACTIVE', 'ON_HOLD']);
    expect(parseStaffingStatuses('ALL')).toEqual(
        ['DRAFT', 'ACTIVE', 'ON_HOLD', 'COMPLETED', 'CANCELLED'],
    );
    expect(parseStaffingStatuses('ACTIVE,NOPE,COMPLETED')).toEqual(['ACTIVE', 'COMPLETED']);
});

it('paints a manager with no member row, a member with 0 remaining, assigned-not-on-team, and unassigned', () => {
    const out = mergeStaffing(fixture()); // one project, four people as in the spec
    expect(out.people.map((p) => p.key)).toEqual(['employee:e1', 'user:karim', 'user:rina', 'unassigned']);
    expect(out.people.find((p) => p.key === 'user:rina')!.cells['p1']).toMatchObject({
        role: 'MANAGER', isManager: true, remainingHours: 12, assignedNotOnTeam: false,
    });
    expect(out.people.find((p) => p.key === 'user:karim')!.cells['p1'].remainingHours).toBe(0);
    expect(out.people.find((p) => p.key === 'employee:e1')!.cells['p1'].assignedNotOnTeam).toBe(true);
    expect(out.people.find((p) => p.key === 'unassigned')!.cells['p1'].remainingHours).toBe(8);
    expect(out.summary).toMatchObject({ people: 3, overloaded: 0, unassignedRemainingHours: 8 });
});

it('collapses a linked employee onto the user and adds hours from both columns', () => {
    const out = mergeStaffing(linkedFixture()); // member as user u1, hours on assignee_employee_id e1, employee.user_id = u1
    expect(out.people.filter((p) => p.kind !== 'unassigned')).toHaveLength(1);
    expect(out.people[0].key).toBe('user:u1');
    expect(out.people[0].totals.remainingHours).toBe(10);
});

it('counts overload at 3+ projects', () => {
    expect(OVERLOAD_THRESHOLD).toBe(3);
    const out = mergeStaffing(threeProjectFixture());
    expect(out.summary.overloaded).toBe(1);
});
```

`fixture()` helpers live in the spec file.

- [ ] **Step 2: Run the tests and watch them fail**

Run: `cd apps/backend && npx jest --config ./jest.config.js src/projects/staffing.util.spec.ts --runInBand --no-coverage`

Expected: FAIL, module not found.

- [ ] **Step 3: Implement `staffing.util.ts`**

Export the names in the Interfaces block. `parseStaffingStatuses` uses the same five codes as `VALID_STATUSES` in `projects.service.ts`. `mergeStaffing` is the only place that decides cell role, collapse, unassigned, sort, and summary.

- [ ] **Step 4: Run the tests and watch them pass**

Same command. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/projects/staffing.util.ts apps/backend/src/projects/staffing.util.spec.ts
git commit -m "feat(projects): pure merge for the staffing matrix"
```

---

### Task 2: GET /projects/staffing

**Files:**
- Create: `apps/backend/src/projects/projects.staffing.service.ts`
- Create: `apps/backend/src/projects/projects.staffing.service.spec.ts`
- Modify: `apps/backend/src/projects/project.dto.ts` (add `StaffingQueryDto` next to `ListProjectsDto`)
- Modify: `apps/backend/src/projects/projects.controller.ts` (literal `GET staffing` above `:id`, beside `member-candidates`)
- Modify: `apps/backend/src/projects/projects.module.ts` (provider)

**Interfaces:**
- Consumes: `mergeStaffing`, `parseStaffingStatuses`, `personKey` from Task 1. `ProjectAccessService.projectFilter` / `ownRecordsOnly`.
- Produces: `ProjectsStaffingService.get(viewer: ProjectViewer, query: StaffingQueryDto): Promise<StaffingResponse>`. HTTP `GET /projects/staffing`.

Hours query: non-deleted tasks on the loaded projects whose `status_id` is in the tenant's non-DONE columns; `groupBy` project + `assignee_id` and project + `assignee_employee_id`, plus a third group where both assignees are null. Sum `remaining_hours`, count rows.

OWN: after merge, keep only `user:${viewer.userId}` (and that user's linked employee key if it somehow survived). Drop `unassigned`.

- [ ] **Step 1: Write the failing tests**

In `projects.staffing.service.spec.ts`, mock `DatabaseService` and `ProjectAccessService` the way `projects.members.service.spec.ts` does (`OWNER` / `staff` from `project-access.test-support`).

```ts
it('asks projectFilter and only loads those projects', async () => {
    access.projectFilter.mockResolvedValue({ visibility: 'PUBLIC' });
    await service.get(staff('u2'), {});
    expect(db.project.findMany).toHaveBeenCalledWith(expect.objectContaining({
        where: expect.objectContaining({ status: { in: ['ACTIVE', 'ON_HOLD'] } }),
    }));
});

it('does not return a private project the filter excluded', async () => {
    db.project.findMany.mockResolvedValue([{ id: 'public-1', code: 'P1', name: 'Shop', short_name: null, status: 'ACTIVE', manager_id: null }]);
    const out = await service.get(staff('u2'), {});
    expect(out.projects.map((p) => p.id)).toEqual(['public-1']);
});

it('drops teammates and unassigned when the viewer is OWN', async () => {
    // seed two members + unassigned hours; viewer.recordScope = OWN
    const out = await service.get(narrowStaff, {});
    expect(out.people.map((p) => p.key)).toEqual(['user:user-staff']);
    expect(out.summary.unassignedRemainingHours).toBe(0);
});

it('includes a manager who has no member row', async () => {
    db.project.findMany.mockResolvedValue([{ id: 'p1', manager_id: 'boss', /* … */ }]);
    db.projectMember.findMany.mockResolvedValue([]);
    const out = await service.get(OWNER, {});
    expect(out.people.some((p) => p.key === 'user:boss')).toBe(true);
});
```

Controller metadata test (add to an existing controller spec if one covers declaration order; otherwise a small `projects.controller.staffing.spec.ts`):

```ts
it('declares GET staffing as VIEW_PROJECTS before :id', () => {
    const paths = Reflect.getMetadata('path', ProjectsController);
    // assert the staffing method's path is 'staffing' and its RequireStorePermission is VIEW_PROJECTS
});
```

Follow the metadata style already used for hour-log `report` if one exists; otherwise assert via `Reflect.getMetadata` on `ProjectsController.prototype.staffing`.

- [ ] **Step 2: Run the tests and watch them fail**

Run: `cd apps/backend && npx jest --config ./jest.config.js src/projects/projects.staffing.service.spec.ts --runInBand --no-coverage`

Expected: FAIL, service not found.

- [ ] **Step 3: Implement the service, DTO, route, module**

`StaffingQueryDto`: optional `status?: string` (`@IsOptional() @IsString()`).

Controller:

```ts
@Get('staffing')
@RequireStorePermission(StorePermission.VIEW_PROJECTS)
staffing(@Tenant() tenant: TenantContext, @Query() query: StaffingQueryDto) {
    return this.staffing.get(tenant, query);
}
```

Place it with `member-candidates`, above `@Get()`.

- [ ] **Step 4: Run the tests and watch them pass**

Run: `cd apps/backend && npx jest --config ./jest.config.js src/projects/projects.staffing.service.spec.ts src/projects/staffing.util.spec.ts --runInBand --no-coverage`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/projects/projects.staffing.service.ts apps/backend/src/projects/projects.staffing.service.spec.ts apps/backend/src/projects/project.dto.ts apps/backend/src/projects/projects.controller.ts apps/backend/src/projects/projects.module.ts
git commit -m "feat(projects): GET /projects/staffing matrix payload"
```

---

### Task 3: Nav, routes, copy, heat

**Files:**
- Modify: `packages/shared-types/navigation.ts` (registry entry, both default layouts, a one-line sync comment next to the stories/epics notes)
- Modify: `apps/frontend/src/lib/routes.ts` (`staffing: '/projects/staffing'`)
- Modify: `apps/frontend/src/lib/api.ts` (`getProjectStaffing`)
- Modify: `apps/frontend/src/lib/voice-nav-routes.ts` and `voice-nav.test.ts`
- Create: `apps/frontend/src/lib/staffing-heat.ts` and `staffing-heat.test.ts`
- Modify: all nine `core.ts` (`sidebar.items.projectsStaffing: 'Staffing'` in en; translate the others)
- Modify: all nine `projects.ts` (`staffing` block from the spec)

**Interfaces:**
- Consumes: nothing from Task 2 at runtime yet; the client names the path.
- Produces: `routes.projects.staffing`, `api.getProjectStaffing(params?: { status?: string })`, `staffingHeatClass(hours: number, maxHours: number): string`, nav id `projects.staffing`.

Heat classes, written out as literals:

```
bg-blue-50 text-gray-700
bg-blue-100 text-gray-800
bg-blue-200 text-gray-900
bg-blue-400 text-white
bg-blue-600 text-white
```

Buckets: `hours <= 0` → first; else index `min(4, floor((hours / maxHours) * 5))`, and `maxHours <= 0` → first.

- [ ] **Step 1: Write the failing tests**

```ts
// staffing-heat.test.ts
it('returns the empty tint when there is no remaining or no max', () => {
    expect(staffingHeatClass(0, 10)).toBe('bg-blue-50 text-gray-700');
    expect(staffingHeatClass(4, 0)).toBe('bg-blue-50 text-gray-700');
});
it('uses the darkest blue at the max cell', () => {
    expect(staffingHeatClass(10, 10)).toBe('bg-blue-600 text-white');
});

// voice-nav.test.ts
it('opens staffing from staffing / who is on which project / স্টাফিং', () => {
    expect(matchVoiceNav('staffing')?.route.path).toBe('/projects/staffing');
    expect(matchVoiceNav('who is on which project')?.route.path).toBe('/projects/staffing');
    expect(matchVoiceNav('স্টাফিং')?.route.path).toBe('/projects/staffing');
});
```

A navigation test already asserts registry ids resolve; adding the node is enough if `NAV_REGISTRY` is enumerated. If a test lists every `projects.*` child, update it.

- [ ] **Step 2: Run the tests and watch them fail**

Run: `cd apps/frontend && npx jest --testPathPatterns='staffing-heat|voice-nav' --no-coverage`

Expected: FAIL on missing module / missing alias.

- [ ] **Step 3: Implement nav, client, copy, heat**

Layout sort (both defaults): list 0, staffing 1, boards 2, tasks 3, epics 4, stories 5, sprints 6, hour-logs 7, hour-log-report 8, setup 9.

`api.getProjectStaffing` builds `URLSearchParams` the way `getProjectTimeReport` does.

English `projects.staffing` keys as in the spec UI section (`title`, `subtitle`, `empty`, `loadFailed`, `person`, `remaining`, `unassigned`, `noLogin`, `assignedNotOnTeam`, `hideIdle`, `statusActive`, `statusAll`, `overloaded`, `legend`, `listUi.statsLabel`, `listUi.stats.*`). Other locales get real translations, same tree.

After copy: `cd apps/frontend && npx jest --testPathPatterns='localization/messages/catalog' --no-coverage` must pass.

Build shared-types: `npm run build --workspace packages/shared-types`.

- [ ] **Step 4: Run the tests and watch them pass**

Run: `cd apps/frontend && npx jest --testPathPatterns='staffing-heat|voice-nav|localization/messages/catalog' --no-coverage`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/shared-types/navigation.ts apps/frontend/src/lib/routes.ts apps/frontend/src/lib/api.ts apps/frontend/src/lib/voice-nav-routes.ts apps/frontend/src/lib/voice-nav.test.ts apps/frontend/src/lib/staffing-heat.ts apps/frontend/src/lib/staffing-heat.test.ts apps/frontend/src/lib/localization/messages
git commit -m "feat(projects): staffing nav, copy, and heat scale"
```

---

### Task 4: Page, matrix, load chart

**Files:**
- Create: `apps/frontend/src/components/projects/StaffingMatrix.tsx`
- Create: `apps/frontend/src/components/projects/StaffingLoadChart.tsx`
- Create: `apps/frontend/src/app/(app)/projects/staffing/page.tsx`
- Create: `apps/frontend/src/app/(app)/projects/staffing/page.test.tsx`

**Interfaces:**
- Consumes: `api.getProjectStaffing`, `routes.projects.staffing`, `staffingHeatClass`, `t.projects.staffing`.
- Produces: the `/projects/staffing` screen.

Page state: `status: 'active' | 'all'` (maps to omitted query vs `status=ALL`), `hideIdle: boolean` (client filter on `totals.remainingHours === 0 && key !== 'unassigned'`).

`useIsMdUp()` decides whether `StaffingMatrix` mounts. Load chart always mounts.

Bar segment classes, written out: `bg-blue-600`, `bg-blue-500`, `bg-blue-400`, `bg-sky-600`, `bg-slate-500`. Cycle by project index.

Cell `href` uses `routes.projects.tasks` plus query `projectId` and `assignee` (`user:…` / `employee:…` / `unassigned`).

- [ ] **Step 1: Write the failing tests**

In `page.test.tsx`, mock `api.getProjectStaffing`, `useIsMdUp` (default true), `useI18n`.

```ts
const payload = { /* rina 12h on p1, unassigned 8h, summary as spec */ };

it('requests ACTIVE+ON_HOLD by sending no status', async () => {
    render(<StaffingPage />);
    await waitFor(() => expect(api.getProjectStaffing).toHaveBeenCalled());
    expect(api.getProjectStaffing.mock.calls[0][0]?.status).toBeUndefined();
});

it('shows the summary strip and a heated cell that links to that person on that project', async () => {
    render(<StaffingPage />);
    const strip = await screen.findByRole('region', { name: /Staffing summary/i });
    expect(strip).toHaveTextContent('12');
    const cell = await screen.findByRole('link', { name: /12/ });
    expect(cell).toHaveAttribute('href', expect.stringMatching(/projectId=p1/));
    expect(cell).toHaveAttribute('href', expect.stringMatching(/assignee=user:rina/));
    expect(cell.className).toMatch(/bg-blue-600/);
});

it('hides idle people when asked, and keeps Unassigned', async () => {
    // karim 0h member + rina 12h + unassigned
    render(<StaffingPage />);
    fireEvent.click(await screen.findByRole('button', { name: /Hide idle/i }));
    expect(screen.queryByText('Karim')).not.toBeInTheDocument();
    expect(screen.getByText('Unassigned')).toBeInTheDocument();
});

it('on a phone unmounts the matrix and expands a person to their projects', async () => {
    jest.requireMock('@/hooks/useMediaQuery').useIsMdUp.mockReturnValue(false);
    render(<StaffingPage />);
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    fireEvent.click(await screen.findByRole('button', { name: /Rina/i }));
    expect(await screen.findByText(/Member|Manager/)).toBeInTheDocument();
});
```

- [ ] **Step 2: Run the tests and watch them fail**

Run: `cd apps/frontend && npx jest --testPathPatterns='projects/staffing/page' --no-coverage`

Expected: FAIL, page not found.

- [ ] **Step 3: Implement matrix, load chart, page**

`PageShell` + `PageHeader` (title/subtitle from `t.projects.staffing`, breadcrumbs via `modulePageBreadcrumbs`, no FAB). Toolbar: status toggle, Hide idle. `ListStats` for the five KPIs. Matrix wrapped in `overflow-x-auto`; first column `sticky start-0 bg-white z-10`. Load chart below.

On load failure: `toast.error(m.staffing.loadFailed)` and the empty copy.

- [ ] **Step 4: Run the tests and watch them pass**

Run: `cd apps/frontend && npx jest --testPathPatterns='projects/staffing/page|staffing-heat|localization/messages/catalog' --no-coverage`

Expected: PASS.

Lint the new page: `cd apps/frontend && npx next lint --quiet --file src/app/(app)/projects/staffing/page.tsx --file src/components/projects/StaffingMatrix.tsx --file src/components/projects/StaffingLoadChart.tsx`

- [ ] **Step 5: Update TODO.md and commit**

Tick the staffing implementation item, move it to `## COMPLETED` with today's date. Keep the follow-up `npx tsx prisma/sync-nav-layout.ts --nodes=projects.staffing` as an open operational note if a valid saved layout exists.

```bash
git add apps/frontend/src/app/(app)/projects/staffing apps/frontend/src/components/projects/StaffingMatrix.tsx apps/frontend/src/components/projects/StaffingLoadChart.tsx TODO.md
git commit -m "feat(projects): staffing matrix and load chart"
```

After deploy, run:

```bash
npx tsx prisma/sync-nav-layout.ts --nodes=projects.staffing
```

from `packages/database` (or the backend container), same as stories/epics.

---
