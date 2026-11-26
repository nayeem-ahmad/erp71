# Lead Movement Report Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a CRM › Reports › Lead movement page that counts distinct leads whose stage changed in a date range, once each, at the furthest visible stage toward Converted (or Lost).

**Architecture:** Every real stage landing writes a `LeadStatusEvent`. A pure fold assigns each lead in the window to one visible stage. `GET /crm/reports/lead-movement` reads those events. Lead funnel is untouched.

**Tech Stack:** NestJS, Prisma/PostgreSQL, Next.js 15, DataTable, Jest.

**Spec:** `docs/superpowers/specs/2026-11-26-lead-movement-report-design.md`

## Global Constraints

- Every Prisma query filters on `tenant_id`. `mine` is resolved from the session (`tenant.userId`), never from a client-supplied owner id.
- Date windows use `resolveDateWindow(query, tenant.timezone)` then `clampWindow(..., REPORT_MAX_DAYS)` (`371`). Bucket with `window.dayOf`, never `toISOString().slice(0, 10)`.
- `recordLeadStatusChange` is the only `leadStatusEvent.create` in the repo. Call it in the same transaction as the lead write. Skip when `from !== null && from.id === to.id`.
- Taxonomy delete rewrites event FKs onto `reassignTo` and does **not** insert a landing dated now. Events count as in-use for the reassign prompt.
- UI: `PageShell` + `PageHeader` + `DataTable` (`filterLayout="row"`, `viewOptions`). Accent `blue-600`. Rates via `percent()` / `formatRate`; `null` is `t.shared.dash`. No click-through.
- New message keys in all nine locales (`en bn ms hi de fr es ur ar`). `bn` is real Bangla; the others are real translations. `catalog.test.ts` enforces structure.
- Nav node `crm.reports.lead-movement` is `premiumOnly: true`, permission `VIEW_LEADS`. Icon `ArrowRightLeft`. Layout order immediately after Lead funnel (insert `8`, bump lost-leads and later by one).
- Tests one file/dir at a time, never backend and frontend Jest in parallel. Frontend pages: `--runTestsByPath` because `(app)` is a regex group.
- Work on a branch cut from `origin/dev` in `.claude/worktrees/`. Commit each task on that branch, never `main`. Author Nayeem Ahmad `<nayeem.ahmad@gmail.com>`. After schema/shared-types edits: `npx prisma generate --schema packages/database/prisma/schema.prisma` and `npm run build --workspace packages/shared-types`.
- Update `TODO.md` in the same commit as the feature code (one COMPLETED line at ship).

## File map

| File | Role |
|---|---|
| `packages/database/prisma/schema.prisma` | `LeadStatusEvent` + relations on Tenant, Lead, User, LeadStatusOption |
| `apps/backend/src/crm-leads/lead-status-event.util.ts` | The only insert |
| `apps/backend/src/crm-leads/crm-leads.service.ts` | create / update / convert / import call the helper |
| `apps/backend/src/storefront-enquiries/storefront-enquiries.service.ts` | enquiry → lead create landing |
| `apps/backend/src/crm-lead-taxonomy/crm-lead-taxonomy.service.ts` | events in-use + FK rewrite on status delete |
| `packages/database/prisma/sync-lead-status-events.ts` | idempotent won/lost backfill |
| `apps/backend/src/crm-reports/lead-movement.fold.ts` | pure per-lead assignment |
| `apps/backend/src/crm-reports/crm-lead-movement.service.ts` | window, query, payload |
| `apps/backend/src/crm-reports/crm-reports.{controller,module,dto}.ts` | `GET /crm/reports/lead-movement` |
| `apps/frontend/src/app/(app)/crm/reports/lead-movement/page.tsx` | report page |
| `packages/shared-types/navigation.ts` | nav node, perms, layout |
| `apps/backend/src/demo-data/generator/write-crm.ts` | demo events |

## Review Focus

1. **Landings outside the window do not rank.** A lead that was Qualified last month and Contacted this month counts as Contacted this month. Test in Task 4.
2. **Dhaka day bound.** An event at `2026-10-31T20:00:00Z` is 1 Nov in `Asia/Dhaka` and is inside a November window. Test in Task 4.
3. **Same-timestamp landings.** Two events with equal `created_at` pick latest by `id` ascending as a tie-break so “latest is Lost” is deterministic. Test in Task 3.
4. **`mine=true` drops unassigned leads** (storefront enquiries set `assigned_to: null`). Test in Task 4.
5. **Re-saving the same stage writes no event** (`updated_at` must not look like movement). Test in Task 2.

---

### Task 1: Schema and the only writer

**Files:**
- Modify: `packages/database/prisma/schema.prisma` (`Lead`, `LeadStatusOption`, `Tenant` around the `leadStatusOptions` relation, `User` around `createdLeads`)
- Create: `apps/backend/src/crm-leads/lead-status-event.util.ts`
- Test: `apps/backend/src/crm-leads/lead-status-event.util.spec.ts`

**Interfaces:**
- Produces:

```ts
export type StageRef = { id: string | null; lifecycle: string };

export type LeadStatusEventDb = {
    leadStatusEvent: { create: (args: { data: Record<string, unknown> }) => Promise<unknown> };
};

export async function recordLeadStatusChange(
    db: LeadStatusEventDb,
    args: {
        tenantId: string;
        leadId: string;
        from: StageRef | null;
        to: StageRef;
        actorId?: string | null;
        at?: Date;
    },
): Promise<boolean>; // true when a row was inserted
```

Prisma model name `LeadStatusEvent`, `@@map("lead_status_events")`. Columns as the spec. Relations: `Lead.statusEvents`, `Tenant.leadStatusEvents`, `User.leadStatusEventsCreated` `@relation("LeadStatusEventCreator")`, `LeadStatusOption.fromEvents` / `toEvents` (`LeadStatusEventFrom` / `LeadStatusEventTo`). FKs: lead `onDelete: Cascade`; option FKs `SetNull`; creator `SetNull`.

- [ ] **Step 1: Write the failing tests** in `lead-status-event.util.spec.ts`. Mock `leadStatusEvent.create`.
  - `inserts a create landing with from_* null`: `from: null`, `to: { id: 'st-new', lifecycle: 'NEW' }`, `actorId: 'u1'`. Expect `create` called once; `data` has `tenant_id`, `lead_id`, `to_status_id: 'st-new'`, `to_lifecycle: 'NEW'`, `from_status_id: null`, `from_lifecycle: null`, `created_by: 'u1'`.
  - `skips when from.id equals to.id`: `from` and `to` both `{ id: 'st-new', lifecycle: 'NEW' }`. Expect `create` not called; return `false`.
  - `inserts when the stage id changes`: from `st-new`/`NEW` to `st-con`/`CONTACTED`. Expect `from_status_id: 'st-new'`, `from_lifecycle: 'NEW'`, `to_status_id: 'st-con'`, `to_lifecycle: 'CONTACTED'`; return `true`.
  - `honours at`: pass `at: new Date('2026-01-02T12:00:00Z')`. Expect `data.created_at` that Date.
- [ ] **Step 2: Run them.** `cd apps/backend && npx jest src/crm-leads/lead-status-event.util.spec.ts --maxWorkers=2 --workerIdleMemoryLimit=600MB`. Expected: FAIL, cannot find module.
- [ ] **Step 3: Add the Prisma model and relations, run `npx prisma generate --schema packages/database/prisma/schema.prisma`, implement `recordLeadStatusChange`.** Skip only when `from !== null && from.id === to.id`. When `at` is omitted, leave `created_at` to Prisma default (do not send `undefined` as a Date).
- [ ] **Step 4: Re-run the tests.** Expected: PASS.
- [ ] **Step 5: Commit.** `feat(crm): add LeadStatusEvent writer`

---

### Task 2: Write events on every real stage landing

**Files:**
- Modify: `apps/backend/src/crm-leads/crm-leads.service.ts` (create ~624, update ~974, convert ~1475, import create ~1296, import update ~1387)
- Modify: `apps/backend/src/storefront-enquiries/storefront-enquiries.service.ts` (`createLead` ~276)
- Test: existing `crm-leads.service.spec.ts`, `storefront-enquiries.service.spec.ts`

**Interfaces:**
- Consumes: `recordLeadStatusChange` from Task 1.
- Bulk status goes through `update()` already — do not add a second call in `bulkUpdate`.
- Lead-generation import goes through `CrmLeadsService.create` — no extra call there.

Call inside the same `$transaction` as the lead write where one exists; otherwise immediately after the create/update, using the same `tx` or `this.db`. Pass `from: { id: existing.status_id, lifecycle: existing.status }` on update/convert/import-update; `from: null` on create. `actorId` is the acting user, or `null` for storefront/import.

Convert: `to` is the seeded CONVERTED stage. Already-converted throws today — no extra event.

Import update: call only when `stage !== undefined` and `stage.id !==` the lead’s previous `status_id`.

- [ ] **Step 1: Extend failing assertions** in `crm-leads.service.spec.ts`:
  - `create() writes a create landing`: after create, `leadStatusEvent.create` (or the helper’s db) was called with `from_status_id: null` and `to_status_id` the resolved NEW (or requested) stage.
  - `update() writes when the stage changes`: existing NEW → `status_id: 'st-neg'`. Expect one event from NEW to the negotiation stage.
  - `update() writes none when the stage is unchanged`: patch name only. Expect no `leadStatusEvent.create`.
  - `convert() writes a CONVERTED landing`.
  - import create: event with `from_*` null.
  - import update that changes stage: one event; import update that does not: none.
- [ ] **Step 2: In `storefront-enquiries.service.spec.ts`**, `createLead` writes a NEW landing with `created_by: null`.
- [ ] **Step 3: Run the new cases.** Expected: FAIL (create not called).
- [ ] **Step 4: Wire the helper on those paths.** Mock `leadStatusEvent.create` in existing db fixtures (`jest.fn().mockResolvedValue({})`) so older tests do not throw.
- [ ] **Step 5: Re-run.** `cd apps/backend && npx jest src/crm-leads/crm-leads.service.spec.ts src/storefront-enquiries/storefront-enquiries.service.spec.ts --maxWorkers=2 --workerIdleMemoryLimit=600MB`. Expected: PASS.
- [ ] **Step 6: Commit.** `feat(crm): record a LeadStatusEvent on every stage landing`

---

### Task 3: Taxonomy rewrite and won/lost backfill

**Files:**
- Modify: `apps/backend/src/crm-lead-taxonomy/crm-lead-taxonomy.service.ts` (`remove`, STATUS kind)
- Test: `apps/backend/src/crm-lead-taxonomy/crm-lead-taxonomy.service.spec.ts`
- Create: `packages/database/prisma/sync-lead-status-events.ts`
- Modify: `packages/database/package.json` (script `sync:lead-status-events`)
- Modify: `apps/backend/scripts/db-prepare.sh` (a `step` immediately after `sync:lead-taxonomy`)

**Interfaces:**
- For `kind === STATUS`, `blocking` is `max(leads on this status_id, events whose from_status_id or to_status_id is this id)`. Same `reassignTo` prompt. After `lead.updateMany`, `leadStatusEvent.updateMany` twice (or one `OR`): set `to_status_id`/`to_lifecycle` when `to_status_id === id`; set `from_status_id`/`from_lifecycle` when `from_status_id === id`. Lifecycle values come from the replacement row. No `leadStatusEvent.create`.
- Backfill script: for each lead with `closed_at` not null, `status` in (`CONVERTED`,`LOST`), and **zero** events, insert one event at `closed_at`, `from_*` null, `to_*` current stage, `created_by` null. Skip a lead that already has any event. `--dry-run` prints counts. Guard on `information_schema` so a missing table is a no-op (boot must not die). Follow the header style of `sync-lead-activity.ts`.

- [ ] **Step 1: Failing taxonomy tests.**
  - `refuses to delete a custom status that has events and no reassignTo`: no live leads, one event `to_status_id` of the row. Expect `ConflictException` with `requiresReassign: true`.
  - `rewrites event FKs onto the replacement and does not insert`: leads + events pointing at the deleted id; `reassignTo` set. Expect `leadStatusEvent.updateMany` called; `leadStatusEvent.create` not called; option `delete` called.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement the STATUS in-use count and FK rewrite.** Mock `leadStatusEvent` on the existing db fixture (`count`, `updateMany`, `create`).
- [ ] **Step 4: Re-run taxonomy spec.** Expected: PASS.
- [ ] **Step 5: Add `sync-lead-status-events.ts`, npm script, and the db-prepare step.** Keep the script runnable with `npx tsx` as the others. No Jest for the SQL script; the header comment states the skip rule (any existing event ⇒ leave the lead).
- [ ] **Step 6: Commit.** `feat(crm): backfill closed LeadStatusEvents and rewrite them on stage delete`

---

### Task 4: Fold and report service

**Files:**
- Create: `apps/backend/src/crm-reports/lead-movement.fold.ts`
- Test: `apps/backend/src/crm-reports/lead-movement.fold.spec.ts`
- Create: `apps/backend/src/crm-reports/crm-lead-movement.service.ts`
- Test: `apps/backend/src/crm-reports/crm-lead-movement.service.spec.ts`

**Interfaces:**

```ts
export type MovementLanding = {
    id: string;
    leadId: string;
    toStatusId: string | null;
    toLifecycle: string;
    createdAt: Date;
};

export type MovementStageMeta = {
    id: string;
    code: string;
    name: string;
    lifecycle: string;
    is_system: boolean;
    is_active: boolean;
    sort_order: number;
};

/** One lead's in-window landings → visible stage id, or null if omitted. */
export function assignMovementStage(
    landings: MovementLanding[],
    visibleIds: Set<string>,
    metaById: Map<string, MovementStageMeta>,
): string | null;

export type LeadMovementStageRow = MovementStageMeta & {
    count: number;
    share_pct: number | null;
};

export type LeadMovementReport = {
    filters: { from: string; to: string; mine: boolean; status_ids: string[] };
    available_stages: MovementStageMeta[]; // without sort_order is fine; include it internally
    stages: LeadMovementStageRow[];
    totals: { moved: number; converted: number; lost: number; conversion_pct: number | null };
};

export class CrmLeadMovementService {
    constructor(private readonly db: DatabaseService) {}
    report(
        tenantId: string,
        timezone: string,
        query: { from?: string; to?: string; mine?: boolean; statusIds?: string[] },
        ownerId?: string,
    ): Promise<LeadMovementReport>;
}
```

Fold rules (spec): sort landings by `createdAt` asc, then `id` asc. Latest landing: last after that sort. If Lost is in `visibleIds` and latest `toLifecycle === 'LOST'` and latest `toStatusId` is in `visibleIds` (or is the tenant’s LOST option id), return that Lost id. Else among landings whose `toStatusId` is in `visibleIds` and lifecycle is not `LOST`, pick max `sort_order`, then `name`. Null `toStatusId` landings are ignored. Empty landings → null.

Service: `resolveDateWindow` + `clampWindow(..., REPORT_MAX_DAYS)`. Load active stage options + any option id that appears as `to_status_id` in the window. `available_stages` = active options plus inactive ones that have a landing in the window, sorted by `sort_order` then name. Visible ids = `statusIds` if non-empty after filtering to known option ids, else every **active** id. Query events in `[fromDate, toDate]` with `lead: { tenant_id, ...(ownerId ? { assigned_to: ownerId } : {}) }`. Group by `leadId`, fold, count. `stages` = visible options, zero-filled, active first then inactive, each in `sort_order`. `share_pct = percent(count, moved)`. `conversion_pct = percent(converted, converted + lost)` among counted leads. `filters.status_ids` is the visible id list actually used.

- [ ] **Step 1: Failing fold tests** with stages New(1), Contacted(2), Qualified(3), Negotiation(3, custom QUALIFIED, name “Negotiation”), Converted(4), Lost(5). All visible unless named.
  - New only → New
  - New → Contacted → Qualified → Qualified
  - Qualified → Lost → Lost
  - Lost → Qualified → Qualified
  - New → Converted → Converted
  - Negotiation only → Negotiation
  - Contacted hidden, New → Contacted → New
  - Contacted hidden, Contacted only → null
  - Contacted hidden, Contacted → Qualified → Qualified
  - Lost hidden, Qualified → Lost → Qualified
  - Lost hidden, Lost only → null
  - two landings same `createdAt`, Lost id greater → Lost (id tie-break)
  - landing `toStatusId: null` ignored, remaining New → New
- [ ] **Step 2: Run fold spec.** Expected: FAIL, cannot find module.
- [ ] **Step 3: Implement `assignMovementStage`.**
- [ ] **Step 4: Re-run fold spec.** Expected: PASS.
- [ ] **Step 5: Failing service tests.** Fake timers `2026-11-15T06:00:00Z`. Mock `leadStatusOption.findMany` and `leadStatusEvent.findMany`.
  - default window is last 30 days (assert `filters.from`/`to`).
  - Dhaka: event `2026-10-31T20:00:00Z` to New, window `{ from: '2026-11-01', to: '2026-11-01' }` → New count 1.
  - New → Contacted in window, all visible → Contacted 1, New 0, moved 1.
  - Qualified → Lost → Lost 1, conversion_pct 0.
  - Lost hidden via `statusIds: [qualifiedId]` → Qualified 1, `totals.lost` 0.
  - `mine`: findMany where includes `lead: expect.objectContaining({ assigned_to: 'user-1' })`.
  - inactive stage with a landing appears in `available_stages` and not in `stages` until its id is in `statusIds`.
  - zero-fill: an active stage with no landings still has a row, count 0, share_pct null when moved is 0.
  - conversion_pct null when converted+lost is 0.
  - landings before `fromDate` are not loaded (assert the event `created_at` where).
- [ ] **Step 6: Run service spec.** Expected: FAIL.
- [ ] **Step 7: Implement `CrmLeadMovementService.report`.** Use `percent` from `../common/dashboard-window`.
- [ ] **Step 8: Re-run both specs.** Expected: PASS.
- [ ] **Step 9: Commit.** `feat(crm-reports): lead movement fold and report`

---

### Task 5: API, nav, types

**Files:**
- Modify: `apps/backend/src/crm-reports/crm-reports.dto.ts` — add `GetLeadMovementDto`
- Modify: `apps/backend/src/crm-reports/crm-reports.controller.ts` + `.spec.ts`
- Modify: `apps/backend/src/crm-reports/crm-reports.module.ts`
- Modify: `packages/shared-types/navigation.ts` (registry, `NAV_PERMISSIONS`, `layoutNode`)
- Modify: `apps/frontend/src/lib/routes.ts`
- Modify: `apps/frontend/src/lib/api.ts` (dedicated fetcher; `dashboardWindowFetcher` cannot send `statusIds`)
- Modify: `apps/frontend/src/components/crm/reports/types.ts`
- Modify: `apps/frontend/src/lib/nav-resolver.test.ts`
- Modify: `apps/frontend/src/app/(app)/layout.tsx` (`premiumCrmPaths`)
- After shared-types change: `npm run build --workspace packages/shared-types`

**Interfaces:**

```ts
export function parseStatusIds(value: unknown): string[];

export class GetLeadMovementDto extends CrmReportWindowDto {
    @IsOptional()
    @Transform(({ value }) => parseStatusIds(value))
    @IsArray()
    @IsString({ each: true })
    statusIds?: string[];
}
```

`parseStatusIds`: `null`/`''` → `[]`; array or comma-separated string → trimmed non-empty ids.

Controller: same guards as `leadFunnel`. `leadMovement(tenant, query)` calls `leadMovementService.report(tenant.tenantId, tenant.timezone, query, query.mine ? tenant.userId : undefined)`.

```ts
// api.ts
getCrmLeadMovement: (p?: {
    from?: string; to?: string; mine?: boolean; statusIds?: readonly string[];
}): Promise<LeadMovementReport>
```

Query: `from`, `to`, `mine=true` when set, `statusIds` as a comma-separated value only when `statusIds?.length`.

Nav: `'crm.reports.lead-movement': { id: 'crm.reports.lead-movement', kind: 'link', icon: 'ArrowRightLeft', labelKey: 'sidebar.items.crmLeadMovement', href: '/crm/reports/lead-movement', premiumOnly: true }`. Perms `['VIEW_LEADS']`. `layoutNode('crm.reports.lead-movement', 'crm.reports', 8)` and bump lost-leads 8→9, rfm 9→10, contact-coverage 10→11, birthdays 11→12.

- [ ] **Step 1: Failing controller tests.**
  - `perms('leadMovement')` equals `[StorePermission.VIEW_LEADS]`.
  - `mine: true` passes `tenant.userId` as the fourth argument; `statusIds: ['st-new']` is forwarded on the query object.
- [ ] **Step 2: Failing `parseStatusIds` cases** in `crm-reports.dto.ts` (or a tiny spec next to it): `'a, b'` → `['a','b']`; `['a','']` → `['a']`; `undefined` → `[]`.
- [ ] **Step 3: Run controller spec.** Expected: FAIL (`leadMovement` missing).
- [ ] **Step 4: Wire DTO, controller method, module provider/export, nav, routes, api, frontend types (`LeadMovementReport` matching the service type, `sort_order` optional on the public row if you prefer not to send it — sending it is fine).**
- [ ] **Step 5: Update `nav-resolver.test.ts` href list to include `/crm/reports/lead-movement` immediately after lead-funnel.** Add the path to `premiumCrmPaths`.
- [ ] **Step 6: `npm run build --workspace packages/shared-types`, then `cd apps/backend && npx jest src/crm-reports/crm-reports.controller.spec.ts --maxWorkers=2 --workerIdleMemoryLimit=600MB`.** Expected: PASS. Frontend nav-resolver: `cd apps/frontend && npx jest --testPathPatterns=nav-resolver.test --forceExit`.
- [ ] **Step 7: Commit.** `feat(crm-reports): expose GET /crm/reports/lead-movement`

---

### Task 6: Report page and copy

**Files:**
- Create: `apps/frontend/src/app/(app)/crm/reports/lead-movement/page.tsx`
- Test: `apps/frontend/src/app/(app)/crm/reports/lead-movement/page.test.tsx` (run with `--runTestsByPath`)
- Modify: `apps/frontend/src/app/(app)/crm/page.tsx` (hub card after Lead funnel, icon `ArrowRightLeft`)
- Modify: nine `crmHr.ts` (hub.links + `reports.leadMovement`) and nine `core.ts` (`sidebar.items.crmLeadMovement`)
- Modify: `apps/frontend/src/lib/localization/messages/catalog.test.ts` only if a new structural assertion is required (usually the tree match is enough)

**English copy** (other locales translate; `bn` in Bangla):

```
hub.links.leadMovement: { title: "Lead movement", description: "How many leads moved as far as each stage in the period." }
reports.leadMovement:
  sidebar / hubTitle / title: "Lead movement"
  hubDesc: "How many leads moved as far as each stage in the period."
  subtitle: "Leads that changed stage in the period, counted at the furthest stage they reached."
  note: "Each lead counts once. A lead marked lost in the period shows as Lost. Hidden stages are skipped."
  empty: "No leads changed stage in this period."
  stagesFilter: "Stages"
  columns: { stage: "Stage", leads: "Leads", share: "Share" }
  statsLabel: "Movement at a glance"
  movedStat: "Moved"
  convertedStat: "Converted"
  lostStat: "Lost"
  rateStat: "Conversion rate"
sidebar.items.crmLeadMovement: "Lead movement"
```

Page: clone Lead funnel shell. Period via `reportPeriodFilter` + `defaultReportPeriod`. `MineOnlyToggle` + `useCrmMineOnly`. Stages: `ListFilter` `type: 'multi-select'`, options from `available_stages`, value = selected ids. On first load with no `statusIds` search param, omit `statusIds` from the API call (server defaults to all active) and after the response set local selection to the active subset of `available_stages`. When the user changes the picker, write `statusIds` to the URL (`useSearchParams` / `router.replace`) as a comma-separated list and refetch. Columns: stage name, leads (end-aligned), share via `formatRate`. Footer `totals.moved`. Stats: moved, converted, lost, conversion rate. Empty copy as above. `tableId="crm-lead-movement"`.

- [ ] **Step 1: Failing page tests** (mock `api.getCrmLeadMovement`, `useCrmMineOnly` `{ mineOnly: false, setMineOnly: jest.fn(), ready: true }`, `useMediaQuery` as the funnel page does).
  - asks for the window (called after ready).
  - draws a row per stage with count and share (`Negotiation` 4, share `40%` given moved 10).
  - empty payload (`stages: []`, `moved: 0`) shows `No leads changed stage in this period.`
  - null conversion_pct shows `—` in the stats (or the rate cell).
- [ ] **Step 2: Run.** `cd apps/frontend && npx jest --runTestsByPath src/app/\(app\)/crm/reports/lead-movement/page.test.tsx --forceExit`. Expected: FAIL, cannot find module.
- [ ] **Step 3: Implement the page, hub card, and all nine locales.** Hub `key: 'leadMovement'`.
- [ ] **Step 4: Re-run the page test and `cd apps/frontend && npx jest src/lib/localization/messages/catalog.test.ts --forceExit`.** Expected: PASS.
- [ ] **Step 5: `cd apps/frontend && npx next lint --quiet --file src/app/\(app\)/crm/reports/lead-movement/page.tsx --file src/app/\(app\)/crm/page.tsx`.**
- [ ] **Step 6: Commit.** `feat(crm): Lead movement report page`

---

### Task 7: Demo data, nav sync note, TODO

**Files:**
- Modify: `apps/backend/src/demo-data/generator/write-crm.ts` (`writeLead`)
- Modify: `TODO.md` — one COMPLETED line, plus a P2 if you want: after deploy, `npx tsx packages/database/prisma/sync-nav-layout.ts --nodes=crm.reports.lead-movement` for custom sidebars
- Optional: `apps/frontend/e2e/helpers/nav-routes.ts` if CRM report paths are listed there by the time you look; skip if that file has no CRM report URLs

**Interfaces:**
- After `tx.lead.create`, `tx.leadStatusEvent.create` a create landing at `created_at` (`from_*` null, `to_*` the lead’s stage, `created_by: this.world.userId`).
- If `closed`, a second event at `closed_at` from the lead’s current stage… wait. Demo inserts the lead **already** in the final stage. Spec: “create at `created_at`; a close event at `closed_at` when converted or lost”.
  - Always: event at `created_at` to the **final** stage? That would make historical open-stage movement a lie.
  - Spec: create at created_at; close event at closed_at when converted/lost.
  - For an already-closed demo lead: create landing at `created_at` to NEW (seeded NEW id), close landing at `closed_at` to CONVERTED/LOST. For an open demo lead: one landing at `created_at` to its status. That gives the report both arrivals and closes without inventing Contacted hops.
- Pin that: open lead → one event at `created_at` to its `status_id`. Closed lead → event at `created_at` to the seeded NEW id, event at `closed_at` to the terminal `status_id`.

- [ ] **Step 1: Add the two `leadStatusEvent.create` calls in `writeLead`.** Use `this.leadStatusIds.get('NEW')` and `this.leadStatusIds.get(status)`.
- [ ] **Step 2: COMPLETED in `TODO.md`:** `- [x] **Lead movement report** — CRM › Reports counts distinct leads that changed stage in the period, once each at the furthest visible stage (Lost as its own outcome). Spec \`docs/superpowers/specs/2026-11-26-lead-movement-report-design.md\`. — done 2026-11-26`
- [ ] **Step 3: Commit (feature + TODO together).** `feat(crm): seed LeadStatusEvents in demo data`

---

## Self-review

- Spec coverage: event log (T1), all writers (T2), taxonomy rewrite + backfill (T3), counting rules + API shape (T4–T5), page/picker/i18n/nav (T5–T6), demo (T7), Lead funnel untouched (no task changes it).
- Click-through, datetime picker, activity timeline: non-goals, no tasks.
- Types: `LeadMovementReport` / `assignMovementStage` / `recordLeadStatusChange` names match across tasks.
- Review Focus items each have a named test in T2 or T4.
