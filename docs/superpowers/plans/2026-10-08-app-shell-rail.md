# App Shell Rail Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the one-tree tenant sidebar with a rail of apps + per-app menu, add app tiles with live counts to Home, and let owners hide apps — all behind a per-tenant `appShell` switch.

**Architecture:** A pure `resolveAppStates` in `packages/shared-types/apps.ts` becomes the single module-level gate. The Sidebar's module computation moves into `lib/sidebar-modules.ts` so the old sidebar, the new `AppShellSidebar` and the Home tiles all read the same resolved nav. The backend gains `Tenant.hidden_apps`, `GET/PATCH /tenants/app-settings` and `GET /home/pulse`.

**Tech Stack:** NestJS + Prisma (backend), Next.js 15 + React Query + Tailwind (frontend), Jest everywhere.

**Spec:** `docs/superpowers/specs/2026-10-08-app-shell-rail-design.md`

## Global Constraints

- One accent colour `blue-600`; semantic emerald/amber/red; no arbitrary hex classes; no `rounded-2xl`/`rounded-3xl`; no `font-black uppercase tracking-widest` in new code.
- Header unchanged (UI spec §2.12) — nothing new goes into the top bar.
- Every new modal uses `ModalShell`; every new `(app)` page uses `PageShell` + `PageHeader`.
- Touch targets `min-h-touch`/`min-w-touch` (44px); no horizontal scroll at 360px; logical properties for RTL.
- Every new string in all nine locales (`en bn ms hi de fr es ar ur`) — `catalog.test.ts` enforces parity.
- `appShell` off ⇒ old sidebar and old dashboard render exactly as before.
- Hiding an app is presentation only — no API refuses anything because an app is hidden.
- Additive schema only (`String[] @default([])`); production runs `prisma db push`.

## Review Focus

1. **Owner hides every business app** — rail shows Home + utilities only, Home shows no tiles and a Manage apps link; nothing crashes. Test in Task 6.
2. **A path no app owns** (`/profile`, `/notifications`) — the panel keeps the last app instead of going blank. Test in Task 5 (`findActiveAppKey` returns `null`; component keeps previous).
3. **Pulse endpoint for a member with no permissions** (a Project User) — returns `{ projects: … }` only and never 403s as a whole. Test in Task 3.
4. **Hidden list containing an id that later disappears from the registry** — `resolveAppStates` ignores unknown ids; PATCH rejects unknown ids. Tests in Tasks 1 and 2.
5. **Accounting-only plan with `appShell` on** — rail shows Accounting, Expenses and utilities; tiles show those two; locked row shows nothing sellable outside that plan. Test in Task 1 (state matrix).

---

### Task 1: `APP_REGISTRY`, `resolveAppStates` and the `appShell` platform switch (shared-types)

**Files:**
- Create: `packages/shared-types/apps.ts`
- Create: `packages/shared-types/apps.test.ts`
- Modify: `packages/shared-types/index.ts` (export `./apps`; add `appShell` to `PlatformFeatures`, `DEFAULT_PLATFORM_FEATURES`, `PLATFORM_FEATURE_KEYS`, `PLATFORM_FEATURE_SETTING_KEYS`)

**Interfaces:**
- Produces:
  - `type AppKind = 'business' | 'utility'`
  - `type AppState = 'available' | 'hidden' | 'locked' | 'unavailable'`
  - `interface AppDefinition { id; kind; entitlement?; requiresPaidPlan?; platformFeature?; platformFeatureAny?; inAccountingOnly?; soldWith?; permissionsAny?; railGroup?; platformAdminOnly? }`
  - `APP_REGISTRY: Record<string, AppDefinition>`; `BUSINESS_APP_IDS: string[]`
  - `interface AppStateInput { planFeatures: Record<string, boolean|number>; planCode: string | null; platformFeatures: PlatformFeatures; hiddenApps: readonly string[]; isOwner: boolean; permissions: readonly string[]; isPlatformAdmin?: boolean }`
  - `resolveAppStates(input): Record<string, AppState>`
  - `sanitizeHiddenApps(raw: unknown): string[]` — keeps only business app ids, de-duplicated, order preserved
  - `PlatformFeatures.appShell: boolean` (setting key `app_shell_enabled`, default `false`)

- [ ] **Step 1: Write the failing tests** — `apps.test.ts`:
  - every `NAV_REGISTRY` entry of `kind: 'module'` except `dashboard` has an `APP_REGISTRY` entry, and every registry id is such a module;
  - Pro tenant, owner, all platform switches on: sales/purchase/inventory/crm/hr available; accounting available; manufacturing available with `premiumManufacturing`;
  - FREE plan: accounting and expenses `locked` (platform default), manufacturing `locked` when switch on and entitlement missing, `unavailable` when switch off;
  - projects: `unavailable` with switch off; for non-owner without `VIEW_PROJECTS` `unavailable`; owner `available`;
  - accounting for a non-owner without `VIEW_LEDGER` on a paid plan with entitlement → `unavailable`;
  - hidden: `hiddenApps: ['crm', 'bogus', 'chat']` → crm `hidden`, chat unaffected (utility), no key for `bogus`;
  - hiding a locked app keeps it `locked` (hiding applies to available only);
  - accounting-only plan: only accounting, expenses, help, support, account-settings non-`unavailable`;
  - admin: `unavailable` unless `isPlatformAdmin`;
  - support: available when `support` *or* `feedback` platform switch is on;
  - `sanitizeHiddenApps(['crm','crm','chat',3,'x'])` → `['crm']`.
- [ ] **Step 2:** `npx jest packages/shared-types/apps.test.ts` → FAIL (module not found).
- [ ] **Step 3: Implement** `apps.ts`:

```ts
import type { PlatformFeatureKey, PlatformFeatures } from './index';
import { hasPlanEntitlement } from './subscription-plans';

export type AppKind = 'business' | 'utility';
export type AppState = 'available' | 'hidden' | 'locked' | 'unavailable';

export interface AppDefinition {
  id: string;
  kind: AppKind;
  entitlement?: string;
  requiresPaidPlan?: boolean;
  platformFeature?: PlatformFeatureKey;
  /** On when any of these switches is on (support: support or feedback). */
  platformFeatureAny?: readonly PlatformFeatureKey[];
  inAccountingOnly?: boolean;
  soldWith?: string;
  permissionsAny?: readonly string[];
  railGroup?: string;
  platformAdminOnly?: boolean;
}

export const APP_REGISTRY: Record<string, AppDefinition> = {
  sales: { id: 'sales', kind: 'business' },
  storefront: { id: 'storefront', kind: 'business' },
  purchase: { id: 'purchase', kind: 'business' },
  imports: { id: 'imports', kind: 'business' },
  accounting: { id: 'accounting', kind: 'business', entitlement: 'premiumAccounting', requiresPaidPlan: true, inAccountingOnly: true, permissionsAny: ['VIEW_LEDGER'] },
  expenses: { id: 'expenses', kind: 'business', entitlement: 'premiumAccounting', requiresPaidPlan: true, inAccountingOnly: true, permissionsAny: ['VIEW_LEDGER'], soldWith: 'accounting' },
  inventory: { id: 'inventory', kind: 'business' },
  crm: { id: 'crm', kind: 'business' },
  projects: { id: 'projects', kind: 'business', platformFeature: 'projects', permissionsAny: ['VIEW_PROJECTS'] },
  manufacturing: { id: 'manufacturing', kind: 'business', entitlement: 'premiumManufacturing', platformFeature: 'manufacturing' },
  hr: { id: 'hr', kind: 'business' },
  chat: { id: 'chat', kind: 'utility', entitlement: 'teamChat' },
  help: { id: 'help', kind: 'utility', platformFeature: 'help', inAccountingOnly: true, railGroup: 'help' },
  support: { id: 'support', kind: 'utility', platformFeatureAny: ['support', 'feedback'], inAccountingOnly: true, railGroup: 'help' },
  'whats-new': { id: 'whats-new', kind: 'utility', railGroup: 'help' },
  'account-settings': { id: 'account-settings', kind: 'utility', inAccountingOnly: true },
  admin: { id: 'admin', kind: 'utility', platformAdminOnly: true },
};

export const BUSINESS_APP_IDS = Object.values(APP_REGISTRY)
  .filter((app) => app.kind === 'business')
  .map((app) => app.id);

export interface AppStateInput { /* as in Interfaces */ }

export function resolveAppStates(input: AppStateInput): Record<string, AppState> {
  const hidden = new Set(input.hiddenApps);
  const paid = Boolean(input.planCode) && input.planCode !== 'FREE';
  const accountingOnly = Boolean(input.planFeatures.accountingOnly);
  const states: Record<string, AppState> = {};
  for (const app of Object.values(APP_REGISTRY)) {
    states[app.id] = stateOf(app, input, { hidden, paid, accountingOnly });
  }
  return states;
}

function stateOf(app, input, ctx): AppState {
  if (app.platformAdminOnly) return input.isPlatformAdmin ? 'available' : 'unavailable';
  if (ctx.accountingOnly && !app.inAccountingOnly) return 'unavailable';
  if (app.platformFeature && !input.platformFeatures[app.platformFeature]) return 'unavailable';
  if (app.platformFeatureAny && !app.platformFeatureAny.some((key) => input.platformFeatures[key])) return 'unavailable';
  const granted = (!app.entitlement || hasPlanEntitlement(input.planFeatures, app.entitlement))
    && (!app.requiresPaidPlan || ctx.paid);
  if (!granted) return 'locked';
  if (app.permissionsAny && !input.isOwner && !app.permissionsAny.some((p) => input.permissions.includes(p))) return 'unavailable';
  if (app.kind === 'business' && ctx.hidden.has(app.id)) return 'hidden';
  return 'available';
}

export function sanitizeHiddenApps(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  for (const id of raw) {
    if (typeof id === 'string' && APP_REGISTRY[id]?.kind === 'business') seen.add(id);
  }
  return [...seen];
}
```

  `locked` is returned for *every* viewer here; the UI decides who sees a locked tile (owners and `canManageBilling`), and the rail treats anything but `available` as absent. A `locked` utility (chat) is simply absent from the rail.

  Add `appShell` to `PlatformFeatures` (doc comment: "The rail-of-apps shell and Home app tiles. Off by default; pilot per tenant."), `DEFAULT_PLATFORM_FEATURES` (`false`), `PLATFORM_FEATURE_KEYS`, `PLATFORM_FEATURE_SETTING_KEYS` (`app_shell_enabled`). It is tenant-overridable (not excluded from `TENANT_OVERRIDABLE_FEATURE_KEYS`).
- [ ] **Step 4:** run the test and the whole shared-types suite (`npm test --workspace packages/shared-types`) → PASS; `npm run build --workspace packages/shared-types`.
- [ ] **Step 5: Commit** `feat(shared-types): app registry and resolveAppStates; appShell platform switch`.

### Task 2: Backend — `appShell` setting, `Tenant.hidden_apps`, app-settings endpoints, `/auth/me`

**Files:**
- Modify: `packages/database/prisma/schema.prisma` (`Tenant.hidden_apps String[] @default([])` beside `dashboard_preference`)
- Create: `packages/database/prisma/migrations/20261008090000_tenant_hidden_apps/migration.sql`
- Modify: `apps/backend/src/platform-settings/platform-settings.service.ts` (`app_shell_enabled: { isSecret: false, default: 'false' }`, and wherever the other `*_enabled` keys are mapped into `PlatformFeatures`)
- Modify: `apps/backend/src/admin-tenants/admin-tenants.dto.ts` (`appShell?: boolean | null`)
- Create: `apps/backend/src/tenants/app-settings.dto.ts`
- Modify: `apps/backend/src/tenants/tenants.controller.ts`, `tenants.service.ts` (+ spec)
- Modify: `apps/backend/src/auth/auth.service.ts` (select + return `hidden_apps`)

**Interfaces:**
- Consumes: `sanitizeHiddenApps`, `BUSINESS_APP_IDS` from Task 1.
- Produces: `GET /tenants/app-settings → { hidden_apps: string[] }`; `PATCH /tenants/app-settings { hidden_apps: string[] } → { hidden_apps }` (OWNER/MANAGER only, 400 on unknown id); `/auth/me` tenant entries gain `hidden_apps: string[]`.

- [ ] **Step 1: Failing tests** in `tenants.service.spec.ts`: get returns `[]` for a tenant with none; update by a `CASHIER` throws `ForbiddenException`; update with `['crm', 'nope']` throws `BadRequestException`; update with `['crm','crm','hr']` stores `['crm','hr']`; utility id `'chat'` rejected.
- [ ] **Step 2:** run → FAIL.
- [ ] **Step 3: Implement.** Migration SQL: `ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "hidden_apps" TEXT[] DEFAULT ARRAY[]::TEXT[];`. DTO: `@IsArray() @ArrayMaxSize(32) @IsString({ each: true }) hidden_apps!: string[]`. Service mirrors `updateDashboardSettings` (same role rule and comment), validates every id with `BUSINESS_APP_IDS.includes`, stores `sanitizeHiddenApps(dto.hidden_apps)`, audit-free like the dashboard setting. Controller routes beside `dashboard-settings`, same guards and the same `userRole` source. `prisma generate`.
- [ ] **Step 4:** tenants spec + `auth.service.spec.ts` pass; `npx tsc --noEmit -p apps/backend` shows no new errors.
- [ ] **Step 5: Commit** `feat(tenants): hidden_apps setting and the appShell platform switch`.

### Task 3: Backend — `GET /home/pulse`

**Files:**
- Create: `apps/backend/src/home-pulse/home-pulse.module.ts`, `home-pulse.controller.ts`, `home-pulse.service.ts`, `home-pulse.service.spec.ts`
- Modify: `apps/backend/src/app.module.ts`

**Interfaces:**
- Produces: `GET /home/pulse?storeId=` → `Record<appId, { count: number; href: string }>`, only non-zero, only permitted metrics. Cached 60s per tenant+branch+user (the projects metric is per user).

Metric table (from a read of each module, 2026-10-08):

| App | Count | Query | Permission any-of | Plan / platform gate | Branch | href |
|---|---|---|---|---|---|---|
| sales | sales orders to fulfil | `salesOrder.count({ tenant_id, store_id?, status: { in: ['CONFIRMED','PROCESSING'] } })` | `SALES_READ` | — | `resolveStoreId(…, { permissions: SALES_READ })` | `/sales/orders` |
| inventory | low-stock products | `ProductsService.countLowStock(tenantId, storeId)` | `CATALOG_READ` | — | `resolveStoreId(…, { permissions: CATALOG_READ })` | `/inventory` (not the reorder report: premium, most counted members cannot open it — found in review) |
| accounting | vouchers awaiting approval | `AccountingService.getPendingVoucherCount(tenantId).count` | `VIEW_LEDGER` | `premiumAccounting` | tenant-wide | `/accounting/vouchers?approval=PENDING` |
| crm | activities due today or overdue (team, as the page defaults) | `CrmActivitiesService.summary(tenantId, timezone)` → `dueToday + overdue` | `VIEW_CRM_INTERACTIONS` | `premiumCrm` | tenant-wide | `/crm/activities` |
| projects | my open tasks | `projectTask.count({ where: { AND: [{ tenant_id, deleted_at: null, assignee_id: userId, status: { category: { not: 'DONE' } } }, ProjectAccessService.taskFilter(viewer)] } })` | `VIEW_PROJECTS` | platform `projects` | tenant-wide | `/projects/tasks` |
| hr | leave requests awaiting approval | `leaveRequest.count({ tenant_id, status: 'PENDING', deleted_at: null })` | `HR_READ` | — | tenant-wide | `/hr/leaves` |
| purchase | purchase orders still open | `purchaseOrder.count({ tenant_id, store_id?, status: { in: ['DRAFT','SENT'] }, received_at: null })` | `PURCHASE_READ` | — | `resolveStoreId(…, { permissions: PURCHASE_READ })` | `/purchases/orders` |
| storefront | online orders awaiting confirmation | `storefrontOrder.count({ tenantId, status: 'PENDING' })` | `STOREFRONT_STAFF` | — | tenant-wide | `/storefront` |
| manufacturing | production jobs in progress | `productionJob.count({ tenantId, status: 'IN_PROGRESS' })` | `MANUFACTURING_READ` | `premiumManufacturing` + platform `manufacturing` | tenant-wide | `/manufacturing/jobs` |
| imports | shipments not yet received | `importShipment.count({ tenant_id, store_id?, status: { notIn: ['RECEIVED','CLOSED','CANCELLED'] } })` | `VIEW_IMPORTS`, `MANAGE_IMPORTS` | — | `resolveStoreId(…, { permissions: [VIEW_IMPORTS, MANAGE_IMPORTS] })` | `/purchases/imports` |

Notes from the read:
- `Sale.status` never holds a delivery status — the dashboard's `DELIVERY_PENDING_STATUSES` count is always 0 — so Sales counts open sales orders instead.
- `TenantContext` has `tenantId`, `storeId?`, `userId`, `userRole?` (`'OWNER'` bypasses), `timezone`; no permission list. Tenant-wide metrics check `loadMemberStoreGrants(db, authCache, userId, tenantId)` (any branch holds any of the permissions); branch metrics use `BranchScopeService.resolveStoreId` and treat `ForbiddenException` as "not permitted", as `mobile.controller.ts` does.
- Plan gates via `PlanEntitlementsService.getFeaturesForTenant` + `hasPlanEntitlement`; platform gates via `PlatformSettingsService.isFeatureEnabledForTenant`.
- No class-level permission guard on the controller — a member with one module's access must still get that module's count.

- [ ] **Step 1: Failing spec** — a viewer holding only `VIEW_PROJECTS` gets only `projects`; a metric whose query throws is absent and the call resolves; zero counts are omitted; owner gets every metric.
- [ ] **Step 2:** run → FAIL.
- [ ] **Step 3: Implement** — controller `@Controller('home')`, `@UseGuards(JwtAuthGuard)`, `@UseInterceptors(TenantInterceptor)`, no `StorePermissionGuard` at class level (each metric checks its own permission in the service with the tenant context's permissions / owner flag); `Promise.allSettled` over the permitted metrics; branch scoping through `BranchScopeService.resolveStoreId` with the metric's permission set, swallowing `ForbiddenException` per metric.
- [ ] **Step 4:** spec passes; app boots in the e2e module list (`app.module.ts` import).
- [ ] **Step 5: Commit** `feat(home): one-request pulse for the Home app tiles`.

### Task 4: i18n — every new string, all nine locales

**Files:** `apps/frontend/src/lib/localization/messages/{en,bn,ms,hi,de,fr,es,ar,ur}/components.ts` (new `appShell` block), `…/admin.ts` (`appShell: { label, hint }` beside `projects` in the platform-switch labels), the settings hub links map (`apps`).

`appShell` keys: `home`, `apps`, `searchAllApps`, `searchShortcut`, `collapseRail`, `expandRail`, `helpGroup`, `manageApps`, `addToPlan`, `locked`, `seePlans`, `lockedSheetBody`, `appDescriptions.{accounting,manufacturing,chat}`, `pulse.{sales,inventory,accounting,crm,projects,hr,purchase,storefront,manufacturing,imports}` (each with a `{count}` placeholder), `settings.{title,subtitle,shown,hidden,save,saved,readOnly,lockedHint,empty}`.

- [ ] **Step 1:** add the English block; run `catalog.test.ts` → FAIL for eight locales.
- [ ] **Step 2:** add the eight translations; run → PASS.
- [ ] **Step 3: Commit** `i18n: app shell strings in all nine locales`.

### Task 5: Frontend refactor — shared module resolution and link renderer; Sidebar reads app states

**Files:**
- Create: `apps/frontend/src/lib/sidebar-modules.ts` — `resolveSidebarModules(input: SidebarModulesInput): ResolvedNavModule[]`, the body of the Sidebar's `modules` `useMemo` moved verbatim (layout branch: platform admin + tenant), plus the `appStates` path.
- Create: `apps/frontend/src/components/sidebar/NavModuleChildren.tsx` — the subgroup/link markup moved out of Sidebar (props: `moduleKey`, `items`, `openGroups`, `onToggleGroup`, `isActive`, `isSearching`, `compactNav`, `badgeFor(href) → { count, title } | null`).
- Create: `apps/frontend/src/hooks/useDrawerFocusTrap.ts` — the focus-trap/Escape effect moved out of Sidebar.
- Modify: `apps/frontend/src/components/Sidebar.tsx` — calls the three; new optional prop `appStates`.
- Modify: `apps/frontend/src/app/(app)/layout.tsx` — computes `appStates` with `resolveAppStates`; derives `canAccessAccounting`, `canAccessProjects` (tenant mode), `canAccessManufacturing` from it so route guards agree; passes `appStates` to Sidebar.
- Test: `apps/frontend/src/lib/sidebar-modules.test.ts`; `Sidebar.test.tsx` unchanged and green.

**Interfaces:**
- Produces: `SidebarModulesInput` (= today's Sidebar gating props + `appStates?` + `tenantLayout`, `platformAdminLayout`, `messages`); `resolveSidebarModules`.
- With `appStates` given, the tenant-mode module filter is `appStates[key] === 'available'` for registered ids and `isItemVisible(module, planFeatures)` otherwise; the legacy if-chain only runs when `appStates` is absent (tests). TODO entry to retire it with the old shell.

- [ ] **Step 1:** `sidebar-modules.test.ts` — with `appStates` marking `crm: 'hidden'` and `manufacturing: 'locked'`, neither module is returned; with all available + member lacking `SALES_ANY`, sales is dropped by the permission pass; accounting-only states return only accounting/expenses/help/support/account-settings/dashboard.
- [ ] **Step 2:** run → FAIL.
- [ ] **Step 3:** move code; wire Sidebar and layout.
- [ ] **Step 4:** `npx jest --runTestsByPath src/lib/sidebar-modules.test.ts src/components/Sidebar.test.tsx src/lib/nav-resolver.test.ts` → PASS (existing 42 Sidebar tests unchanged).
- [ ] **Step 5: Commit** `refactor(sidebar): resolve modules outside the component; gate tenant modules on app states`.

### Task 6: Frontend — `AppShellSidebar` (rail + panel)

**Files:**
- Create: `apps/frontend/src/lib/app-shell.ts` — `findActiveAppKey(modules, pathname): string | null` (longest matching link href; `/dashboard` → `null`), `appHomeHref(module): string | null` (module `href` or first link, descending into subgroups), `buildRail(modules): { business: RailEntry[]; utility: RailEntry[] }` (groups `railGroup` members into one entry whose `modules` holds each member), `moduleHasBadge(module, badgeFor)`.
- Create: `apps/frontend/src/lib/app-shell.test.ts`
- Create: `apps/frontend/src/components/app-shell/AppShellSidebar.tsx`, `AppRail.tsx`, `AppPanel.tsx`, `AppShellSidebar.test.tsx`
- Modify: `apps/frontend/src/app/(app)/layout.tsx` — `appShellOn = platformFeatures.appShell && tenant mode` → render `AppShellSidebar` with the same props instead of `Sidebar`.

Behaviour (spec §2): rail 56px with brand mark → Home, Home (`LayoutGrid`), business entries, gap, utility entries, collapse toggle; panel resizable (default 232, clamp 176–400, `localStorage` keys `app-shell-panel-width`, `app-shell-collapsed`), business-name row, search across all apps (`filterNavModules`), app heading, `NavModuleChildren`; on Home or with no app yet the panel lists apps; unknown path keeps last app; desktop rail entries are `Link`s to `appHomeHref`, mobile (`!isMdUp`) entries are buttons that switch the panel; `Ctrl/⌘+K` focuses search and expands; drawer on mobile reuses `useDrawerFocusTrap`, closes on navigation; chat unread dot on Chat; amber dot on an app whose links carry a badge (pending vouchers).

- [ ] **Step 1:** `app-shell.test.ts` — `findActiveAppKey` picks `expenses` for `/accounting/expenses/123` over `accounting`; `null` for `/dashboard` and `/profile`; `appHomeHref` returns the first link inside a leading subgroup; `buildRail` folds help/support/whats-new into one `help` entry and omits the group when none is present. `AppShellSidebar.test.tsx` — rail lists available apps and not hidden ones; panel shows Sales links on `/sales/list`; typing in search shows an Inventory link while on Sales; on mobile clicking the CRM rail button shows CRM links without navigating; `⌘K` focuses the search.
- [ ] **Step 2:** run → FAIL.
- [ ] **Step 3:** implement.
- [ ] **Step 4:** run → PASS.
- [ ] **Step 5: Commit** `feat(app-shell): rail of apps with a per-app menu`.

### Task 7: Frontend — Home tiles, locked add-ons, single-app landing

**Files:**
- Create: `apps/frontend/src/contexts/AppShellContext.tsx` — `{ enabled, navInput: SidebarModulesInput-sans-layouts, appStates, canManageBilling, canManageApps }`
- Create: `apps/frontend/src/components/app-shell/AppTiles.tsx`, `LockedAppSheet.tsx`, `AppTiles.test.tsx`
- Modify: `apps/frontend/src/lib/api.ts` (`getHomePulse(params?: { storeId?: string })`)
- Modify: `apps/frontend/src/app/(app)/layout.tsx` (provide context; `canManageApps = owner || role MANAGER`)
- Modify: `apps/frontend/src/app/(app)/dashboard/page.tsx` (+ test)

- [ ] **Step 1:** tests — tiles render available business apps in layout order, not hidden/locked ones; a pulse `{ inventory: { count: 12, href } }` renders "12 low on stock" linking to `href`; locked row appears for `canManageBilling` and not for a cashier; `expenses` (soldWith) has no locked tile; clicking a locked tile opens the sheet with a `/billing` link; all apps hidden → no tiles, Manage apps link present; dashboard page with `appShell` off renders no tiles; a member whose only reachable business app is Projects is redirected to `/projects`.
- [ ] **Step 2:** run → FAIL.
- [ ] **Step 3:** implement; pulse via `useQuery(['home-pulse', storeId], …, { staleTime: 60_000 })`, failures render tiles without pulse lines.
- [ ] **Step 4:** run → PASS.
- [ ] **Step 5: Commit** `feat(home): app tiles with live counts and add-on tiles`.

### Task 8: Frontend — `/settings/apps`

**Files:**
- Create: `apps/frontend/src/app/(app)/settings/apps/page.tsx`, `page.test.tsx`
- Modify: `apps/frontend/src/lib/routes.ts` (`settings.apps`), `apps/frontend/src/lib/api.ts` (`getTenantAppSettings`, `updateTenantAppSettings`), `apps/frontend/src/app/(app)/settings/page.tsx` (hub card, shown only when `appShell` is on)

- [ ] **Step 1:** tests — lists available and hidden apps with a switch, locked with See plans, omits unavailable; toggling and saving PATCHes the full list and invalidates `ME_QUERY_KEY`; a cashier sees switches disabled and the read-only note; a failed save toasts through `toast.error` and keeps the edit.
- [ ] **Step 2:** run → FAIL.
- [ ] **Step 3:** implement with `PageShell` + `PageHeader`, shared `Button`, the existing switch primitive if one exists in `@/components/ui`.
- [ ] **Step 4:** run → PASS.
- [ ] **Step 5: Commit** `feat(settings): Apps page — owners hide the apps their business does not use`.

### Task 9: Admin labels, docs, TODO, verification, PR

- [ ] Platform switch row in `admin/platform-settings/tenant-features/page.tsx` (`app_shell_enabled` / `appShell`); tenant override row appears automatically via `TENANT_OVERRIDABLE_FEATURE_KEYS` (label from Task 4).
- [ ] `docs/ui-design-guidelines.md`: §2.13 App shell (rail, panel, Home tiles, what may go on the rail).
- [ ] `TODO.md`: completed entry; follow-ups — retire legacy sidebar + its if-chain once `appShell` is default; flip platform default; new-modules spec; per-user pins.
- [ ] Verify: shared-types tests; backend `npx jest src/tenants src/home-pulse src/auth src/platform-settings src/admin-tenants`; frontend `npx jest --runTestsByPath` for every touched suite, then the full frontend suite alone; `npx tsc --noEmit` both apps; `next lint --quiet` over the app (memory: CI log truncates).
- [ ] Push branch, open PR into `dev`.

---

