# Project Management — per-user record scope ("own records only")

**Written:** 2026-09-11
**Predecessors:** `project-visibility.md`, `project-management-phase-1.md`, `project-management-phase-2.md`

The ask: *"For some users, as a tenant admin I want to give access to a specific
module and only his own records. Example: access to a single project and own
tasks, hour logs, etc."*

Two of the three layers already existed. A role holding only
`VIEW_PROJECTS` + `MANAGE_PROJECT_TASKS` + `LOG_PROJECT_TIME` (the seeded
`project_user` template) gives someone the Projects module and nothing else, and
`visibility = PRIVATE` plus a `ProjectMember` row gives them one project
(`project-visibility.md`). The third did not: inside a project they could open,
they read — and wrote — everybody's rows. `project_user`'s own description
already promised "their tasks and their time log".

---

## The rule

`TenantRole.record_scope` is `ALL` or `OWN`. A member's effective scope is the
**widest** across the roles they hold, resolved once per request by
`TenantInterceptor` and carried on `TenantContext.recordScope`.

| Effective scope | What they read inside a project they can reach |
|---|---|
| `ALL` (default) | every task and every hour log, as before |
| `OWN` | tasks assigned to them (by login **or** employee card) or raised by them; hour logs they logged |

`OWNER` is always `ALL`: they bypass every permission check in the app, so a
restriction they could not lift would be the only one of its kind. A member with
no roles is `ALL` too — they hold no permissions either, so there is nothing for
a scope to narrow, and treating "not set up yet" as the strictest setting would
make it the silent default.

**`created_by` is in the rule for tasks**, unlike in project visibility. A task
nobody has assigned yet would otherwise vanish the moment it was saved, and the
one row a contributor must never lose sight of is the one they just wrote.

**Both assignee columns count.** A task goes to a `User` *or* to an `Employee`
with no login (Phase 2). Someone who has both can hold work under either, so
"my tasks" asks about both — the employee id is resolved from `Employee.user_id`
on the narrow path only.

---

## Why this is not a `StorePermission`

Because a member's effective access is the **union** of the roles they hold
(`role-sync.util.ts`), and a union can add but never subtract. A restriction
shaped as a permission would survive into every other role they were given:
"also make them a Project Manager" could not widen them again.

The alternative shape — a *broadening* `VIEW_TEAM_PROJECT_RECORDS`, narrow by
absence, mirroring `VIEW_ALL_PROJECTS` — was rejected for a second reason. It
flips the default for every workspace that already exists, so it needs a
backfill onto every role holding `VIEW_PROJECTS` including hand-written ones, and
that script is exactly the trap `sync-role-permissions.ts` documents at length:
once an admin deliberately narrows a role, the next container boot re-widens it.

Storing the restriction positively has neither problem. The column defaults to
`ALL`, every existing row takes that default, no backfill runs, and nothing a
workspace already has changes on the day it ships. Narrowing is always an
explicit act on a role, and the scope is read from the role rather than
materialized into `UserStorePermission`, so it takes effect on the next request
without rewriting anybody's grants.

---

## Where it is enforced

One choke point, the same one visibility uses. `ProjectAccessService` gained
three filters beside `projectFilter`/`relatedFilter`:

| Helper | Table | Narrow clause |
|---|---|---|
| `taskFilter` | `project_tasks` | `assignee_id` = me, `created_by` = me, or `assignee_employee_id` = my employee |
| `taskRelatedFilter` | anything hanging off a task | the above, nested under `task` |
| `timeFilter` | `project_time_entries` | `user_id` = me (or `employee_id` = my employee) |

Each returns `{}` or a single `AND`, the shape `relatedFilter` already returned,
so a caller can spread it or hand it to `merge()` exactly as before. Visibility
and scope compose: narrow scope never widens what visibility allows, and
`VIEW_ALL_PROJECTS` never widens whose rows a narrow member reads — the two axes
are independent on purpose.

Every read path in the module goes through those helpers, so the surfaces follow
without a per-screen flag: the cross-project Tasks list and its assignee facet,
task detail, checklist items, comments, attachments, board cards and their
counts, the timer's task lookup, the Hour Logs list, the report's four
groupings, the person filter, and the per-project hours summary. The write paths
inherit it through the same lookups, which closes a gap that predates the
feature: `PATCH`/`DELETE /project-time/:id` were scoped by project alone, so
anybody on a shared project could edit or delete a teammate's hour log.

---

## What stays whole

**Project rollups** (`ProjectsService.progress` — task counts,
estimated/remaining/logged hours, percent complete) and **sprint totals and
burndown** are not re-derived per viewer. They are one shared number about the
project's or sprint's health, not a per-person breakdown; re-deriving them would
mean two people reading the same chart and disagreeing about whether the work is
on track. Same call `project-visibility.md` already takes for burndown, and the
rows underneath them stay scoped — a narrow member sees the project's totals
with only their own tasks listed beneath.

**Project visibility is untouched.** A narrow member still sees `PUBLIC`
projects; the scope decides whose rows are in them, not which projects exist.
Restricting somebody to one project is still done the way
`project-visibility.md` describes: make the others `PRIVATE`, or grant the
member no membership on them.

**The sprint project span** keeps the visibility-only filter: it is about a
project's identity, not about whose rows are in it, and narrowing it would make
a sprint look like it spanned only the projects the viewer holds a task on.

---

## Using it

Team → Roles → the role, then **Records this role can see** → *Own records
only*. The role list badges a narrowed role so it is visible without opening it.
For the original ask: give the person the `Project User` role as their **only**
role with the scope set to own records, mark the projects they are not on
`PRIVATE`, and add them as a `ProjectMember` on the one they are.

The client reads `record_scope` off the workspace row of `/auth/me` and uses it
to drop the assignee and person filters, which for a narrow member would each
offer one option. That is presentation only — the server filters either way.

---

## Not done

- The hour-log **report page** still offers "group by user"; for a narrow member
  it renders one row rather than being hidden.
- `GET /team/members/:userId` does not report the member's effective scope, so
  an admin reads it off the roles in the Roles tab rather than off the member.
- Templates all stay `ALL`, deliberately: setting `project_user` to `OWN` would
  make a new tenant's Project User behave differently from an existing tenant's.
- `ProjectMemberRole` (`MANAGER | MEMBER | VIEWER`) still gates nothing — the
  same family of decision, untouched here (see `project-visibility.md`).
- Verified by unit tests, typecheck and lint. Nothing here has been opened in a
  browser, and the migration has not been run against a real Postgres.
