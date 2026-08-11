# HR menu restructuring — design

**Date:** 2026-08-11
**Scope:** navigation only. No page moves, no URL changes, no redirects, no backend work.

---

## Problem

The HR module is the only large module whose sidebar is still flat. `DEFAULT_TENANT_NAV_LAYOUT`
hangs all eleven HR links directly off the `hr` module node
(`packages/shared-types/navigation.ts:409-419`), while Sales, Accounting and Inventory all group
theirs under subgroups. Eleven undifferentiated links is past the point where scanning works, and it
gets worse with every HR page added.

`NAV_REGISTRY` already defines three HR subgroups — `hr.organization`, `hr.operations`,
`hr.recruitment` — but only their *children's* ids reference them. **No layout node ever places
them**, so all three are inert: the sidebar has never rendered an HR subgroup.

Two smaller defects sit inside the same code and are fixed here rather than left for a second pass:

- **`/hr/attendance/punches` is unreachable from the sidebar.** The page exists and is linked from
  the HR hub, but it has no `NAV_REGISTRY` entry at all, so it appears in no menu. Same class of
  defect as the gross-profit reports fixed in PR #489.
- **The Schedules entry renders the wrong icon.** `hr.operations.schedules` declares
  `icon: 'CalendarDays'`, but `CalendarDays` is absent from `NAV_ICON_MAP`
  (`apps/frontend/src/lib/nav-icons.ts`), and `resolveNavIcon` falls back to `LayoutDashboard`.

## Non-goals

- **Moving HR URLs to match the new groups.** Departments stays at `/hr/employees/departments` even
  though it now appears under HR Setup. Relocating URLs means page directories, `routes.ts`,
  `voice-nav-routes.ts`, breadcrumbs and redirects for existing deep links — the same shape of work
  as the still-open Expenses phase 2 in `TODO.md`. Out of scope.
- **Building an HR Reports group.** No HR report page exists anywhere in the frontend. A group is
  created when there is something to put in it; a `soon: true` placeholder that leads nowhere is
  worse than no entry. Recorded as a follow-up.
- **Building payroll UI.** The backend has a complete `payroll` module (`PayrollRun`, `PayrollLine`,
  `SalaryComponent`, `EmployeeSalaryStructure`, `EmployeeBankAccount`) with **zero** frontend pages.
  Payroll therefore ships as a group of one. Recorded as a follow-up.

---

## Target tree

```text
HR
  Overview                    /hr                             hr.overview
  Employees                   /hr/employees                   hr.employees
  ▾ Attendance & Leave                                        hr.attendance
      Attendance Records      /hr/attendance                   hr.attendance.records
      In/Out Records          /hr/attendance/punches           hr.attendance.punches      NEW
      Leaves                  /hr/leaves                       hr.attendance.leaves
  ▾ Payroll                                                   hr.payroll
      Salary Payments         /hr/salary-payments              hr.payroll.salary-payments
  ▾ Recruitment                                               hr.recruitment             unchanged
      Job Posts               /hr/recruitment/job-posts        hr.recruitment.job-posts
      Applicants              /hr/recruitment/applicants       hr.recruitment.applicants
      Applications            /hr/recruitment/applications     hr.recruitment.applications
  ▾ HR Setup                                                  hr.setup
      Departments             /hr/employees/departments        hr.setup.departments
      Designations            /hr/employees/designations       hr.setup.designations
      Calendar & Schedules    /hr/schedules                    hr.setup.schedules
```

Eleven flat links become two links and four groups. The nesting is `module → subgroup → link`, which
is exactly what `Sidebar.tsx` and `nav-resolver.ts` already support; no rendering change is needed.

### Placement decisions

**Overview and Employees stay top-level.** Employees is the module's most-opened page. Every module
here keeps its Overview at depth one, and burying Employees would cost a click on every visit.

**Recruitment becomes the fourth group.** It was not in the original request, but it already exists in
the registry with three real pages. Leaving it flat beside three grouped siblings would read as an
oversight.

**Calendar & Schedules belongs to HR Setup, not Attendance.** The page's own header comment states
that without a schedule "'late' and 'overtime' are both uncomputable"
(`apps/frontend/src/app/(app)/hr/schedules/page.tsx:19`) — it *configures* attendance rather than
reporting it, and its Holidays tab feeds leave as well. Setup is the neutral home for something two
groups depend on.

**Leave lives inside Attendance & Leave rather than in a group of its own.** Both answer the same
question — who was at work, and why not — and they share their inputs: the Holidays half of
`/hr/schedules` is the base for both, and `AttendanceRecord` and `LeaveRequest` describe the same
days. A separate one-item Leave group would also put a submenu in front of a single page for no gain.
Leave Types and Leave Balances (`LeaveType` and `LeaveBalance` already exist as Prisma models) join
this group when they get pages; if leave ever outgrows it, splitting a three-item group is a smaller
change than the flat-to-nested restructure being done here.

**Payroll ships as a group of one.** The exception to the reasoning above: Salary Payments has no
sibling to sit beside today, but the backend payroll module is built and its UI is a known gap, so
Payroll Runs and Salary Structures have a place to land. Given the migration gap below, a second
restructure is the specific thing worth avoiding.

---

## Node ids: rename to match the group

Link ids are renamed to sit under their new parent (`hr.organization.departments` →
`hr.setup.departments`, `hr.operations.attendance` → `hr.attendance.records`, and so on) rather than
keeping the old ids and changing only `parentId`.

This is the load-bearing decision, and the reasoning runs opposite to intuition — the rename is the
*safer* option:

- `validateNavLayout` rejects a layout referencing an unknown id, and `parseNavLayoutJson` then
  returns the code default (`packages/shared-types/navigation.ts:613-623`). Renaming therefore
  invalidates any pre-existing saved layout, and every tenant lands on the new structure.
- Keeping the ids does the opposite. A saved layout stays *valid*, and `resolveTenantSidebarLayout`
  returns a saved layout verbatim — so it would show the old flat HR indefinitely. `sync-nav-layout.ts`
  cannot repair that: `addNavNodesToLayout` only *appends* a new node under a parent already present
  in the layout (`navigation.ts:492-535`). It has no reparent path. There is no migration tool for a
  regrouping, which `TODO.md` already records as an open gap.

The cost of the rename is that a saved layout's unrelated customisations are discarded wholesale.
**That cost is currently zero, verified rather than assumed:**

- The saved platform `tenant_layout` in production is already invalid — 138 nodes referencing six ids
  removed from `NAV_REGISTRY` long ago (`accounting.transactions` plus four children, `admin.tenants`).
  It has been discarded at read time on every request since at least 2026-08-05, and the last two
  releases reached tenants only because of it.
- The single `TenantNavLayout` row has `layout = null`, i.e. pinned to default. There is no
  per-tenant override to preserve.

`hr.organization` and `hr.operations` are removed from `NAV_REGISTRY`. `hr.recruitment` is unchanged.
Grepping the monorepo confirms these three ids appear nowhere outside `packages/shared-types/navigation.ts`
and its build output, so no other consumer breaks.

**This window is not permanent.** The moment someone saves a valid layout through the nav admin, this
restructure becomes unshippable by these means. That argues for landing it as one code change now.

---

## Changes

### `packages/shared-types/navigation.ts`

`NAV_REGISTRY`:

| Action | Entry |
|---|---|
| Add | `hr.attendance` — subgroup, `Clock`, `hr.hub.attendanceLeave` |
| Add | `hr.payroll` — subgroup, `Banknote`, `hr.hub.payroll` |
| Add | `hr.setup` — subgroup, `Layers`, `hr.hub.setup` (matches `sales.setup` / `inventory.setup` / `accounting.setup`) |
| Add | `hr.attendance.punches` — link, `ArrowLeftRight`, `sidebar.items.attendancePunches`, `/hr/attendance/punches` |
| Remove | `hr.organization`, `hr.operations` |
| Rename | the six links that change parent — `departments`, `designations`, `attendance`, `leaves`, `salary-payments`, `schedules`. `hr.overview`, `hr.employees`, `hr.recruitment` and its three children keep their ids |

`hr.attendance.records` carries `exact: true`. Without it the sidebar's `isActive` prefix match
highlights both it and In/Out Records whenever `/hr/attendance/punches` is open — the same trap that
`sales.reports.gross-profit` documents.

`DEFAULT_TENANT_NAV_LAYOUT`: the HR block is rewritten so the three new subgroups plus the existing
`hr.recruitment` are placed under `hr`, and each link hangs off its group, in the order shown in the
target tree.

All icons used are already in `NAV_ICON_MAP` except `CalendarDays` — see below.

### `apps/frontend/src/lib/nav-icons.ts`

Add `CalendarDays` to the import list and to `NAV_ICON_MAP`, fixing the fallback-icon defect on the
Schedules entry.

### `apps/frontend/src/app/(app)/hr/page.tsx`

`HR_HUB_SECTIONS` is regrouped into the same five sections (People, Attendance & Leave, Payroll,
Recruitment, HR Setup), and `sectionLabels` updated to match. The hub and the sidebar must tell the
same story; today the hub's grouping (`dailyOperations` / `organization` / `operations` /
`recruitment`) is a third structure agreeing with neither.

Schedules is currently missing from the hub too — it joins the HR Setup section.

### `apps/frontend/src/lib/localization/messages/{en,bn,ms}/`

`crmHr.ts`, under `hr.hub`:

| Key | English |
|---|---|
| `attendanceLeave` | Attendance & Leave |
| `payroll` | Payroll |
| `setup` | HR Setup |
| `people` | People |

`recruitment` is kept. `dailyOperations`, `organization` and `operations` are removed once the hub
stops referencing them. Add a `links.schedules` entry (title + description) for the new hub tile.

`core.ts`, under `sidebar.items`:

| Key | English |
|---|---|
| `attendanceRecords` | Attendance Records |
| `attendancePunches` | In/Out Records |

A child labelled "Attendance" inside a group labelled "Attendance" reads as a mistake, hence the new
`attendanceRecords` key rather than reusing `sidebar.items.attendance` — which is left in place
untouched. `sidebar.items.schedules` ("Calendar & Schedules"), `leaves`, `salaryPayments`,
`departments` and `designations` are reused as-is.

Bangla and Bahasa Melayu translations are authored in the same commit, matching the existing style in
those files.

### Tests

- `packages/shared-types` — `validateNavLayout(DEFAULT_TENANT_NAV_LAYOUT)` is valid; the HR module
  resolves to four subgroups in order; each subgroup's children resolve to the expected hrefs in the
  expected order; `hr.organization` and `hr.operations` are gone from the registry.
- `nav-resolver.test.ts` — the HR module resolves with nested children rather than a flat list.
- `Sidebar.test.tsx` — an HR subgroup expands, and `/hr/attendance/punches` does not also highlight
  Attendance Records (the `exact: true` guard).
- `hr/page.test.tsx` — the hub renders the five sections and the new Schedules tile.

Note: `packages/shared-types/*.test.ts` is currently run by no jest project (open item in `TODO.md`),
so shared-types assertions need a deliberate run rather than relying on CI.

---

## Deploy

No database migration. **No `sync-nav-layout` run** — for the reason in the id section, production
serves the code default, which is where the new structure lives. The script would refuse to write
anyway: merging into an already-invalid layout leaves it invalid.

This should be stated explicitly in the deploy notes rather than rediscovered a fourth time, and
paired with the open OPERATIONAL item to repair the stale platform layout — that repair is what makes
the next nav change safe, and it is also what would have made *this* one hard.

## Follow-ups this leaves open

- **HR Reports group** — create it when the first HR report page exists.
- **Payroll UI** — the backend payroll module has no frontend. Until it does, Payroll is a group of
  one.
- **No browser pass.** Verification will be unit tests, typecheck and lint only. Whether four nested
  groups make the HR module scroll awkwardly at 360px, and whether the accordion feels right in front
  of Payroll's single child, cannot be established in jsdom.
