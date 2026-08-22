# Project Management — public and private projects

**Written:** 2026-08-22
**Predecessors:** `project-management-phase-1.md`, `project-management-phase-2.md`, `project-management-phase-3.md`

The ask: *"A Project can be Public (accessible by all tenant users) or Private
(accessible only if added as project member). How to implement this?"*

Phase 1 already said `ProjectMember` "drives *my projects* and per-project
visibility". It never did — until now every project in a tenant was readable by
anyone holding `VIEW_PROJECTS`, and `ProjectMember` was a staffing note.

---

## The rule

| Visibility | Who can reach the project and everything under it |
|---|---|
| `PUBLIC` (default) | every user in the tenant who holds `VIEW_PROJECTS` |
| `PRIVATE` | its `ProjectMember` rows, its `manager_id`, the workspace `OWNER`, and holders of the new `VIEW_ALL_PROJECTS` permission |

Three things follow from that table and are worth stating outright.

**The manager is in the rule, not just in the member list.** A member row can be
deleted; `manager_id` is a column on the project itself. Without it a project
could be made private and then, one careless removal later, be invisible to
everybody except the owner — with no screen able to explain why.

**`created_by` is deliberately *not* in the rule.** Whoever set a project up
should lose sight of it when they are taken off it, otherwise "remove them from
the project" quietly does nothing. Creators are instead given a real member row
when the project starts private, which can then be removed like anyone else's.

**Employees without a login are unaffected.** `ProjectMember` holds *either* a
`user_id` or an `employee_id` (Phase 2). An employee with no account cannot sign
in, so there is nothing to gate; only the `user_id` side takes part.

---

## Why this is not a permission

`VIEW_PROJECTS` answers *"may this user open the Projects module at all"*.
It cannot answer *"may they see **this** project"*, because that depends on the
project, not on the user. Store permissions are granted per user per store, so
expressing "Karim can see PRJ-0007 but not PRJ-0011" through them would mean a
grant row per project per person — a permission table that grows with the
project list.

So visibility is a **second filter, layered on top of the permission guard**:
`StorePermissionGuard` still decides who reaches the endpoint, and
`ProjectAccessService` decides which rows they see once inside.

`VIEW_ALL_PROJECTS` is the escape hatch for the cases the strict rule cannot
serve — an auditor, a finance lead reconciling hours, an operations manager who
needs the whole board. It is granted to **nobody** by default: `OWNER` bypasses
every permission check already, so out of the box the strict reading of
"private" holds exactly as asked. It is deliberately left out of
`ROLE_DEFAULT_PERMISSIONS[MANAGER]` and out of the `projects` group in
`sync-role-permissions.ts`, because a backfill that hands it to every existing
manager would quietly undo the feature on the day it ships.

---

## Where it is enforced

Visibility gates the project **and everything hanging off it**. A private
project whose tasks still appeared on the cross-project Tasks page, whose hours
still showed in the hour-log report, or whose cards still rendered on a shared
board would not be private in any sense a user would recognise.

`ProjectAccessService` (`apps/backend/src/projects/project-access.service.ts`)
produces two things, and everything else consumes one of them:

- `projectFilter(viewer)` — a `where` fragment for the `projects` table
- `relatedFilter(viewer)` — the same fragment nested under `project`, for any
  row that points at one (tasks, time entries, milestones, board cards)

Both return `{}` for a viewer who sees everything, so the owner/admin path adds
no clause at all.

| Surface | How |
|---|---|
| Project list / detail | filter merged into the `where` |
| Cross-project Tasks page, task detail | `relatedFilter` in `list`, and in `assertTask` — the chokepoint every single-task route already went through |
| Checklist items, attachments (addressed by their own id) | resolved through the task, two hops |
| Comments, activity feed, watchers | the task check, in the service or the controller |
| Hour logs: list, totals strip, report, people filter | one shared `buildWhere`, so they cannot disagree |
| Boards | on the **cards**, not the board: a shared board stays open to everyone, and cards drawn from a private project simply are not on it for outsiders. The card counts in the board list are filtered the same way — a count is a disclosure too |
| Sprints | assign/remove filter the tasks they touch; the `projects` span on a sprint is filtered |
| Per-project board columns | `assertProject` in the controller |

### What is deliberately *not* filtered

**Sprint hour totals and burndown.** A sprint is a tenant-level commitment and
its burndown is one shared number. A per-viewer total would mean two people
reading the same chart and disagreeing about whether the sprint is on track —
and the `SprintSnapshot` rows behind the chart are precomputed nightly, so they
cannot be re-derived per viewer anyway. What a private project must not leak is
its *identity*, so the project names attached to a sprint are filtered and the
aggregate hours are left whole.

**Editing your own comment.** `comments.update`/`remove` are already
own-comment-only, and a comment you wrote is a comment you could see when you
wrote it.

---

## NotFound, never Forbidden

Every check throws `NotFoundException`. `ForbiddenException` would confirm the
project exists, which is precisely what a private project must not do — and it
is already the answer an id from another tenant gets, so the two cases stay
indistinguishable.

The one place this is *not* a hard error is the two `updateMany` paths
(assigning tasks to a sprint, removing them). There the filter simply means an
unreachable id matches nothing, which is the same answer a made-up id gets.

---

## Schema

```prisma
enum ProjectVisibility {
  PUBLIC
  PRIVATE
}

model Project {
  visibility ProjectVisibility @default(PUBLIC)
  @@index([tenant_id, visibility, deleted_at])
}
```

`PUBLIC` by default, and the migration backfills every existing row to `PUBLIC`.
Defaulting the other way would hide every project a tenant already has, on the
morning of the deploy, with no warning.

Migration: `20260822120000_add_project_visibility`. It also adds
`VIEW_ALL_PROJECTS` to the `StorePermission` enum — that has to land before any
grant can be written, since `UserStorePermission.permission` is that enum.
Production reconciles with `prisma db push` rather than running migrations
(see `TODO.md`), so both changes arrive on deploy either way; the file is the
record.

---

## Turning a project private

Making a project private is where somebody loses access, so it is also where the
member list has to start telling the truth. On create-as-private and on the
public→private switch, `seedPrivateMembers` writes member rows for the manager
and the acting user (and, on a switch that also reassigns the manager, for the
outgoing manager — they may still be mid-handover). It never rewrites a row that
already exists: the point is that a row is there, not what it says, so someone
deliberately demoted to `VIEWER` is not silently promoted back.

The team panel on a private project says this outright, because removing someone
from it now revokes their access rather than just un-staffing them.

---

## Not done

`ProjectMemberRole` (`MANAGER | MEMBER | VIEWER`) still does not gate anything.
Membership is visibility only: a `VIEWER` who holds `MANAGE_PROJECT_TASKS` can
still edit tasks on a project they are on. Making the role load-bearing is a
separate change with its own decisions — chiefly whether a project role can
*grant* capability or only withhold it — and folding it into this one would have
changed what every existing member row means.

Nothing here has been opened in a browser; it is verified by unit tests,
typecheck and lint. The migration has not been run against a real Postgres.
