# CRM Reports (first four) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a CRM › Reports section with four reports: Lead source performance, Salesperson scorecard, Follow-up compliance, and Customers going cold.

**Architecture:** A new backend module `crm-reports` (`GET /crm/reports/*`, `premiumCrm`-gated like `/crm/dashboard`) serves the three lead and activity reports. It shares one helper that attributes post-conversion sales revenue to converted leads. "Customers going cold" is sales data with branch scoping, so it is served from the existing `sales-reports` module next to `customer-retention`, under the same permission. The frontend adds a `crm.reports` nav subgroup, four `DataTable` report pages, and a Reports section on the CRM hub.

**Tech Stack:** NestJS + Prisma (backend), Next.js 15 + `DataTable` + Tailwind (frontend), Jest on both sides.

**Spec:** No separate design doc. Scope was agreed in chat on 2026-11-15: reports 1, 5, 7 and 8 of the twelve proposed. The decisions are recorded in **Design decisions** below, and executors treat that section as the spec.

## Design decisions

- **No schema changes.** Every figure comes from columns that exist today.
- **Lead source performance is a cohort report.** It covers the leads *created* in the window, grouped by `source_id`, the same cohort as the dashboard's `getSources`. Its revenue is **to date**: completed sales to each lead's converted customer from `closed_at` onward, with no window.
- **The scorecard is a period report.** Its revenue is the completed sales *dated inside the window* to customers converted from leads the person currently owns (`Lead.assigned_to`). Owner history is not recorded, so credit follows the current owner.
- **Revenue** is `Sale.total_amount` where `status = 'COMPLETED'`, before returns. This matches `getCustomerRetention`. If one customer is linked from two converted leads, the earliest conversion gets all of that customer's revenue, so nothing is counted twice.
- **A follow-up** is a `CrmActivity` with `subject` not null and `due_at` not null, which is the dashboard's definition of "planned work". It is classified on the **tenant calendar day**:
  - `CANCELLED` → cancelled.
  - `DONE` → on time if `dayOf(completed_at) <= dayOf(due_at)`, otherwise late. `DONE` with a null `completed_at` counts as on time, since nothing shows it was late.
  - `PLANNED` → overdue if `due_at` is before the start of today, otherwise pending.
  - **Compliance %** = on time ÷ (on time + late + overdue). Pending and cancelled rows are left out of the base.
  - Planned rows with no `due_at` are counted separately as `undated_open` and shown in a note.
- **Customers going cold** lists repeat customers only (two or more completed, non-exchange sales). It uses:
  - usual gap = (last sale day − first sale day) ÷ (orders − 1);
  - expected gap = max(usual gap, `minGapDays`, default 7);
  - cold when days since the last sale > expected gap × `factor` (default 2, allowed 1.5–5).
  
  Days are counted on the tenant calendar. Rows are sorted by lifetime spend, highest first, and capped at 2000 with a `truncated` flag.
- **Branches.** The three lead and activity reports have no branch filter, because CRM `store_id` is nullable and unchecked (TODO Phase 5). Customers going cold uses `BranchScopeService` exactly as `customer-retention` does.
- **Permissions.**
  - Lead sources and scorecard: `VIEW_LEADS`.
  - Follow-up compliance: `VIEW_CRM_INTERACTIONS`.
  - Customers going cold: `VIEW_CRM_INTERACTIONS`, BASIC plan, not premium. This mirrors `crm.customers` and `customer-retention`.
- **"Only mine".** The three CRM reports take `mine=true`, resolved to `tenant.userId` in the controller, as `/crm/dashboard` does. Pages read it from `useCrmMineOnly()` and draw `MineOnlyToggle`.
- **Rates** are `percent()` from `common/dashboard-window.ts`: one decimal, `null` when the base is 0. The UI shows `t.shared.dash` for `null`.

## Global Constraints

- Every Prisma query filters on `tenant_id`. `mine` is never an id from the client.
- Date windows come from `resolveDateWindow(query, tenant.timezone)`. Day bucketing uses `window.dayOf` or `zonedDateString`, never `toISOString().slice(0, 10)`.
- The windows of follow-up compliance and the scorecard are clamped to 371 days with `clampWindow`, moved to `common/dashboard-window.ts` in Task 3.
- UI: `PageShell` + `PageHeader` + `DataTable`. Money via `formatBDT()`. Secondary columns get `meta: { hideOnMobile: true }`. Errors go through `toast`. No new colours: `blue-600` accent, emerald/amber/red for status.
- Every new message key goes into **all nine** locales (`en bn ms hi de fr es ur ar`). `messages/catalog.test.ts` enforces matching structure. `bn` must be real Bangla, and the other locales real translations, not English copies. Interpolation uses `{count}`-style placeholders with `.replace`.
- Nav: the three CRM-data reports are `premiumOnly: true`. Customers going cold is not. None are `advancedOnly`.
- Tests run one directory or file at a time, never the full suites in parallel:
  - backend: `npx jest <dir> --maxWorkers=2 --workerIdleMemoryLimit=600MB`;
  - frontend page tests: `--runTestsByPath`, because `(app)` is a regex group.
- Work on branch `feat/crm-reports` cut from `origin/dev`, in a worktree with its own install.

## Review Focus

1. **A `CONVERTED` lead with a null `converted_customer_id`** (a bulk status edit can create one). It counts as converted, earns ৳0 and does not crash the revenue helper. Test in Task 1 and Task 2.
2. **Tenant-day boundaries in Dhaka (+06:00).** A follow-up done at 01:00 the next morning is late. A sale at 20:00 UTC on the 14th falls on the 15th. Tests in Task 3 and Task 5.
3. **Unassigned planned activities** (the birthday and reorder crons create them with no assignee). They land on one `user_id: null` row in follow-up compliance and are never silently dropped. The scorecard leaves them out because it has no person to credit. Tests in Task 3 and Task 4.
4. **Zero-base rates.** A source with no closed leads, or a person with nothing due, shows `—`, not `0%` or `NaN%`. Tests in Task 2 and Task 7.
5. **Two purchases on the same day** (usual gap 0). The `minGapDays` floor means the customer is not flagged cold the next morning. Test in Task 5.

---

### Task 1: Converted-lead revenue helper

**Files:**
- Create: `apps/backend/src/crm-reports/converted-revenue.util.ts`
- Test: `apps/backend/src/crm-reports/converted-revenue.util.spec.ts`

**Interfaces:**
- Produces:
  ```ts
  export type ConvertedLeadRef = { id: string; converted_customer_id: string | null; closed_at: Date | null };
  export type LeadRevenue = { orders: number; revenue: number };
  export async function revenueByConvertedLead(
      db: Pick<DatabaseService, 'sale'>,
      tenantId: string,
      leads: ConvertedLeadRef[],
      saleWindow?: { fromDate: Date; toDate: Date },
  ): Promise<Map<string, LeadRevenue>>; // keyed by lead id; leads with no revenue are absent
  ```

- [ ] **Step 1: Write the failing tests.** `db.sale.findMany` is a jest mock returning `{ customer_id, sale_date, total_amount }` rows.
  - `counts only completed sales on or after the conversion date`: lead L1 closed 2026-10-01 → customer C1. Sales on 09-30 (৳500) and 10-02 (৳1200). Expect `get('L1')` toEqual `{ orders: 1, revenue: 1200 }`, and the `findMany` where contains `status: 'COMPLETED'`, `tenant_id: 'tenant-1'`, `customer_id: { in: ['C1'] }`.
  - `gives a customer shared by two converted leads to the earliest conversion only`: L1 (closed 10-01) and L2 (closed 10-05) both → C1, one sale on 10-06 (৳900). Expect L1 → 900 and `has('L2')` false.
  - `returns an empty map without querying when no lead has a customer`: `[{ id: 'L1', converted_customer_id: null, closed_at: new Date() }]` → `size` 0, `findMany` not called.
  - `limits sales to the window when one is given`: expect the where to carry `sale_date: { gte: fromDate, lte: toDate }`.
- [ ] **Step 2: Run them and see them fail.** `cd apps/backend && npx jest src/crm-reports/converted-revenue --maxWorkers=2 --workerIdleMemoryLimit=600MB`. Expected: FAIL, cannot find module.
- [ ] **Step 3: Implement `revenueByConvertedLead`.** Build `customer → { leadId, closed_at }`, keeping the earliest `closed_at`. Query in chunks of 5000 customer ids, selecting only `customer_id, sale_date, total_amount`. Drop sales dated before the owning lead's `closed_at`. Convert `total_amount` with `Number()`.
- [ ] **Step 4: Run the tests again.** Expected: PASS (4 tests).
- [ ] **Step 5: Commit.** `git add apps/backend/src/crm-reports/converted-revenue.util* && git commit -m "feat(crm-reports): attribute post-conversion revenue to leads"`

### Task 2: Module and lead source performance endpoint

**Files:**
- Create: `apps/backend/src/crm-reports/crm-reports.module.ts`, `crm-reports.controller.ts`, `lead-source-report.service.ts`
- Test: `apps/backend/src/crm-reports/lead-source-report.service.spec.ts`, `crm-reports.controller.spec.ts`
- Modify: `apps/backend/src/app.module.ts` (import `CrmReportsModule`)

**Interfaces:**
- Consumes: `revenueByConvertedLead` (Task 1); `CrmDashboardQueryDto` (`from`, `to`, `mine`) from `crm-dashboard/crm-dashboard.dto.ts`, reused as the query DTO; `resolveDateWindow` and `percent` from `common/dashboard-window.ts`; `LeadStatus` and `OPEN_LEAD_STATUSES` from `crm-leads/crm-leads.dto.ts`.
- Produces:
  ```ts
  export type LeadSourceRow = {
      source_id: string | null; name: string | null; // name null ⇔ no source
      leads: number; contacted: number; contacted_pct: number | null;
      open: number; converted: number; lost: number;
      conversion_pct: number | null; win_rate_pct: number | null;
      median_days_to_convert: number | null; revenue: number; revenue_per_lead: number | null;
  };
  export type LeadSourceReport = {
      filters: { from: string; to: string; mine: boolean };
      rows: LeadSourceRow[];
      totals: Omit<LeadSourceRow, 'source_id' | 'name'>;
  };
  LeadSourceReportService.report(tenantId: string, query: CrmDashboardQueryDto, timezone: string, ownerId?: string): Promise<LeadSourceReport>
  // Route: GET /crm/reports/lead-sources  → CrmReportsController.leadSources(tenant, query)
  ```
  Controller class decorators match `CrmDashboardController`: `JwtAuthGuard, StorePermissionGuard, SubscriptionAccessGuard`, `@RequiresFeature('premiumCrm')`, `TenantInterceptor`. Each method carries its own `@RequireStorePermission`. Private `ownerScope(tenant, query)` returns `query.mine ? tenant.userId : undefined`.

- [ ] **Step 1: Write the failing service tests.** `db.lead.findMany` returns rows with `id, source_id, status, last_contacted_at, created_at, closed_at, converted_customer_id`. `db.leadSourceOption.findMany` returns names. `revenueByConvertedLead` is mocked with `jest.mock('./converted-revenue.util')`.
  - `groups the window's leads by source with conversion and win rate`: source S1 has 4 leads (2 CONVERTED, 1 LOST, 1 NEW) → `leads 4, converted 2, lost 1, open 1, conversion_pct 50, win_rate_pct 66.7`.
  - `takes the median days from created_at to closed_at over converted leads`: conversions taking 2, 4 and 10 days → `median_days_to_convert` 4.
  - `puts leads with no source on one row with a null name`.
  - `counts a converted lead with no customer as converted and earns it nothing`: `converted 1, revenue 0`.
  - `returns null rates when the base is zero`: one NEW lead → `win_rate_pct` null, `median_days_to_convert` null.
  - `narrows to the caller's leads under mine`: the `findMany` where contains `assigned_to: 'user-1'` and `created_at: { gte, lte }`.
  - `sums the rows into totals and sorts by leads, most first`.
- [ ] **Step 2: Write the failing controller tests** in `crm-reports.controller.spec.ts`. Instantiate the controller directly, as `hr-reports.controller.spec.ts` does.
  - `gates lead sources on VIEW_LEADS`: `Reflect.getMetadata(STORE_PERMISSIONS_KEY, CrmReportsController.prototype.leadSources)` toEqual `[StorePermission.VIEW_LEADS]`.
  - `requires premiumCrm`: `Reflect.getMetadata(SUBSCRIPTION_FEATURE_KEY, CrmReportsController)` is `'premiumCrm'`.
  - `resolves mine from the session`: calling with `{ mine: true }` passes `'user-1'` as `ownerId`, and with `{}` passes `undefined`.
- [ ] **Step 3: Run them and see them fail.** `npx jest src/crm-reports --maxWorkers=2 --workerIdleMemoryLimit=600MB`. Expected: FAIL.
- [ ] **Step 4: Implement the service, controller and module, and register the module.** The module provides `StorePermissionGuard` and `SubscriptionAccessGuard`, as `CrmDashboardModule` does.
- [ ] **Step 5: Run the tests again.** Expected: PASS.
- [ ] **Step 6: Commit.** `git commit -m "feat(crm-reports): lead source performance endpoint"`

### Task 3: Follow-up compliance endpoint

**Files:**
- Create: `apps/backend/src/crm-reports/follow-up-compliance.service.ts`
- Test: `apps/backend/src/crm-reports/follow-up-compliance.service.spec.ts`; add cases to `crm-reports.controller.spec.ts`
- Modify: `apps/backend/src/common/dashboard-window.ts` (move `calendarDaysBetween` and `clampWindow` here from `crm-dashboard.service.ts` and export them), `apps/backend/src/crm-dashboard/crm-dashboard.service.ts` (import them instead), `crm-reports.controller.ts`, `crm-reports.module.ts`

**Interfaces:**
- Produces:
  ```ts
  export type FollowUpOutcome = 'on_time' | 'late' | 'overdue' | 'pending' | 'cancelled';
  export function classifyFollowUp(
      row: { status: string; due_at: Date; completed_at: Date | null },
      todayStart: Date,
      dayOf: (d: Date) => string,
  ): FollowUpOutcome;
  export type ComplianceCounts = {
      due: number; on_time: number; late: number; overdue: number; pending: number; cancelled: number;
      compliance_pct: number | null;
  };
  export type FollowUpComplianceReport = {
      filters: { from: string; to: string; mine: boolean };
      by_assignee: (ComplianceCounts & { user_id: string | null; name: string | null })[];
      by_purpose: (ComplianceCounts & { purpose_id: string | null; name: string | null })[];
      totals: ComplianceCounts;
      undated_open: number;
  };
  FollowUpComplianceService.byAssignee(tenantId: string, window: DateWindow, ownerId?: string): Promise<Map<string | null, ComplianceCounts>>
  FollowUpComplianceService.report(tenantId: string, query: CrmDashboardQueryDto, timezone: string, ownerId?: string): Promise<FollowUpComplianceReport>
  // Route: GET /crm/reports/follow-up-compliance → CrmReportsController.followUpCompliance, @RequireStorePermission(VIEW_CRM_INTERACTIONS)
  ```
  `HEATMAP_MAX_DAYS` stays in the dashboard. The report clamps with a `REPORT_MAX_DAYS = 371` constant of its own.

- [ ] **Step 1: Write the failing tests.**
  - A `classifyFollowUp` table using `Asia/Dhaka`, with today = 2026-11-15:
    - due 2026-11-10 09:00 local, done 2026-11-10 22:00 → `on_time`;
    - due 2026-11-10 23:00, done 2026-11-11 01:00 → `late`;
    - PLANNED due 2026-11-14 → `overdue`;
    - PLANNED due 2026-11-15 08:00 → `pending`;
    - CANCELLED → `cancelled`;
    - DONE with `completed_at` null → `on_time`.
  - `reads only planned work with a due date in the window`: the `crmActivity.findMany` where has `subject: { not: null }`, `due_at: { gte, lte }` and `tenant_id`.
  - `puts unassigned follow-ups on one row with a null user`.
  - `leaves pending and cancelled out of compliance`: 1 on time, 1 late, 2 pending, 1 cancelled → `compliance_pct` 50, `due` 5.
  - `counts undated open work separately`: `crmActivity.count` is called with `status: 'PLANNED', due_at: null, subject: { not: null }`, and its result is returned as `undated_open`.
  - `names purposes from CrmActivityPurpose and users by name, falling back to email`.
  - Controller: `gates follow-up compliance on VIEW_CRM_INTERACTIONS`.
  - The existing `crm-dashboard.service.spec.ts` heatmap clamp tests still pass. Run it in Step 4.
- [ ] **Step 2: Run them and see them fail.** `npx jest src/crm-reports --maxWorkers=2 --workerIdleMemoryLimit=600MB`. Expected: FAIL.
- [ ] **Step 3: Implement.** Move `clampWindow` and `calendarDaysBetween` to `common/dashboard-window.ts`, then write `classifyFollowUp`, `byAssignee` and `report`. Select only `assigned_to, purpose_id, status, due_at, completed_at`, and bucket in JS.
- [ ] **Step 4: Run `npx jest src/crm-reports src/crm-dashboard src/common --maxWorkers=2 --workerIdleMemoryLimit=600MB`.** Expected: PASS.
- [ ] **Step 5: Commit.** `git commit -m "feat(crm-reports): follow-up compliance endpoint"`

### Task 4: Salesperson scorecard endpoint

**Files:**
- Create: `apps/backend/src/crm-reports/salesperson-scorecard.service.ts`
- Test: `apps/backend/src/crm-reports/salesperson-scorecard.service.spec.ts`; add cases to `crm-reports.controller.spec.ts`
- Modify: `crm-reports.controller.ts`, `crm-reports.module.ts`

**Interfaces:**
- Consumes: `FollowUpComplianceService.byAssignee` (Task 3), `revenueByConvertedLead` (Task 1), `clampWindow` (Task 3).
- Produces:
  ```ts
  export type ScorecardRow = {
      user_id: string; name: string;
      open_leads: number; new_leads: number;
      activities_logged: number; leads_touched: number;
      follow_ups_due: number; follow_ups_on_time_pct: number | null; overdue_now: number;
      converted: number; lost: number; win_rate_pct: number | null; revenue: number;
  };
  export type ScorecardReport = {
      filters: { from: string; to: string; mine: boolean };
      rows: ScorecardRow[];
      totals: Omit<ScorecardRow, 'user_id' | 'name'>;
  };
  SalespersonScorecardService.report(tenantId: string, query: CrmDashboardQueryDto, timezone: string, ownerId?: string): Promise<ScorecardReport>
  // Route: GET /crm/reports/scorecard → CrmReportsController.scorecard, @RequireStorePermission(VIEW_LEADS)
  ```
  Each column means:
  - `open_leads`: open statuses now, no window.
  - `new_leads`: assigned leads `created_at` in the window.
  - `activities_logged`: `DONE`, `channel_id` not null, `completed_at` in the window. This is the dashboard's "logged touch".
  - `leads_touched`: distinct `lead_id` among those activities.
  - `follow_ups_due` and `follow_ups_on_time_pct`: `byAssignee` → `due` and `compliance_pct`.
  - `overdue_now`: `PLANNED` with `due_at` before today, no window.
  - `converted` and `lost`: `closed_at` in the window.
  - `win_rate_pct`: `percent(converted, converted + lost)`.
  - `revenue`: `revenueByConvertedLead` over the person's `CONVERTED` leads that have a customer, with `saleWindow` set to the window.
  
  Rows cover every non-null user who appears in any of these figures. Users resolve to `name || email || '—'`. Rows are sorted by revenue, then converted, highest first.

- [ ] **Step 1: Write the failing tests.**
  - `builds one row per person who owns, worked or closed anything`: user A has only an overdue activity and user B has only a conversion → 2 rows.
  - `takes follow-up figures from FollowUpComplianceService for the same window`: mock `byAssignee`, and assert that its `window.from` equals the report's `filters.from`.
  - `credits revenue only from sales inside the window`: assert that `revenueByConvertedLead` receives `{ fromDate, toDate }`.
  - `leaves unassigned work out of the rows`.
  - `returns null win rate when nothing closed`.
  - `under mine, returns only the caller's row`: every lead and activity where carries `assigned_to: 'user-1'`.
  - Controller: `gates the scorecard on VIEW_LEADS`.
- [ ] **Step 2: Run them and see them fail.** Expected: FAIL.
- [ ] **Step 3: Implement**, using `groupBy` where the figure is a count (`[assigned_to]`, and `[assigned_to, lead_id]` for touched leads), so no rows are pulled.
- [ ] **Step 4: Run `npx jest src/crm-reports --maxWorkers=2 --workerIdleMemoryLimit=600MB`.** Expected: PASS.
- [ ] **Step 5: Commit.** `git commit -m "feat(crm-reports): salesperson scorecard endpoint"`

### Task 5: Customers going cold endpoint

**Files:**
- Create: `apps/backend/src/sales-reports/cold-customers.service.ts`
- Test: `apps/backend/src/sales-reports/cold-customers.service.spec.ts`; add cases to `sales-reports.controller.spec.ts`
- Modify: `apps/backend/src/sales-reports/sales-reports.dto.ts` (add `GetColdCustomersDto`), `sales-reports.controller.ts` (route), `sales-reports.module.ts` (provider)

**Interfaces:**
- Produces:
  ```ts
  export class GetColdCustomersDto {
      storeId?: string;                          // as the other report DTOs
      factor?: number;                           // @Type(() => Number) @Min(1.5) @Max(5), default 2
      minGapDays?: number;                       // @Type(() => Number) @IsInt @Min(1) @Max(90), default 7
  }
  export type ColdCustomerRow = {
      customer_id: string; name: string; phone: string | null; customer_code: string | null;
      segment: string; orders: number; lifetime_spend: number;
      avg_gap_days: number;            // one decimal
      days_since_last: number; overdue_days: number; // days_since_last − round(expected gap)
      last_purchase_date: string;      // YYYY-MM-DD, tenant zone
      last_contacted_at: string | null;
      has_open_follow_up: boolean;
  };
  export type ColdCustomersReport = {
      as_of: string; store_id: string | null; factor: number; min_gap_days: number;
      rows: ColdCustomerRow[]; total: number; truncated: boolean;
  };
  ColdCustomersService.report(tenantId: string, query: GetColdCustomersDto, timezone: string): Promise<ColdCustomersReport>
  // Route: GET /sales-reports/cold-customers
  //   @RequireStorePermission(StorePermission.VIEW_CRM_INTERACTIONS)
  //   storeId via this.scoped(tenant, query, [StorePermission.VIEW_CRM_INTERACTIONS]), as customer-retention does
  ```
  `ROW_CAP = 2000`. A single `sale.groupBy({ by: ['customer_id'], where: { tenant_id, status: 'COMPLETED', is_exchange: false, customer_id: { not: null }, store_id? }, having: { customer_id: { _count: { gt: 1 } } }, _count, _min: { sale_date }, _max: { sale_date }, _sum: { total_amount } })`. Customer fields come from `customer.findMany` (`name, phone, customer_code, segment_category, last_contacted_at`). `has_open_follow_up` comes from `crmActivity.findMany({ where: { tenant_id, status: 'PLANNED', customer_id: { in } }, distinct: ['customer_id'] })`.

- [ ] **Step 1: Write the failing tests.** Fake timers set now to `2026-11-15T06:00:00Z`; timezone `Asia/Dhaka`.
  - `flags a repeat customer silent for more than factor × their usual gap`: first sale 2026-09-01, last 2026-10-01, 4 orders (gap 10) → 45 days since > 20 → listed, `avg_gap_days` 10, `overdue_days` 35.
  - `does not flag a customer inside their rhythm`: gap 30, last sale 2026-10-25 → absent.
  - `ignores one-time buyers`: assert the `groupBy` call has the `having` clause, and a mocked count-1 row is still excluded.
  - `floors the usual gap at minGapDays`: 2 orders on 2026-11-12 (gap 0), defaults → 3 days since, not over 14, so absent.
  - `counts days on the tenant calendar`: 2 orders, first at `2026-10-01T04:00:00Z` and last at `2026-10-14T20:00:00Z` (02:00 on 10-15 in Dhaka) → `last_purchase_date` `'2026-10-15'`, `avg_gap_days` 14, `days_since_last` 31. Dating by UTC would give 32.
  - `marks customers that already have a planned follow-up`.
  - `keeps the 2000 most valuable and says it truncated`: 2001 cold rows → `rows.length` 2000, `total` 2001, `truncated` true, and the first row has the highest `lifetime_spend`.
  - `scopes to the branch when storeId is given`: the where has `store_id: 'store-1'`.
  - Controller (`sales-reports.controller.spec.ts`): `gates cold customers on VIEW_CRM_INTERACTIONS and resolves the branch with that permission`.
- [ ] **Step 2: Run them and see them fail.** `npx jest src/sales-reports --maxWorkers=2 --workerIdleMemoryLimit=600MB`. Expected: FAIL.
- [ ] **Step 3: Implement.** Use `zonedDateString` for sale days and `startOfZonedToday` for "as of". Day differences come from calendar labels, as `calendarDaysBetween` measures them.
- [ ] **Step 4: Run them again.** Expected: PASS.
- [ ] **Step 5: Commit.** `git commit -m "feat(sales-reports): customers going cold endpoint"`

### Task 6: Frontend plumbing: nav, routes, API client, copy, hub

**Files:**
- Modify: `packages/shared-types/navigation.ts`, `apps/frontend/src/lib/routes.ts`, `apps/frontend/src/lib/api.ts`, `apps/frontend/src/app/(app)/layout.tsx` (`premiumCrmPaths`), `apps/frontend/src/app/(app)/crm/page.tsx` (hub section), `apps/backend/src/ai/app-navigation.ts`, and `apps/frontend/src/lib/localization/messages/{en,bn,ms,hi,de,fr,es,ur,ar}/{core,crmHr}.ts`
- Create: `apps/frontend/src/components/crm/reports/types.ts` (the four report payload types, mirroring Tasks 2–5), `apps/frontend/src/components/crm/reports/format.ts`, and `apps/frontend/src/app/(app)/crm/reports/report-period.ts` (a re-export of `../../sales/reports/report-period`, as purchases does)
- Test: `apps/frontend/src/components/crm/reports/format.test.ts`, `apps/frontend/src/lib/nav-resolver.test.ts`, `apps/frontend/src/lib/sidebar-modules.test.ts`

**Interfaces:**
- Produces:
  - Nav nodes:
    - `crm.reports`: subgroup, icon `BarChart3`, labelKey `crm.hub.reports`.
    - `crm.reports.lead-sources`: `TrendingUp`, `sidebar.items.crmLeadSourceReport`, `premiumOnly`.
    - `crm.reports.scorecard`: `Users`, `sidebar.items.crmScorecard`, `premiumOnly`.
    - `crm.reports.follow-up-compliance`: `ListChecks`, `sidebar.items.crmFollowUpCompliance`, `premiumOnly`.
    - `crm.reports.cold-customers`: `Clock`, `sidebar.items.crmColdCustomers`.
  - Layout: `layoutNode('crm.reports', 'crm', 7)`, children 0–3 in that order, and `crm.setup` moves to 8.
  - `NAV_PERMISSIONS`: lead-sources and scorecard → `['VIEW_LEADS']`; follow-up-compliance and cold-customers → `['VIEW_CRM_INTERACTIONS']`.
  - `routes.crm.reports = { leadSources: '/crm/reports/lead-sources', scorecard: '/crm/reports/scorecard', followUpCompliance: '/crm/reports/follow-up-compliance', coldCustomers: '/crm/reports/cold-customers' }`.
  - `premiumCrmPaths` gains the first three.
  - API client:
    ```ts
    api.getCrmLeadSourceReport(p?: { from?: string; to?: string; mine?: boolean }): Promise<LeadSourceReport>
    api.getCrmScorecard(p?: { from?: string; to?: string; mine?: boolean }): Promise<ScorecardReport>
    api.getCrmFollowUpCompliance(p?: { from?: string; to?: string; mine?: boolean }): Promise<FollowUpComplianceReport>
    api.getColdCustomers(p: { storeId?: string; factor?: number; minGapDays?: number }): Promise<ColdCustomersReport>
    ```
    The first three use `dashboardWindowFetcher('/crm/reports/…')`. The last uses `buildReportQuery`.
  - `formatRate(value: number | null, locale: string, dash: string): string` returns `"66.7%"`, or `dash` for null.
  - Copy, under `crm.reports.*` in `crmHr.ts`:
    - `common`: `unassigned`, `unspecifiedSource`, `statsLabel`.
    - `leadSources`: `title`, `subtitle`, `revenueNote`, `empty`, and `columns.{source, leads, contacted, open, converted, lost, conversion, winRate, medianDays, revenue, revenuePerLead}`.
    - `scorecard`: `title`, `subtitle`, `revenueNote`, `empty`, and `columns.{person, openLeads, newLeads, activities, leadsTouched, followUpsDue, onTime, overdueNow, converted, lost, winRate, revenue}`.
    - `followUps`: `title`, `subtitle`, `groupBy`, `byPerson`, `byPurpose`, `undatedNote` (`"{count} planned follow-ups have no due date and are not counted."`), `empty`, and `columns.{person, purpose, due, onTime, late, overdue, pending, cancelled, compliance}`.
    - `coldCustomers`: `title`, `subtitle`, `factor`, `factorOption` (`"{factor}× their usual gap"`), `oneTimeNote`, `truncatedNote` (`"Showing the {shown} most valuable of {total}."`), `never`, `planned`, `empty`, and `columns.{customer, phone, segment, orders, lifetimeSpend, usualGap, daysSince, overdueBy, lastContacted, followUp}`.
    - Also `crm.hub.reports` and `crm.hub.links.{leadSourceReport, scorecard, followUpCompliance, coldCustomers}.{title, description}`. In `core.ts`: the four `sidebar.items.*` labels above.
  - Hub: section key `reports`, placed after `engagement`. The three premium links appear only when the hub's existing premium check passes. The cold-customers link always appears.
  - `app-navigation.ts`: four entries with `modules: ['crm']`.

- [ ] **Step 1: Write the failing tests.**
  - `format.test.ts`: `formatRate(66.7,'en','—')` → `'66.7%'`, `formatRate(null,'en','—')` → `'—'`, `formatRate(0,'en','—')` → `'0%'`.
  - `nav-resolver.test.ts`: `puts CRM Reports above CRM Setup with every report reachable`. Use the hrefs above, in order. No label contains `'.'`, and the labels contain `'Lead source performance'`.
  - `sidebar-modules.test.ts`: `shows only Customers going cold under CRM Reports without premium CRM`.
- [ ] **Step 2: Run them and see them fail.** `cd apps/frontend && npx jest src/components/crm/reports src/lib/nav-resolver src/lib/sidebar-modules --maxWorkers=2 --workerIdleMemoryLimit=600MB`. Expected: FAIL.
- [ ] **Step 3: Implement everything listed, then rebuild shared types.** Run `npm run build --workspace packages/shared-types`.
- [ ] **Step 4: Run the Step 2 tests, then `npx jest src/lib/localization src/lib/nav-label-keys src/lib/nav-icons --maxWorkers=2 --workerIdleMemoryLimit=600MB`.** Expected: PASS, including catalog completeness for all nine locales.
- [ ] **Step 5: Commit.** `git commit -m "feat(crm): CRM Reports nav section, routes, API client and copy"`

### Task 7: Lead source performance page

**Files:**
- Create: `apps/frontend/src/app/(app)/crm/reports/lead-sources/page.tsx`
- Test: `apps/frontend/src/app/(app)/crm/reports/lead-sources/page.test.tsx`

**Interfaces:**
- Consumes: `api.getCrmLeadSourceReport`, `LeadSourceReport`, `formatRate`, `reportPeriodFilter`/`defaultReportPeriod`/`reportPeriodQuery`, `useCrmMineOnly` + `MineOnlyToggle` (in `PageHeader` actions), and `routes.crm.reports.leadSources`.
- Page:
  - Shape follows `sales/reports/customers/page.tsx`: `DataTable` `tableId="crm-lead-sources"`, footer totals from `totals`.
  - Columns in Produces order. `contacted` and `conversion` show `formatRate`. `medianDays` and `revenuePerLead` are `hideOnMobile`.
  - Stats strip: leads, conversion %, revenue.
  - `revenueNote` sits under the table.
  - Breadcrumbs: `modulePageBreadcrumbs(home, t.sidebar.modules.crm, title, 'crm')`.

- [ ] **Step 1: Write the failing tests.** Mock `@/lib/api` and `@/hooks/useMediaQuery` as `hr/reports/payroll-cost/page.test.tsx` does.
  - `asks for the last 30 days under the remembered mine scope`: `localStorage crm_mine_only = 'true'` → first call has `mine: true` and `from`/`to` set.
  - `shows revenue in taka` (`৳` present).
  - `labels the no-source row Unspecified`.
  - `shows a dash, not 0%, for a rate with no base`.
- [ ] **Step 2: Run it and see it fail.** `cd apps/frontend && npx jest --runTestsByPath "src/app/(app)/crm/reports/lead-sources/page.test.tsx" --maxWorkers=2`. Expected: FAIL.
- [ ] **Step 3: Implement the page.**
- [ ] **Step 4: Run the test again.** Expected: PASS (and check the suite count is 1).
- [ ] **Step 5: Commit.** `git commit -m "feat(crm): lead source performance report page"`

### Task 8: Salesperson scorecard page

**Files:**
- Create: `apps/frontend/src/app/(app)/crm/reports/scorecard/page.tsx`
- Test: `.../scorecard/page.test.tsx`

**Interfaces:**
- Consumes: `api.getCrmScorecard`, `ScorecardReport`, and the same helpers as Task 7.
- Page: `tableId="crm-scorecard"`. `newLeads`, `leadsTouched` and `lost` are `hideOnMobile`. The footer row is the team total. Show `revenueNote`.

- [ ] **Step 1: Write the failing tests.**
  - `renders one row per person with on-time % and revenue`.
  - `shows a dash for a person with nothing closed`.
  - `sends mine when the toggle is on and refetches when it changes`.
- [ ] **Step 2: Run it and see it fail** (`--runTestsByPath`).
- [ ] **Step 3: Implement the page.**
- [ ] **Step 4: Run the test again.** Expected: PASS.
- [ ] **Step 5: Commit.** `git commit -m "feat(crm): salesperson scorecard report page"`

### Task 9: Follow-up compliance page

**Files:**
- Create: `apps/frontend/src/app/(app)/crm/reports/follow-up-compliance/page.tsx`
- Test: `.../follow-up-compliance/page.test.tsx`

**Interfaces:**
- Consumes: `api.getCrmFollowUpCompliance`, `FollowUpComplianceReport`, and the Task 7 helpers.
- Page:
  - A `select` filter chip `groupBy` with values `person` (default) and `purpose`. It switches between `by_assignee` and `by_purpose` client-side, without a refetch.
  - A null `user_id` row reads `common.unassigned`.
  - `pending` and `cancelled` are `hideOnMobile`.
  - The compliance cell uses `formatRate`, coloured emerald at ≥ 80, amber at 50–79.9 and red below 50.
  - When `undated_open > 0`, show `undatedNote` under the table.

- [ ] **Step 1: Write the failing tests.**
  - `opens grouped by person`.
  - `switches to purpose without refetching`: `getCrmFollowUpCompliance` is called once.
  - `labels unassigned work`.
  - `explains undated follow-ups when there are any`: the `undated_open: 3` text includes `3`.
- [ ] **Step 2: Run it and see it fail** (`--runTestsByPath`).
- [ ] **Step 3: Implement the page.**
- [ ] **Step 4: Run the test again.** Expected: PASS.
- [ ] **Step 5: Commit.** `git commit -m "feat(crm): follow-up compliance report page"`

### Task 10: Customers going cold page

**Files:**
- Create: `apps/frontend/src/app/(app)/crm/reports/cold-customers/page.tsx`
- Test: `.../cold-customers/page.test.tsx`

**Interfaces:**
- Consumes: `api.getColdCustomers`, `ColdCustomersReport`, `useBranchScope` + `BranchFilter` + `handleBranchForbidden` (as in `sales/reports/customers/page.tsx`), and `routes.sales.customerDetail(id)`.
- Page:
  - `PageHeader` actions hold `<BranchFilter scope={branch} />`. There is no mine toggle, because customers have no owner.
  - A `select` chip `factor` offers 1.5, 2 and 3 (default 2), with labels from `factorOption`. Changing it refetches.
  - The customer name links to `routes.sales.customerDetail`.
  - Phone, segment and last contacted are `hideOnMobile`. Last contacted shows `never` when null. The follow-up column shows `planned` as an emerald badge when true.
  - The stats strip shows `total` and the summed `lifetime_spend`. `oneTimeNote` always appears under the table, and `truncatedNote` appears when `truncated`.

- [ ] **Step 1: Write the failing tests.**
  - `asks with the branch and a factor of 2`.
  - `refetches with the chosen factor`.
  - `links each customer to their page`: `href` `/sales/customers/c1`.
  - `says when the list was cut to the most valuable`.
  - `shows Never for a customer nobody has contacted`.
- [ ] **Step 2: Run it and see it fail** (`--runTestsByPath`).
- [ ] **Step 3: Implement the page.**
- [ ] **Step 4: Run the test again.** Expected: PASS.
- [ ] **Step 5: Commit.** `git commit -m "feat(crm): customers going cold report page"`

### Task 11: Verify the branch and record follow-ups

**Files:**
- Modify: `TODO.md`

- [ ] **Step 1: Check types and lint.** Run `cd apps/backend && npx tsc --noEmit -p tsconfig.json` and `cd apps/frontend && npx tsc --noEmit && npx next lint --quiet`. Expected: no errors.
- [ ] **Step 2: Run the touched backend suites sequentially.** `cd apps/backend && npx jest src/crm-reports src/crm-dashboard src/sales-reports src/common --maxWorkers=2 --workerIdleMemoryLimit=600MB`. Expected: PASS.
- [ ] **Step 3: Run the frontend suites,** one invocation after the backend finishes. Use `npx jest --runTestsByPath` with the four page tests, then `npx jest src/lib src/components/crm --maxWorkers=2 --workerIdleMemoryLimit=600MB`. Expected: PASS.
- [ ] **Step 4: Update `TODO.md`.** Move the plan item to COMPLETED with today's date. Add these follow-ups under a new heading, `### CRM reports — follow-ups (YYYY-MM-DD)`:
  - Run `sync-nav-layout.ts --nodes=crm.reports,crm.reports.lead-sources,crm.reports.scorecard,crm.reports.follow-up-compliance,crm.reports.cold-customers` against production after deploy, dry run first.
  - The eight proposed reports not yet built: lead funnel by arrival month, lost leads, lead aging, activity register, RFM, contact coverage, upcoming birthdays, campaign performance.
  - `lost_reason` is free text. Make it a pick-list before building the lost-leads report.
  - There is no lead deal value, so no pipeline-value or forecast report is possible.
  - Status changes are not recorded, so there is no time-in-stage report.
  - Lead and activity reports cannot filter by branch until CRM `store_id` is enforced (Phase 5).
  - Scorecard revenue follows the current owner, not the owner at the time of conversion.
- [ ] **Step 5: Commit.** `git commit -m "docs(todo): CRM reports follow-ups"`
