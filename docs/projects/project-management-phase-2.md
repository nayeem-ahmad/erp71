# Project Management — Phase 2 scope

Seven changes requested after Phase 1 reached production on 2026-08-02. Four of
them were decided by the user up front; those decisions are recorded in
"Decisions taken" below and are not re-opened here.

---

## The fact that shapes the sequencing

Production currently holds **3 projects, 1 task, 1 sprint, 0 members, 0
snapshots**. The invasive schema change in this phase — making sprints
tenant-level — costs essentially nothing to migrate *today* and gets steadily
more expensive with every sprint and snapshot a tenant accumulates.

So the ordering below is not "easiest first". It is **schema first, while the
schema is free to change**, then the UI work that can land in any order.

Second constraint, which has bitten this repo three times (`409234e`, the
account-code rollout, the projects permission gap): **production runs
`prisma db push` on boot and applies no migrations.** Nothing in
`prisma/migrations/` reaches production. Any data movement must live in a script
called from the container CMD chain in `apps/backend/Dockerfile`.

---

## Decisions taken

| # | Decision | Consequence |
|---|---|---|
| 1 | **Sprints are tenant-level; one ACTIVE at a time** | `Sprint.project_id` is dropped. `assertNoOtherActive` re-scopes from project to tenant. |
| 2 | **The standalone Backlog page is deleted** | Sprint planning moves to the new Sprints section; the project's task list becomes the single per-project list. |
| 3 | **Tasks opens on "assigned to me"** | The current My Tasks behaviour survives as the default filter, not as a separate page. |
| 4 | **Team may include employees with no login** | `ProjectMember` gains a nullable `employee_id` beside a now-nullable `user_id`. See the assignability question in "Open question" below. |

---

## Phase 2A — Schema and the migration path

Do this first and alone. It is the only part with a data-loss surface.

### `Sprint` — drop `project_id`

```prisma
model Sprint {
  id         String       @id @default(uuid())
  tenant_id  String
  // project_id  REMOVED — a sprint is a tenant-wide time-box
  name       String
  ...
  @@index([tenant_id, status])
}
```

Four call sites enforce the old invariant and must change together:

- `project-tasks.service.ts#assertSprint` — delete the
  `sprint.project_id !== projectId` check and the "That sprint belongs to a
  different project" error. This *is* the feature.
- `sprints.service.ts#assertNoOtherActive(tenantId, projectId, exceptId)` —
  becomes `(tenantId, exceptId)`. One ACTIVE sprint per tenant.
- `sprints.service.ts#list(tenantId, projectId)` — becomes `list(tenantId)`.
  Callers that want "sprints relevant to this project" derive it from the tasks
  in them, not from a column.
- The `Project → Sprint` cascade disappears. **Deleting a project must no longer
  delete sprints**; it must instead null out `sprint_id` on that project's tasks,
  the same way `removeMilestone` already detaches tasks rather than cascading.

### `ProjectMember` — accept an employee

Mirror the pattern `ProjectTimeEntry` already uses, where `user_id` and
`employee_id` sit side by side (its `employee_id` was added in Phase 1 and
documented as "unused in Phase 1 — the hook Phase 2 needs"). This is that hook.

```prisma
model ProjectMember {
  user_id     String?   // was required
  employee_id String?   // new
  ...
  @@unique([project_id, user_id])
  @@unique([project_id, employee_id])
}
```

Exactly one of the two must be set. Prisma cannot express that; enforce it in the
service and state the rule in a schema comment, the same way the single-default
rule on `PrintTemplate` is enforced in a transaction rather than by a constraint.

### Migration path

`db push` handles both changes without a backfill **only because production has
one sprint and zero members**. Verify that assumption at deploy time rather than
trusting this document:

```sql
select count(*) from sprints;          -- expect 1
select count(*) from project_members;  -- expect 0
```

If either has grown by the time this ships, add
`prisma/backfill-tenant-sprints.ts` to the CMD chain **before** dropping the
column, and reconcile in two steps across two deploys (add nullable → backfill →
drop), because `db push --accept-data-loss` will silently drop a populated
column.

Rehearse on a throwaway Postgres built from the *current* schema with rows in
both tables, exactly as the account-code and permission work did. Do not reason
about it.

---

## Phase 2B — Navigation and naming

Cheap, self-contained, and worth doing early because it changes URLs the later
work links to.

| Item | Change |
|---|---|
| 1 | `sidebar.modules.projects`: **Projects → Project Management** (en/bn/ms) |
| 3 | `projects.my-tasks` → `projects.tasks`, label **My Tasks → Tasks**, href `/projects/my-tasks` → `/projects/tasks` |
| 6 | New node `projects.sprints`, label **Sprints**, href `/projects/sprints` |

Three things that are easy to miss:

1. **`NAV_REGISTRY` additions do not reach tenants on a saved sidebar layout.**
   `resolveTenantSidebarLayout` returns a saved layout verbatim. Run
   `npx tsx prisma/sync-nav-layout.ts --nodes=projects.sprints,projects.tasks`
   after deploy, or the new entries are invisible to anyone who has customised
   their sidebar. This is documented at the top of that script and has already
   caught this repo once.
2. **Keep a redirect stub at `/projects/my-tasks`** pointing at `/projects/tasks`,
   the way `/sales/crm/tasks` was kept when CRM tasks were renamed. People
   bookmark these.
3. `page-breadcrumbs.ts` already has the `projects` module key (added
   2026-08-02); the new pages just need to use it.

---

## Phase 2C — Projects list: actions and delete (item 2)

Backend is **already done** — `DELETE /projects/:id` soft-deletes via
`deleted_at`, and `list` already filters on it. This is frontend only.

- Add an `id: 'actions'` column following the `inventory/products` convention:
  right-aligned icon buttons, `Pencil` → edit, `Trash2` → delete.
- Delete goes through a `ModalShell` confirm, never `window.confirm`.
- The confirm must say what survives: a soft-deleted project keeps its tasks and
  time entries in the database. If that is not the intent, say so now — it
  changes `remove()` from a flag to a cascade and that is a different decision.
- Reload through the existing `useServerList` `reload()`; do not hand-splice the
  row out of local state.

---

## Phase 2D — Project edit (item 4)

Backend is **already done** — `PATCH /projects/:id` accepts every field.

- Reuse the `/projects/new` form. Extract it to
  `components/projects/ProjectForm.tsx` taking `mode: 'create' | 'edit'` rather
  than copying ~150 lines; the print-template work took the same decision when
  the same form was needed twice.
- Entry points: the pencil in the list's actions column, and an **Edit** button
  in the project page header beside Board.
- `update()` already refuses nothing that matters, but note it does **not**
  re-code the project — `code` is immutable, correctly, since it is printed on
  things.

---

## Phase 2E — Tasks page (item 3)

Replace `my-tasks/page.tsx` with a real list at `/projects/tasks`.

- `DataTable` + `useServerList`, not the current hand-rolled `<ul>` capped at
  `limit: 200`. The endpoint is already paginated and, since the 2026-08-02 fix,
  `getProjectTasks` returns a proper `{ items, total }` envelope.
- Columns: Task, Project, Status, Priority, Assignee, Estimate, Remaining, Due.
  Project must be a link — this is the one list where a task's project is not
  implied by context.
- Filters: **Assignee (defaults to me)**, Project, Status, plus search. The
  assignee default is what preserves today's My Tasks behaviour.
- `ListTasksDto` needs two additions: `statusId` and a `statusCategory`
  (`TODO`/`IN_PROGRESS`/`DONE`) so "open tasks" is one filter rather than the
  caller enumerating column ids. `TASK_SORTABLE` needs `due_date` and `priority`
  if those columns are to be sortable.

---

## Phase 2F — Project task list columns (item 5)

Delete `projects/[id]/backlog/page.tsx` and its route. Its sprint-planning job
moves to Phase 2G.

The project page's task list is currently title + status only. Give it the same
`DataTable` treatment as Phase 2E, minus the Project column (implied) and with
**Sprint** added — that is what makes it "already the backlog": a task with no
sprint *is* backlog, and now you can see which.

Suggested columns: Task, Status, Sprint, Assignee, Priority, Estimate,
Remaining, Due. `hideOnMobile` on Estimate/Remaining/Due per the wide-table rule.

Removing the backlog route means removing its links: the board's Backlog button
and the Backlog button added to the project header on 2026-08-02.

---

## Phase 2G — Sprints section (item 6)

The substantial new surface.

**`/projects/sprints`** — list of every sprint in the tenant. Columns: Name,
Status, Dates, Projects covered (derived from its tasks — there is no column for
it any more), Tasks, Remaining hours. Actions: start / complete / edit / delete.
Start must surface the one-ACTIVE-per-tenant rule as a clear error, not a 500.

**`/projects/sprints/[id]`** — the planning surface that replaces the backlog:

- Two panes, as the backlog has today: unsprinted tasks on the left, sprint
  contents on the right, multi-select to move between them.
- The left pane now needs a **project filter**, because it draws from every
  project. Without it this screen is unusable in a workspace with more than a
  couple of projects.
- Burndown moves here. It is already per-sprint (`SprintSnapshot` keys on
  `sprint_id` alone), so it needs no logic change — but relabel it: it is now a
  whole-company chart, and a chart captioned with a project name would lie.

**Board interaction.** `board(tenantId, projectId, sprintId)` filters by project
*and* sprint, so a project's scrum board keeps showing that project's slice of a
shared sprint. That stays correct and needs no change. What changes is the
board's sprint picker: "the active sprint" is now tenant-wide, so the board
should name it rather than implying it belongs to the project.

**`projects.scheduler`** writes a nightly snapshot per active sprint. With one
active sprint per tenant this gets *simpler*, not harder — but check the job's
query still scopes by tenant now that it cannot scope by project.

---

## Phase 2H — Project team (item 7)

Backend is **partly done**: `POST /projects/:id/members` and
`DELETE /projects/:id/members/:userId` exist with a `MANAGER/MEMBER/VIEWER` role.
Both need widening for employees, and the delete route needs to key on the member
row rather than `userId`.

- Team card on the project page: list members with role, add via a picker,
  remove with confirm.
- Picker offers **users and employees in one list**, sourced from
  `/team/members` and the HR employee list, de-duplicated on `Employee.user_id`
  so a linked person appears once, not twice.
- An employee with no login is addable and is visibly marked as such.

### Open question — and the one thing in this plan I would not decide for you

`ProjectTask.assignee_id` points at `User`. An employee with no login therefore
**cannot be assigned a task**, cannot log time against one (`ProjectTimeEntry`
has an `employee_id`, but nothing writes it yet), and cannot open the project.

That leaves two coherent endings, and they are meaningfully different products:

- **Roster only.** Employee-only members are recorded for staffing and reporting;
  assignment stays user-based, and the UI says plainly that an employee needs an
  invite before they can hold work. Small, honest, ships with this phase.
- **Assignable.** Add `ProjectTask.assignee_employee_id` mirroring the same
  nullable pair, and start writing `ProjectTimeEntry.employee_id`. This reaches
  the board's assignee grouping, the Tasks page filter, `TaskDetailPanel`,
  `RemainingHoursService`'s log rows, and every "who is this for" query. It is
  the more useful product and roughly doubles Phase 2H.

My recommendation is **Assignable**, because a team you cannot give work to is
half a feature and you already chose employees-without-logins deliberately — but
it is a real cost and worth an explicit yes.

---

## Cross-cutting work, easy to under-estimate

- **i18n.** Every new label lands in en, bn and ms. The catalog parity test is
  enforced; a missed key fails the build, it does not degrade.
- **Permissions.** `MANAGE_SPRINTS` already exists and is already granted (the
  2026-08-02 backfill). No new permission is needed unless the team picker should
  be narrower than `MANAGE_PROJECTS`.
- **The empty-list trap.** `useServerList` still swallows a failed load into an
  empty table and no page reads its `error`. Two of this module's bugs presented
  as "it's just empty". Every new list in this phase inherits that. The HIGH
  PRIORITY item in `TODO.md` should land before or alongside Phase 2E/2F, not
  after.
- **Tests.** Backend: the re-scoped active-sprint rule, cross-project task
  assignment now succeeding, project delete no longer taking sprints with it,
  member add for both sources. Frontend: the Tasks default filter, the actions
  column, the delete confirm. Follow the local discipline of checking a new test
  **fails** against the old behaviour rather than only passing against the new.

---

## Suggested sequencing

| Order | Phase | Why here |
|---|---|---|
| 1 | 2A schema | Free to change now, expensive later |
| 2 | 2B nav/naming | Fixes the URLs everything else links to |
| 3 | 2C + 2D | Pure frontend on finished endpoints; ships value immediately |
| 4 | 2E + 2F | Share a DataTable/filter shape; do together |
| 5 | 2G sprints | Depends on 2A; largest new surface |
| 6 | 2H team | Independent; gated on the assignability answer |

2C and 2D could ship as a single small PR on the current schema **today** if you
want something visible before the larger work lands.
