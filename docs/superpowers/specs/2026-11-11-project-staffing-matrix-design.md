# Project staffing matrix — people across projects

**Date:** 2026-11-11
**Status:** Draft pending review
**Asked as:** Project Management — show people distributed over various
projects, as a matrix and visually.

---

## Problem

A project's Team card lists who is on **that** project. There is no screen that
answers, in one look:

- who is on which projects
- who is carrying remaining work on more than one
- which projects have remaining hours sitting unassigned

Hour Log Report totals **logged** hours by person or project. It does not show
roster membership, and it does not show remaining work still held.

## Goals

- One **people × projects** matrix of the projects the viewer can see.
- A **load chart** of the same payload: remaining hours stacked by project per
  person.
- Cells and bars mean the same thing: remaining hours on open (not-DONE) tasks.
  Membership without remaining hours still shows, as a light cell.
- A KPI strip: people, projects, remaining hours, unassigned hours, people on
  3+ projects.
- Respect project visibility and `record_scope` the same way the rest of the
  module does. No new permission.

## Non-goals (v1)

- Allocation percentages / FTE / capacity calendars. The module has no
  allocation field; inventing one would be a schema change this screen does
  not need.
- Editing membership from the matrix. The project Team card stays the write
  path.
- Making `ProjectMemberRole` load-bearing (already an open TODO).
- A Gantt or timeline of people.
- A new `StorePermission`.
- A dashboard tile on `ProjectsDashboard`.

Those stay later work.

---

## Who it is for

Anyone who can open Project Management (`VIEW_PROJECTS`). The payload is
already filtered by `ProjectAccessService`:

| Scope | What they see |
|---|---|
| `ALL` (default) | Visible projects, every person on them |
| `PROJECT` | Only projects they are a member or manager of; every person on those |
| `OWN` | Their own row only, on projects they can see. No Unassigned row |

OWNER is never narrowed.

---

## Placement

| Surface | Detail |
|---|---|
| Route | `/projects/staffing` |
| Nav | Registry id `projects.staffing`, parent `projects`, after All Projects. Icon `Users`. Label key `sidebar.items.projectsStaffing`. Untagged in `NAV_PERMISSIONS` (same as every other Projects read except Setup). |
| Default layouts | `layoutNode('projects.staffing', 'projects', 1)` and bump boards…setup one slot, in **both** `DEFAULT_TENANT_NAV_LAYOUT` and the platform-admin projects block. Saved layouts pick it up with `npx tsx prisma/sync-nav-layout.ts --nodes=projects.staffing`. |
| Voice | Target `staffing` → `/projects/staffing`. Aliases: staffing, who is on which project, project team, স্টাফিং. |

No new plan gate. The `projects` platform feature already hides the module.

---

## Architecture

No new tables. One read endpoint, derived from `ProjectMember`,
`Project.manager_id`, and open-task remaining hours.

```
GET /projects/staffing?status=ACTIVE,ON_HOLD
        │
        ▼
ProjectsStaffingService
        │
        ├── projectFilter(viewer)          visibility + PROJECT scope
        ├── project.findMany               status, not deleted
        ├── projectMember.findMany         those projects
        ├── open status ids                category !== DONE
        └── projectTask.groupBy            remaining_hours + count
                                           by project × assignee
        │
        ▼
mergeStaffing(...)                         pure; collapses linked employee→user
```

`GET /projects/staffing` is declared **above** `@Get(':id')` on
`ProjectsController`, same as `member-candidates`. Gate:
`@RequireStorePermission(VIEW_PROJECTS)`.

Default `status` is `ACTIVE,ON_HOLD`. Empty / omitted uses that default.
`status=ALL` (or every `ProjectStatus` code) includes draft / completed /
cancelled. Invalid codes are dropped, matching `ProjectsService.list`.

### Person identity

Same key space as member-candidates and the Tasks assignee filter:

- `user:<id>` — a workspace login
- `employee:<id>` — an employee with no login
- `unassigned` — a synthetic row, remaining hours on open tasks with neither
  assignee

An employee row whose `user_id` is a workspace user **collapses onto that
user**, the same de-dupe `listMemberCandidates` already does. Remaining hours
assigned to either column land on the same person.

A project's `manager_id` appears even when there is no `ProjectMember` row
(the manager is in the visibility predicate; they are a staffing fact). Their
cell role is `MANAGER`.

A person with assigned open tasks who is not on the team still appears. The
cell sets `assignedNotOnTeam: true` so the gap is visible.

### Cell

```ts
interface StaffingCell {
  role: 'MANAGER' | 'MEMBER' | 'VIEWER' | null;
  isManager: boolean;
  remainingHours: number;
  openTasks: number;
  assignedNotOnTeam: boolean;
}
```

`role` is the `ProjectMember` role when there is a row. `isManager` is true
when `project.manager_id` is this user. A manager with no member row still
has `role: 'MANAGER'`.

Hours are the sum of `remaining_hours` on non-deleted tasks whose status
category is not `DONE`. Null remaining counts as 0.

### Payload

```ts
interface StaffingResponse {
  projects: Array<{
    id: string;
    code: string;
    shortName: string | null;
    name: string;
    status: string;
  }>;
  people: Array<{
    key: string;                 // user:… | employee:… | unassigned
    kind: 'user' | 'employee' | 'unassigned';
    id: string | null;
    name: string;
    email: string | null;
    noLogin: boolean;
    cells: Record<string, StaffingCell>;  // keyed by project id, sparse
    totals: { projectCount: number; remainingHours: number; openTasks: number };
  }>;
  summary: {
    people: number;              // excluding unassigned
    projects: number;
    remainingHours: number;      // assigned only
    unassignedRemainingHours: number;
    unassignedOpenTasks: number;
    overloaded: number;          // people with projectCount >= 3
  };
}
```

People sort by name (unassigned last). Projects sort by `code`.
`OVERLOAD_THRESHOLD = 3` is a named constant in `staffing.util.ts`.

---

## UI

One page, `PageShell` + `PageHeader`. Filters in the header/toolbar: status
(Active & on hold / All) and **Hide idle** (people whose remaining hours
across the matrix are 0). No `DataTable` — a matrix is not a list.

### KPI strip

`ListStats`, same pattern as Hour Log Report. Five figures from `summary`.

### Matrix (md and up)

Sticky first column (person name + idle/no-login hint). Sticky header row
(project `shortName` or `code`, title = full name). Horizontal scroll lives
**inside** the matrix, not on the page body.

| Person | remaining | ERP | Fitout | Web |
|---|---|---|---|---|
| Rina | 18 | 12h · Member | 6h · Manager | |
| Karim | 20 | 20h · Member | | |
| Unassigned | 8 | 8h | | |

Empty cell: no fill. Member with 0 remaining: `bg-blue-50`. Heat of remaining
hours is five written-out Tailwind pairs against the **max cell** in the
current matrix (not against a guessed capacity):

```
bg-blue-50 text-gray-700
bg-blue-100 text-gray-800
bg-blue-200 text-gray-900
bg-blue-400 text-white
bg-blue-600 text-white
```

No arbitrary hex. No rainbow. `staffingHeatClass(hours, maxHours)` is pure and
tested. A cell with `assignedNotOnTeam` keeps the heat and adds a 1px
`border-amber-500` so the gap is visible without a second accent on the fill.

Click:

- person name → `/projects/tasks?assignee=user:…` (or `employee:…` / `unassigned`)
- project header → `/projects/<id>`
- cell → `/projects/tasks?projectId=<id>&assignee=…`

### Load chart (every viewport)

One horizontal stacked bar per person. Segment width is that cell's remaining
hours against the row total (or against the max row if the row is empty, in
which case the bar is a 2px idle tick). Segment colour cycles the same blue
family, written out: `bg-blue-600`, `bg-blue-500`, `bg-blue-400`, `bg-sky-600`,
`bg-slate-500`. A text legend of project short names sits above the bars.

A second, smaller set of bars: people-count per project (coverage). Same
`bg-blue-600` fill, one series, like Hour Log Report's share bar.

### Phone (< md)

The matrix is not shown. Person rows are the load bars; tapping a row expands
the project list (name, role, remaining, link to tasks). Unassigned is a row
like any other. No horizontal body scroll at 360px.

### Empty / error

No visible projects: the page's empty copy. Load failure: toaster via the
global store, plus the empty copy.

---

## Files

| File | Responsibility |
|---|---|
| `apps/backend/src/projects/staffing.util.ts` | Pure merge, person keys, status parse, overload constant |
| `apps/backend/src/projects/staffing.util.spec.ts` | Merge / collapse / scope-shaped fixtures |
| `apps/backend/src/projects/projects.staffing.service.ts` | Load + call merge; apply OWN filter |
| `apps/backend/src/projects/projects.staffing.service.spec.ts` | Visibility, OWN, PROJECT, default status |
| `apps/backend/src/projects/projects.controller.ts` | `GET staffing` above `:id` |
| `apps/backend/src/projects/project.dto.ts` | `StaffingQueryDto` (`status?: string`) |
| `apps/backend/src/projects/projects.module.ts` | Register the service |
| `packages/shared-types/navigation.ts` | Registry, both default layouts, sync comment |
| `apps/frontend/src/lib/routes.ts` | `projects.staffing` |
| `apps/frontend/src/lib/nav-icons.ts` | `Users` already mapped |
| `apps/frontend/src/lib/api.ts` | `getProjectStaffing` |
| `apps/frontend/src/lib/voice-nav-routes.ts` | `staffing` target |
| `apps/frontend/src/lib/staffing-heat.ts` | Heat class helper |
| `apps/frontend/src/components/projects/StaffingMatrix.tsx` | Table |
| `apps/frontend/src/components/projects/StaffingLoadChart.tsx` | Stacked bars + coverage |
| `apps/frontend/src/app/(app)/projects/staffing/page.tsx` | Page |
| `apps/frontend/src/lib/localization/messages/{en,bn,ar,de,es,fr,hi,ms,ur}/core.ts` | `sidebar.items.projectsStaffing` |
| `apps/frontend/src/lib/localization/messages/{en,bn,ar,de,es,fr,hi,ms,ur}/projects.ts` | `staffing` block |

---

## Testing

Backend (each watched failing first):

- Merge: member + manager-without-row + assigned-not-on-team + unassigned.
- Linked employee collapses onto the user; hours on either column add.
- OWN-shaped input (service): teammates and unassigned are absent.
- PROJECT-shaped input: a public project they are not on is absent.
- Default status drops COMPLETED; `status=ALL` keeps it.
- Controller metadata: `GET /projects/staffing` is `VIEW_PROJECTS`, declared
  before `:id`.

Frontend:

- Heat: 0 / mid / max / empty maxHours.
- Page loads the default status query.
- KPI strip shows summary figures.
- A cell links to tasks with both `projectId` and `assignee`.
- At a mocked phone width, the matrix table is absent and a person row
  expands to its projects.
- Catalog parity for the new keys.

---

## Key decisions

1. **Remaining hours, not logged hours, not a new allocation field.** Logged
   hours are history (Hour Log Report already has them). Allocation % does not
   exist. Remaining hours on open tasks is the load the shop is carrying now.
2. **Membership still paints a cell when remaining is 0.** Otherwise the
   matrix cannot show "on the team, idle."
3. **No schema, no new permission.** Derived read. `VIEW_PROJECTS` plus the
   existing access service.
4. **Both presentations on one page, one payload.** Desktop shows matrix then
   load chart. Phone shows load chart / person cards only.
5. **Unassigned is a row, not a footnote.** That is the staffing gap.
6. **Overload is 3+ projects.** Named constant, not a tenant setting in v1.
7. **Heat is discrete Tailwind blues against the max cell.** One accent
   family, no hex, no capacity guess.

## Open questions

None that block the plan. Calls above are the author's, made after the
conversation skipped the question pass.

---

## PR Plan

### PR 1 — Staffing API

- Files: `staffing.util.ts` + spec, `projects.staffing.service.ts` + spec,
  `StaffingQueryDto`, controller route, module provider.
- Depends on: nothing.
- A `VIEW_PROJECTS` client can GET the matrix JSON. No UI.

### PR 2 — Nav, copy, page

- Files: navigation (both layouts), routes, api client, voice, locales,
  heat helper, `StaffingMatrix`, `StaffingLoadChart`, staffing page + tests,
  TODO.md.
- Depends on: PR 1.
- The sidebar link opens `/projects/staffing` and renders matrix + load from
  the same payload.

Ship as one PR if the branch is short; the split is the review boundary, not
a requirement.
