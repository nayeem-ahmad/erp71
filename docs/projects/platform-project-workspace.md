# Project Management — the platform team's own workspace

**Written:** 2026-09-02
**Predecessors:** `project-management-phase-1.md`, `project-management-phase-2.md`,
`project-management-phase-3.md`, `project-visibility.md`

The ask: *"Give option for the platform users to use the project management
module — projects, tasks, boards, sprints, hour logs — as well."*

Platform users could not open the module at all. Not "it was switched off": the
sidebar in `active_context=platform-admin` renders the admin console and nothing
else, and every `/projects` endpoint runs `TenantInterceptor`, which refuses a
request that resolves to no tenant. A platform admin signing into the console
has no tenant. The module was unreachable by construction.

---

## The shape of the problem

Project management is tenant-scoped from the schema up. Twenty-four tables
(`Project`, `ProjectTask`, `Board`, `Sprint`, `ProjectTimeEntry`, …) carry a
`tenant_id`; every service filters on it; `ProjectAccessService` layers
visibility on top of it. There is no second scope and nowhere to put one
cheaply.

So there were two ways to go.

**Teach the tables a tenant-less scope.** Make `tenant_id` nullable, add a
`scope` discriminator, and revisit every project query in the codebase so it
means "this tenant *or* the platform". Two dozen migrations' worth of surface
area, a nullable foreign key on the hottest filter in the module, and a new way
for a missed `where` clause to leak one workspace's tasks into another's board.

**Give the platform a workspace.** One real tenant row, marked by
`platform_workspace_key`, that every platform admin belongs to as `OWNER`. The
module then works exactly as it already does, because nothing about it changes.

The second is what shipped. The marker buys one thing: the ability to keep this
row out of every place that means *customer*.

---

## Why the marker is a nullable key and not a boolean

`Tenant.platform_workspace_key` is a nullable `TEXT` with a `UNIQUE` constraint,
holding the single constant `'platform'` on one row and `NULL` everywhere else.
Every customer-facing query therefore reads `platform_workspace_key: null`, which
is less obvious than `is_platform_workspace: false` would have been. The reason
is worth stating, because the obvious version is a trap.

"At most one platform workspace" over a boolean needs a **partial** unique index
(`... WHERE is_platform_workspace = true`). Prisma's schema language cannot
express one, so it would have lived only in `migration.sql` — and **production
applies the schema with `prisma db push`, never `prisma migrate deploy`** (see
the `CMD` in `apps/backend/Dockerfile`, and the `sync:*` scripts that exist
precisely because migrations do not run there). The index would have existed in
no deployed environment, and the "the database stops the race" claim below would
have been false everywhere it mattered.

Postgres allows any number of `NULL`s under a `UNIQUE` constraint and exactly one
non-`NULL` value. That is the same guarantee, in a form `db push` reproduces from
`schema.prisma` alone.

One consequence to know about: the constraint spans *all* rows, deleted included.
A workspace someone soft-deleted by hand would still hold the key and block every
future create, so `provision` detects exactly that and raises a
`ConflictException` naming the row and saying to clear its `deleted_at`. Nothing
in the product can reach that state — the workspace is excluded from the admin
delete path — which is why it is an error message rather than a recovery path.

---

## What the marker excludes

| Excluded from | Where |
|---|---|
| Platform metrics (workspace counts, new-signup deltas) | `LIVE_TENANT` in `admin-dashboard.service.ts` |
| Every admin tenant listing, lookup, edit and delete | `ACTIVE_TENANT_FILTER` in `admin-tenants.service.ts` |
| The account chooser and the shop switcher | `tenantMembers` filter in `auth.service.ts` (`getMe` and the login response) |

The last one is the load-bearing exclusion. If the workspace appeared in
`/auth/me`'s tenant list it would sit in `/select-account` beside real shops, and
entering it would render a sidebar full of Sales, Inventory and Accounting for a
workspace that has no stores, no products and no plan.

It is also why the client cannot derive the id and has to ask for it — see below.

---

## How a request gets scoped

```
GET /platform/workspace          (JwtAuthGuard + PlatformAdminGuard)
  → provisions the workspace if this is the first ever call
  → adds every current platform admin as an OWNER member
  → { id, name, timezone }
```

The app shell calls it once per tab when the console loads, parks the id in
`platform_workspace_id` (per-tab, alongside `tenant_id`), and `resolveTenantHeader`
in `api.ts` sends it as `x-tenant-id` for every request the console makes while
there is no shop selected.

It is a separate storage key rather than `tenant_id` because the shell validates
`tenant_id` against the shops in `/auth/me` and clears it when there is no match
— and this workspace is deliberately not in that list. Stored under `tenant_id`
it would be wiped on the next `/auth/me`.

Sending it console-wide rather than only on `/projects` calls is safe: admin
endpoints are guarded by `PlatformAdminGuard` and never run `TenantInterceptor`,
so they ignore the header entirely.

**`/projects` does not render in the console until that id is in hand.** Without
the header `TenantInterceptor` falls back to auto-resolving the caller's own
memberships — so an admin who also owns a shop would be shown *that shop's*
projects inside the platform console for as long as the round trip took. The
shell holds the page back instead.

---

## Why OWNER

Every member of the platform workspace is an `OWNER`, which is deliberate rather
than lazy.

`StorePermissionGuard` and `ProjectAccessService` both treat `OWNER` as holding
every permission. That is what lets the workspace work with **no stores**: the
guard's store-context requirement and the per-store permission lookup are both
short-circuited, and `seesEveryProject` returns true without touching
`UserStorePermission`. A workspace with stores would have meant inventing a store
for a team that does not sell anything.

It grants no access anyone did not already have. A platform admin can already
read and edit every workspace on the platform through the admin console; being an
owner of the platform's own is strictly smaller than that.

Membership is add-only. Clearing someone's platform-admin flag does not remove
them from the workspace, because that would orphan their task assignments and
hour logs — a heavier consequence than a stale name in an assignee list.

---

## The switch

`platform_projects_enabled` (feature key `platformProjects`), on the Platform
Settings → Tenant Features page, **default on**.

It is a separate switch from `projects_enabled`, and the two answer different
questions:

| | `projects` | `platformProjects` |
|---|---|---|
| Governs | whether *shop users* see the module | whether the *platform team* has a workspace |
| Default | off — rolled out per tenant | on — internal tooling, not a billed feature |
| Per-tenant override | yes | no — see `TENANT_OVERRIDABLE_FEATURE_KEYS` |

`platformProjects` is excluded from `TENANT_OVERRIDABLE_FEATURE_KEYS` because
"override this for one tenant" is meaningless for it: no customer workspace has
an opinion about whether the operator's staff have somewhere to track their work.
`UpdateAdminTenantFeaturesDto` therefore rejects it, and
`admin-tenants.dto.spec.ts` pins that.

Switched off, `GET /platform/workspace` 403s, the nav entry disappears, and the
shell redirects `/projects` away. Nothing is deleted — switching it back on
returns the same workspace with its history intact.

---

## Provisioning

Lazy: the workspace is created by the first `GET /platform/workspace` that ever
succeeds, not by a migration. Most deployments never open the module, and a
tenant row that exists only because a migration ran is a row every "how many
workspaces are there" query has to remember to exclude.

Two admins opening the console at the same moment both see no workspace and both
try to create one. The unique key means the loser's insert throws; it re-reads
and returns the row the winner wrote, so both end up in the same workspace rather
than one of them seeing an error.

Project types and task statuses need no seeding — `ProjectSettingsService` seeds
those from `DEFAULT_TASK_STATUSES` on first read, for any tenant.

---

## Navigation

`DEFAULT_PLATFORM_ADMIN_NAV_LAYOUT` gains the `projects` module and its seven
links, hung off the console root next to `admin`. They are the same registry
nodes the tenant sidebar uses — one set of pages serves both surfaces, so
`/projects/boards` in the console and `/projects/boards` in a shop are the same
route reading different tenants.

A deployment with a **saved** `platform_admin_layout` will not pick the new nodes
up on its own (saved layouts are served verbatim). Either reset it from
Navigation settings, or:

```bash
npx tsx prisma/sync-nav-layout.ts --nodes=projects,projects.list,projects.boards,projects.tasks,projects.sprints,projects.hour-logs,projects.hour-log-report,projects.setup
```

---

## What this does not do

- **No cross-workspace reporting.** The platform's hour logs and a tenant's hour
  logs are separate tenants and never roll up together.
- **No second workspace.** The unique key allows exactly one. If the platform
  ever wants per-team workspaces, that is a different change — the key would have
  to become a per-workspace slug, and every `platform_workspace_key: null` filter
  would need re-reading as "not any platform workspace".
- **No membership beyond platform admins.** A contractor who is not a platform
  admin cannot be added; `ProjectMember` can name an employee without a login,
  but the tenant membership itself follows the admin roster.
