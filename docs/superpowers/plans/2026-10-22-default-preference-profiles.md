# Default Preference Profiles Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A new staff member's invoice layout, list view, list columns, app-shell sidebar groups, alerts and a new browser's print setup start from their role's profile (or the workspace default) until they change them.

**Architecture:** A pure resolver in `packages/shared-types/preferences.ts` merges built-in ← profile ← legacy browser value ← the member's own answers, section by section. The backend stores profiles (`PreferenceProfile`, attached to `TenantRole`) and member answers (`TenantUser.preferences`, plus the existing `invoice_print_prefs` and `UserAlertPreference`), and serves the resolved set from `GET /preferences/me`. The frontend loads it once per workspace into a zustand store that the existing preference hooks read through.

**Tech Stack:** NestJS, Prisma/PostgreSQL (`db push` in production), Next.js 15, React, zustand, @tanstack/react-query, jest.

**Spec:** `docs/superpowers/specs/2026-10-22-default-preference-profiles-design.md`. Read it first; this plan argues from it and does not repeat its reasoning.

## Global Constraints

- Every business query is scoped by `tenant_id`; a foreign id is 404.
- No profile saved ⇒ every resolved value equals today's. That covers every `invoice_print_prefs` blob, the shop's paper size, and alerts with no row.
- Nothing ever throws because a preference cannot be read: normalisers drop bad fields, readers fall back.
- A hook writes a section only on the user's own change, never on load or on mount.
- Profiles are managed with `StorePermission.MANAGE_USERS`. Role ↔ profile assignment stays owner-only, like the rest of role editing. No new permission.
- Ids for lists, columns and sidebar groups match `/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,79}$/`. Limits: ≤ 300 lists per map, ≤ 100 column ids per list, page size an integer 1–500, ≤ 50 sidebar group ids.
- Paper sizes: `A4`, `A5`, `Letter`, `Thermal80`, `Thermal58`. Print density: `normal`, `compact`. Type scale: `normal`, `large`, `larger`.
- Alerts built-in: no muted types, quiet hours on, 22:00–08:00 (`from: 1320`, `to: 480` minutes).
- UI rules from `CLAUDE.md`: `PageShell` and `PageHeader`, `ModalShell`, `@/components/ui` primitives, `blue-600` accent, toasts only via the global `Toaster`, `min-h-touch`, no arbitrary hex.
- Every new UI string goes into all nine locales (`en ar bn de es fr hi ms ur`) under `apps/frontend/src/lib/localization/messages/<locale>/`. `messages/catalog.test.ts` enforces parity.
- Jest always runs with `--maxWorkers=2 --workerIdleMemoryLimit=600MB` and only on the affected paths. `(app)` page tests run with `--runTestsByPath`, because `(app)` is a regex group.
- This worktree has no install. Before Task 1, run `npm install --ignore-scripts` at the worktree root to give it its own `node_modules`. Never symlink from the main checkout. Then rebuild bcrypt for the backend.
- After any change to `schema.prisma` or `packages/shared-types`, run `npx prisma generate --schema packages/database/prisma/schema.prisma` and `npm run build --workspace packages/shared-types`.
- Commit after each task, with a conventional-commit subject. End each commit message with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **A saved invoice layout from before 2026-10-15** lacks `signature_space_mm`, `table_borders` or `warranty_column`. Once filled out, a profile that sets those must not change it (Task 2 and Task 3 tests).
2. **A member who once saved `footer_text: null`** is choosing the built-in thank-you line, so a profile footer must not replace it (Task 1 test `keeps a present null as an answer`).
3. **A shared till browser with old columns, and a member who joined after release:** the profile applies, not the browser's leftovers (Task 10 test `ignores legacy keys for an unlisted section`).
4. **The Flutter app saving one alert field** (`PUT /alerts/preferences {muted_types}`) on a member who has no row must keep the profile's quiet hours (Task 7 test).
5. **A list opened before preferences finish loading** must not write built-in columns as the member's own answer (Task 12 test `does not save on mount`).

---

## File Structure

**Shared types** (`packages/shared-types/`)
- `table-view.ts` (new): `TableViewSettings`, `DEFAULT_TABLE_VIEW`, `TABLE_DENSITIES`, `TABLE_FONT_SIZES` and `sanitizeTableView`, moved from the frontend.
- `preferences.ts` (new): section keys, section types, partial normalisers and `resolvePreferences`.
- `invoice-print.ts`: add `normalizeInvoicePrintPrefsPartial`.
- `index.ts`: export the two new files.

**Database** (`packages/database/`)
- `prisma/schema.prisma`: `PreferenceProfile`, `TenantRole.preference_profile_id`, `TenantUser.preferences`, `TenantUser.legacy_browser_sections`.
- `prisma/migrations/20261022120000_preference_profiles/migration.sql` (new).
- `prisma/sync-member-prefs-legacy.utils.ts` and `prisma/sync-member-prefs-legacy.ts` (new).
- `package.json`: the `sync:member-prefs-legacy` script.

**Backend** (`apps/backend/`)
- `scripts/db-prepare.sh`: the new step.
- `src/preferences/` (new): `preferences.module.ts`, `preferences.service.ts`, `preferences.controller.ts`, `preference-profiles.service.ts`, `preference-profiles.controller.ts`, `preference-profiles.dto.ts`, `new-account-locale.ts`, plus specs.
- `src/app.module.ts`: register the module.
- `src/sales-settings/sales-settings.service.ts`, `src/alerts/alerts.controller.ts`, `src/notifications/alert-policy.ts`, `src/team/team.service.ts`, `src/team/team.dto.ts`, `src/invitations/invitations.service.ts`, `src/employee-portal/employee-login.service.ts`.
- `src/auth/route-authorization.baseline.ts`: the self-scoped routes.

**Frontend** (`apps/frontend/src/`)
- `lib/preferences/` (new): `store.ts`, `legacy.ts`, `use-preferences-loader.ts`, `use-preference-section.ts`, plus tests.
- `lib/api.ts`: the preferences and profile methods.
- `app/(app)/layout.tsx`: mount the loader.
- `components/table/view-settings.ts` (re-export) and `components/table/useTableViewSettings.ts`.
- `components/data-table/useTablePreferences.ts` and `components/data-table/DataTable.tsx`.
- `components/app-shell/AppShellSidebar.tsx` and `components/Sidebar.tsx` (collapsed only).
- `lib/hooks/useSalePrintPrefs.ts`, `lib/print/density.ts`, `lib/print/type-scale.ts`.
- `components/preferences/` (new): `ProfilesPanel.tsx`, `ProfileEditorModal.tsx`, `ApplyProfileModal.tsx`, `MyPreferencesSection.tsx`, `copy-my-settings.ts`, plus tests.
- `app/(app)/team/page.tsx`, `app/(app)/profile/page.tsx` and `app/(app)/sales/components/PrintSettingsModal.tsx`.

---

## Phase 1 — Backend

### Task 1: Shared preference types and resolver

**Files:**
- Create: `packages/shared-types/table-view.ts`, `packages/shared-types/preferences.ts`, `packages/shared-types/preferences.test.ts`
- Modify: `packages/shared-types/invoice-print.ts`, `packages/shared-types/invoice-print.test.ts`, `packages/shared-types/index.ts`, `apps/frontend/src/components/table/view-settings.ts` (re-export the moved names; keep `TABLE_DENSITY_CLASSES`, `TABLE_FONT_PX` and `TABLE_ROW_CLASSES` where they are)

**Interfaces:**
- Produces (all exported from `@erp71/shared-types`):

```ts
export const PERSON_SECTIONS = ['invoicePrint', 'tableView', 'tableColumns', 'sidebar', 'alerts'] as const;
export type PersonSectionKey = (typeof PERSON_SECTIONS)[number];
export const PREFERENCE_SECTIONS = [...PERSON_SECTIONS, 'device'] as const;
export type PreferenceSectionKey = (typeof PREFERENCE_SECTIONS)[number];
export const LEGACY_BROWSER_SECTIONS = ['tableView', 'tableColumns', 'sidebar'] as const;
export type LegacyBrowserSection = (typeof LEGACY_BROWSER_SECTIONS)[number];

export interface TableViewPrefs { global: TableViewSettings; tables: Record<string, TableViewSettings> }
export interface TableColumnsEntry { hidden?: string[]; order?: string[]; pageSize?: number }
export type TableColumnsPrefs = Record<string, TableColumnsEntry>;
export interface SidebarPrefs { appShellOpenGroups?: string[] }
export interface AlertPrefs { mutedTypes: string[]; quiet: { enabled: boolean; from: number; to: number } }
export const PREFERENCE_PAPER_SIZES = ['A4', 'A5', 'Letter', 'Thermal80', 'Thermal58'] as const;
export interface DevicePrefs {
  paperSize?: (typeof PREFERENCE_PAPER_SIZES)[number];
  printDensity?: 'normal' | 'compact';
  printTypeScale?: 'normal' | 'large' | 'larger';
  skipPreview?: boolean;
  sidebarCollapsed?: boolean;
}
export interface SectionValues {
  invoicePrint: InvoicePrintPrefs; tableView: TableViewPrefs; tableColumns: TableColumnsPrefs;
  sidebar: SidebarPrefs; alerts: AlertPrefs; device: DevicePrefs;
}
export type SectionPartials = { [K in PreferenceSectionKey]?: Partial<SectionValues[K]> };
export interface PreferenceProfilePrefs { version: 1; sections: SectionPartials }
export interface MemberPreferences { version: 1; tableView?: Partial<TableViewPrefs>; tableColumns?: TableColumnsPrefs; sidebar?: SidebarPrefs }
export type PreferenceSource = 'member' | 'browser' | 'profile' | 'default';
export type ResolvedPreferences = { [K in PreferenceSectionKey]: { value: SectionValues[K]; source: PreferenceSource } };
export interface MyPreferencesResponse {
  profile: { id: string; name: string } | null;
  legacy_browser_sections: LegacyBrowserSection[];
  sections: ResolvedPreferences;
}
export interface PreferenceProfileSummary { id: string; name: string; is_default: boolean; roles: { id: string; name: string }[]; updated_at: string }
export interface PreferenceProfileDetail extends PreferenceProfileSummary { sections: SectionPartials }
export const DEFAULT_ALERT_PREFS: AlertPrefs; // { mutedTypes: [], quiet: { enabled: true, from: 1320, to: 480 } }
export const DEFAULT_SECTION_VALUES: SectionValues;
export function normalizeSectionPartial<K extends PreferenceSectionKey>(key: K, raw: unknown): Partial<SectionValues[K]>;
export function normalizeProfilePrefs(raw: unknown): PreferenceProfilePrefs;
export function normalizeMemberPreferences(raw: unknown): MemberPreferences;
export function resolvePreferences(input: {
  profile?: PreferenceProfilePrefs | null;
  member?: SectionPartials;                 // the member's own answers, person sections only
  legacy?: { [K in LegacyBrowserSection]?: unknown }; // only for sections still listed
}): ResolvedPreferences;
// invoice-print.ts
export function normalizeInvoicePrintPrefsPartial(raw: unknown): Partial<InvoicePrintPrefs>;
```

- [ ] **Step 1: Write the failing tests** in `preferences.test.ts` and `invoice-print.test.ts`:
  - `normalizeInvoicePrintPrefsPartial`:
    - `({ table_style: 'grid', layout: 'bogus' })` returns `{ table_style: 'grid' }`;
    - `keeps a present null as an answer`: `({ footer_text: null, signature_space_mm: null })` returns exactly those two keys, as `null`;
    - `({})` returns `{}`;
    - the legacy `hide_empty_warranty: true` maps to `warranty_column: 'when-used'` only when `warranty_column` is absent.
  - `resolvePreferences({})`: every section has `source: 'default'`, `invoicePrint.value` equals `DEFAULT_INVOICE_PRINT_PREFS`, `alerts.value` equals `DEFAULT_ALERT_PREFS`, and `device.value` equals `{}`.
  - **Layer order:** with a profile setting `invoicePrint.table_style: 'grid'` and `layout: 'detailed'`, and the member setting `table_style: 'striped'`, the result is `table_style: 'striped'`, `layout: 'detailed'`, `source: 'member'`.
  - **Footer null:** a member with `footer_text: null` and a profile with `footer_text: 'Thanks'` resolves to `footer_text: null`.
  - **Whole-entry replacement:** with profile `tableColumns: { a: { hidden: ['x'], pageSize: 50 } }` and member `tableColumns: { a: { order: ['y'] } }`, list `a` resolves to `{ order: ['y'] }`.
  - **List view:** with profile `tableView.global.density: 'compact'` and member `tableView.global.striped: false`, global resolves to `{ ...DEFAULT_TABLE_VIEW, density: 'compact', striped: false }`.
  - **Legacy layer:** `legacy.tableColumns` sits above the profile and below the member, with `source: 'browser'` when the member has none. A legacy value given for `invoicePrint` is ignored.
  - **Device:** `device.value` holds only the fields the profile sets (`{ paperSize: 'Thermal80' }`), never filled with built-ins.
  - **Stale and invalid ids:** an id failing the regex, a 301st list, a 101st column id, `pageSize: 0` or `pageSize: 501`, and a 51st group id are all dropped.
  - `normalizeProfilePrefs('garbage')` returns `{ version: 1, sections: {} }`, and an unknown section key is dropped.

- [ ] **Step 2: Run them and confirm they fail.** `cd packages/shared-types && npx jest preferences invoice-print`. Expected: FAIL, because the modules and exports are missing.

- [ ] **Step 3: Implement.** Move the table-view names into `table-view.ts` and re-export them from the frontend's `view-settings.ts`. Add `normalizeInvoicePrintPrefsPartial`, reusing the module's `oneOf`, `bool` and `signatureSpace` but emitting only present keys. Write `preferences.ts`, where `resolvePreferences` merges per section as follows:
  - **Field by field:** `invoicePrint`, `tableView.global`, `alerts` (`quiet` merged as one object), `device`.
  - **Entry replaced whole:** each key of `tableView.tables` and `tableColumns`.
  - **Array replaced whole:** `sidebar.appShellOpenGroups`.
  - **Source:** the most specific layer that set any field.

- [ ] **Step 4: Run the tests and confirm they pass.** Same command. Expected: PASS. Then `npm run build --workspace packages/shared-types` exits 0.

- [ ] **Step 5: Commit.** `feat(shared-types): preference sections and resolver`

### Task 2: Schema, migration and the one-shot legacy sync

**Files:**
- Modify: `packages/database/prisma/schema.prisma`, `packages/database/package.json`, `apps/backend/scripts/db-prepare.sh`
- Create: `packages/database/prisma/migrations/20261022120000_preference_profiles/migration.sql`, `packages/database/prisma/sync-member-prefs-legacy.utils.ts`, `packages/database/prisma/sync-member-prefs-legacy.ts`, `apps/backend/src/preferences/sync-member-prefs-legacy.spec.ts`

**Interfaces:**
- Consumes: `normalizeInvoicePrintPrefs` and `LEGACY_BROWSER_SECTIONS` (Task 1).
- Produces:
  - Prisma models: `PreferenceProfile`, as written in spec §4.1. Add the `Tenant.preferenceProfiles` back-relation.
  - New columns: `TenantRole.preference_profile_id String?` with relation `preferenceProfile PreferenceProfile? @relation(fields: [preference_profile_id], references: [id], onDelete: SetNull)`; `TenantUser.preferences Json?`; `TenantUser.legacy_browser_sections String[] @default([])`.
  - The sync utility:

    ```ts
    export const MARKER_GROUP = 'sync';
    export const MARKER_KEY = 'member_prefs_legacy';
    export async function runMemberPrefsLegacySync(client: any, opts: { dryRun: boolean }):
      Promise<{ skipped: true } | { skipped: false; members: number; blobs: number }>;
    ```

- [ ] **Step 1: Write the failing spec** `sync-member-prefs-legacy.spec.ts`, mocking the client the way `src/payment-methods/sync-payment-method-accounts.spec.ts` does:
  - `marker present → skipped, nothing written`;
  - `marker absent → every TenantUser gets ['tableView','tableColumns','sidebar']`: `updateMany` is called with `{ data: { legacy_browser_sections: [...] } }`;
  - `fills out every non-null invoice blob`: a blob `{ version: 1, table_style: 'grid' }` is written back as `normalizeInvoicePrintPrefs` of itself, which has 13 keys including `signature_space_mm: null`;
  - `a null blob is left null`;
  - `marker written last, inside the transaction`;
  - `dryRun writes nothing`.
- [ ] **Step 2: Run it and confirm it fails.** `cd apps/backend && npx jest --maxWorkers=2 --workerIdleMemoryLimit=600MB src/preferences/sync-member-prefs-legacy.spec.ts`. Expected: FAIL, because the module is missing.
- [ ] **Step 3: Implement.**
  - The schema changes.
  - `migration.sql`: create the table and FK, add the three columns, run `UPDATE "TenantUser" SET legacy_browser_sections = ARRAY['tableView','tableColumns','sidebar']`, and insert the marker row.
  - The utility.
  - The runner, mirroring `sync-payment-method-accounts.ts` (`--dry-run` flag, logs the result).
  - `"sync:member-prefs-legacy": "tsx prisma/sync-member-prefs-legacy.ts"`.
  - A `step sync:member-prefs-legacy \ npm run sync:member-prefs-legacy --workspace=@erp71/database` immediately after `sync:setup-fee-paid`, with a comment block saying why it is one-shot.
- [ ] **Step 4: Run it and confirm it passes.** Same command. Expected: PASS. Then `npx prisma generate --schema packages/database/prisma/schema.prisma` succeeds.
- [ ] **Step 5: Commit.** `feat(database): preference profiles schema and one-shot legacy sync`

### Task 3: `PreferencesService` (lookup and the member's own answers)

**Files:**
- Create: `apps/backend/src/preferences/preferences.service.ts`, `apps/backend/src/preferences/preferences.service.spec.ts`

**Interfaces:**
- Consumes: everything from Task 1; the Task 2 schema.
- Produces:

```ts
@Injectable() export class PreferencesService {
  constructor(db: DatabaseService)
  profileFor(tenantId: string, userId: string): Promise<{ id: string; name: string; prefs: PreferenceProfilePrefs } | null>;
  resolveFor(tenantId: string, userId: string): Promise<MyPreferencesResponse>;
  saveSection(tenantId: string, userId: string, key: PersonSectionKey, body: unknown): Promise<MyPreferencesResponse['sections'][PersonSectionKey]>;
  resetSection(tenantId: string, userId: string, key: PersonSectionKey): Promise<MyPreferencesResponse['sections'][PersonSectionKey]>;
}
```

`saveSection` merge rules for the body:
- `invoicePrint`, `alerts`: the partial fields are merged onto the stored layer.
- `tableColumns`: `{ [tableId]: entry | null }`. An entry replaces that list's entry; `null` deletes it.
- `tableView`: `{ global?: Partial<TableViewSettings>; tables?: { [tableId]: TableViewSettings | null } }`.
- `sidebar`: `{ appShellOpenGroups: string[] }`.

- [ ] **Step 1: Write the failing spec**, mocking `db` as `sales-settings.service.spec.ts` does:
  - `profileFor`:
    - `uses the primary role's profile`;
    - `falls back to the default profile when the role has none`;
    - `falls back to the default profile when the member has no role`;
    - `returns null when there is neither`.
  - `resolveFor`:
    - `lists legacy_browser_sections`;
    - `reads the alert row as the member's whole answer`;
    - `no alert row → profile alerts`;
    - `device carries only profile-set fields`;
    - `NotFoundException for a non-member`.
  - `saveSection`:
    - `invoicePrint stores only the submitted fields onto the stored layer`: stored `{ padding: 'wide' }` plus body `{ footer_text: null }` writes `{ padding: 'wide', footer_text: null }` and never the resolved defaults;
    - `tableColumns replaces one list and deletes on null`;
    - `locks the TenantUser row before writing preferences`: `$queryRaw` is called before `update`;
    - `removes the section from legacy_browser_sections`;
    - `alerts upserts the row starting from the resolved values`;
    - `device → BadRequestException`;
    - `an unknown key → BadRequestException`.
  - `resetSection`:
    - `invoicePrint → invoice_print_prefs set to Prisma.DbNull`;
    - `alerts → row deleted`;
    - `tableView → key removed and section taken off the legacy list`.
- [ ] **Step 2: Run it and confirm it fails.** `npx jest --maxWorkers=2 --workerIdleMemoryLimit=600MB src/preferences/preferences.service.spec.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - `profileFor` is one `tenantUser.findUnique` with `tenantRole: { select: { preferenceProfile: true } }`, then a `preferenceProfile.findFirst({ where: { tenant_id, is_default: true } })` only if needed.
  - Writes run in `$transaction` with `SELECT 1 FROM "TenantUser" WHERE tenant_id = … AND user_id = … FOR UPDATE`, as `PaymentMethodsService.writeLayout` does.
  - Unknown alert types are filtered against `ALERT_TYPES` from `src/alerts/alert-types.ts`.
- [ ] **Step 4: Run it and confirm it passes.** Same command. Expected: PASS.
- [ ] **Step 5: Commit.** `feat(preferences): resolve and save a member's own preferences`

### Task 4: `/preferences/me` endpoints and module

**Files:**
- Create: `apps/backend/src/preferences/preferences.controller.ts`, `apps/backend/src/preferences/preferences.controller.spec.ts`, `apps/backend/src/preferences/preferences.module.ts`
- Modify: `apps/backend/src/app.module.ts`, `apps/backend/src/auth/route-authorization.baseline.ts`

**Interfaces:**
- Consumes: `PreferencesService` (Task 3).
- Produces: `GET /preferences/me` returns `MyPreferencesResponse`; `PATCH /preferences/me/:section` and `DELETE /preferences/me/:section` return `{ value, source }`. The module exports `PreferencesService` (used by Tasks 5–7).

- [ ] **Step 1: Write the failing spec:**
  - `GET passes tenant.tenantId and tenant.userId`;
  - `PATCH rejects a section outside PERSON_SECTIONS with 400`;
  - `DELETE calls resetSection`.
- [ ] **Step 2: Run it and confirm it fails.** `npx jest --maxWorkers=2 --workerIdleMemoryLimit=600MB src/preferences/preferences.controller.spec.ts src/auth/route-authorization.spec.ts`. Expected: FAIL. The controller is missing, and the route scan flags three new open routes.
- [ ] **Step 3: Implement.** `@Controller('preferences') @UseGuards(JwtAuthGuard) @UseInterceptors(TenantInterceptor)` with no permission decorator. Register `PreferencesModule` in `app.module.ts`. Add the three `PreferencesController.*` entries to `OPEN_ROUTES` with the reason `"self-scoped: acts only on the signed-in member’s own data"`.
- [ ] **Step 4: Run it and confirm it passes.** Same command. Expected: PASS.
- [ ] **Step 5: Commit.** `feat(preferences): /preferences/me endpoints`

### Task 5: Profiles — create, edit, delete and apply

**Files:**
- Create: `apps/backend/src/preferences/preference-profiles.service.ts`, `preference-profiles.controller.ts`, `preference-profiles.dto.ts`, `preference-profiles.service.spec.ts`
- Modify: `apps/backend/src/preferences/preferences.module.ts`

**Interfaces:**
- Consumes: `normalizeProfilePrefs`, `normalizeSectionPartial`, `PERSON_SECTIONS`, `PreferenceProfileSummary` and `PreferenceProfileDetail` (Task 1); `AuditService` (inject it as `TeamService` does).
- Produces:

```ts
class CreatePreferenceProfileDto { name: string /* trimmed, 1–60 */; is_default?: boolean; sections?: Record<string, unknown> }
class UpdatePreferenceProfileDto { name?: string; is_default?: boolean; sections?: Record<string, unknown | null> }
class ApplyPreferenceProfileDto { sections: PersonSectionKey[] /* non-empty */; user_ids?: string[] }
// Routes, each with @RequireStorePermission(StorePermission.MANAGE_USERS):
// GET /preference-profiles · GET /preference-profiles/:id · POST /preference-profiles
// PATCH /preference-profiles/:id · DELETE /preference-profiles/:id · POST /preference-profiles/:id/apply → { updated: number }
```

- [ ] **Step 1: Write the failing spec:**
  - `create normalises sections and drops unknown keys`;
  - `a duplicate name → ConflictException`;
  - `setting is_default clears it on the others in one transaction`;
  - `a foreign id → NotFoundException`;
  - `delete leaves roles to fall back`: `delete` is called and nothing else is touched;
  - `apply without user_ids targets members whose primary role uses this profile`;
  - `apply on the default profile also targets members whose role has none and members with no role`;
  - `apply never targets the caller unless listed`;
  - `apply with user_ids ignores ids outside the tenant`;
  - `apply clears invoice_print_prefs, deletes alert rows, removes preference keys and legacy entries only for the chosen sections`;
  - `apply rejects 'device'`;
  - `every write is audited`, with actions `PREFERENCE_PROFILE_CREATED`, `_UPDATED`, `_DELETED` and `_APPLIED`; the last carries `user_ids` and `sections`.
- [ ] **Step 2: Run it and confirm it fails.** `npx jest --maxWorkers=2 --workerIdleMemoryLimit=600MB src/preferences/preference-profiles.service.spec.ts src/auth/route-authorization.spec.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** `PATCH` sections: a key set to `null` removes that section, and any other value replaces it after `normalizeSectionPartial`. `apply` runs in one `$transaction`, updating each target row.
- [ ] **Step 4: Run it and confirm it passes.** Same command. Expected: PASS. The route scan passes too, because the routes carry a permission decorator.
- [ ] **Step 5: Commit.** `feat(preferences): preference profiles with apply`

### Task 6: Invoice print through the lookup

**Files:**
- Modify: `apps/backend/src/sales-settings/sales-settings.service.ts`, `sales-settings.module.ts`, `sales-settings.service.spec.ts`

**Interfaces:**
- Consumes: `PreferencesService.resolveFor`, `saveSection` (Tasks 3–4).
- Produces: unchanged signatures `getMemberInvoicePrint(tenantId, userId): Promise<InvoicePrintPrefs>` and `updateMemberInvoicePrint(tenantId, userId, dto): Promise<InvoicePrintPrefs>`.

- [ ] **Step 1: Update and extend the spec.** Replace the existing "merges the change onto what the member already saved" case with `stores only the submitted fields`. Add:
  - `a new member gets the profile's layout`;
  - `a filled-out pre-release blob wins over a profile that sets footer_text, table_borders and signature_space_mm` (the KH Tradind case);
  - `no profile → exactly normalizeInvoicePrintPrefs(stored)`.
- [ ] **Step 2: Run it and confirm it fails.** `npx jest --maxWorkers=2 --workerIdleMemoryLimit=600MB src/sales-settings`. Expected: FAIL.
- [ ] **Step 3: Implement** by delegating to `PreferencesService` and returning `sections.invoicePrint.value`. Import `PreferencesModule` in `SalesSettingsModule`.
- [ ] **Step 4: Run it and confirm it passes.** Same command. Expected: PASS.
- [ ] **Step 5: Commit.** `feat(sales-settings): member invoice print resolves through profiles`

### Task 7: Alerts through the lookup

**Files:**
- Modify: `apps/backend/src/alerts/alerts.controller.ts`, `alerts.module.ts`, `apps/backend/src/notifications/alert-policy.ts`, and the policy's spec. Create `alert-policy.spec.ts` beside it if none exists.

**Interfaces:**
- Consumes: `PreferencesService.profileFor`, `saveSection(…, 'alerts', …)`.
- Produces: unchanged response of `GET /alerts/preferences` (`{ types, muted_types, quiet: { enabled, from: 'HH:MM', to: 'HH:MM' }, thresholds }`).

- [ ] **Step 1: Write the failing tests:**
  - `describe: no row → profile quiet hours and mutes`;
  - `describe: a row wins`;
  - `PUT {muted_types} on a member with no row keeps the profile's quiet hours`;
  - `decide: no row and profile mutes LARGE_SALE → 'skip'`;
  - `decide: one profile lookup per (tenant,user) within a dispatch`.
- [ ] **Step 2: Run them and confirm they fail.** `npx jest --maxWorkers=2 --workerIdleMemoryLimit=600MB src/alerts src/notifications`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - `updatePreferences` converts clocks to minutes and calls `saveSection('alerts', { mutedTypes, quiet })`.
  - `describe` and `AlertPolicyService` read the row, then `profileFor(...).prefs.sections.alerts`, then `DEFAULT_ALERT_PREFS`.
  - Cache the profile lookup in a `Map` passed through or held per call of the dispatching method. The builder chooses the exact place, but it must satisfy the last test.
- [ ] **Step 4: Run them and confirm they pass.** Same command. Expected: PASS.
- [ ] **Step 5: Commit.** `feat(alerts): alert preferences fall back to the member's profile`

### Task 8: Roles carry a default profile

**Files:**
- Modify: `apps/backend/src/team/team.dto.ts`, `team.service.ts`, `team.service.spec.ts`

**Interfaces:**
- Produces:
  - `CreateTenantRoleDto.preference_profile_id?: string | null` and `UpdateTenantRoleDto.preference_profile_id?: string | null` (`@IsOptional() @IsUUID()`, nullable).
  - The `listRoles` items gain `preference_profile: { id: string; name: string } | null`.

- [ ] **Step 1: Write the failing tests:**
  - `listRoles includes the profile`;
  - `updateRoleTemplate sets and clears preference_profile_id`;
  - `a profile id from another tenant → BadRequestException`;
  - `a non-owner cannot set it`, using the existing owner assertion.
- [ ] **Step 2: Run them and confirm they fail.** `npx jest --maxWorkers=2 --workerIdleMemoryLimit=600MB src/team`. Expected: FAIL.
- [ ] **Step 3: Implement** in `createRole`, `updateRoleTemplate` and `listRoles` (add `preferenceProfile: { select: { id, name } }` to its `include`).
- [ ] **Step 4: Run them and confirm they pass.** Same command. Expected: PASS.
- [ ] **Step 5: Commit.** `feat(team): roles carry a default preference profile`

### Task 9: New accounts start in the workspace language

**Files:**
- Create: `apps/backend/src/preferences/new-account-locale.ts`, `new-account-locale.spec.ts`
- Modify: `apps/backend/src/invitations/invitations.service.ts` (`acceptWithSignup`), `apps/backend/src/employee-portal/employee-login.service.ts` (`create`), and both specs

**Interfaces:**
- Produces: `export function newAccountLocale(tenant: { default_locale: string; localization_enabled: boolean }): string`.

- [ ] **Step 1: Write the failing tests:**
  - `newAccountLocale({ default_locale: 'bn', localization_enabled: true }) === 'bn'`;
  - `… localization_enabled: false → 'en'`;
  - invitations: `acceptWithSignup creates the user with the tenant's language`;
  - employee login: `create sets preferred_locale from the tenant`;
  - invitations: `accept for an existing account does not touch preferred_locale`.
- [ ] **Step 2: Run them and confirm they fail.** `npx jest --maxWorkers=2 --workerIdleMemoryLimit=600MB src/preferences/new-account-locale.spec.ts src/invitations src/employee-portal/employee-login.service.spec.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** Read `tenant { default_locale, localization_enabled }` inside the existing transaction and pass `preferred_locale` to `user.create`.
- [ ] **Step 4: Run them and confirm they pass.** Same command. Expected: PASS.
- [ ] **Step 5: Commit.** `feat(auth): new staff accounts start in the workspace language`

---

## Phase 2 — Frontend store and hooks

### Task 10: Preferences store, legacy reader and loader

**Files:**
- Create: `apps/frontend/src/lib/preferences/store.ts`, `legacy.ts`, `use-preferences-loader.ts`, `use-preference-section.ts`, `store.test.ts`, `legacy.test.ts`
- Modify: `apps/frontend/src/lib/api.ts`, `apps/frontend/src/app/(app)/layout.tsx`

**Interfaces:**
- Consumes: `MyPreferencesResponse`, `SectionValues`, `resolvePreferences` and `LEGACY_BROWSER_SECTIONS` (Task 1); the endpoints from Tasks 4–5.
- Produces:

```ts
// lib/api.ts
getMyPreferences(): Promise<MyPreferencesResponse>
saveMyPreferenceSection(section: PersonSectionKey, body: unknown): Promise<{ value: unknown; source: PreferenceSource }>
resetMyPreferenceSection(section: PersonSectionKey): Promise<{ value: unknown; source: PreferenceSource }>
getPreferenceProfiles(): Promise<PreferenceProfileSummary[]>
getPreferenceProfile(id: string): Promise<PreferenceProfileDetail>
createPreferenceProfile(body: { name: string; is_default?: boolean; sections?: SectionPartials }): Promise<PreferenceProfileDetail>
updatePreferenceProfile(id: string, body: { name?: string; is_default?: boolean; sections?: Record<string, unknown | null> }): Promise<PreferenceProfileDetail>
deletePreferenceProfile(id: string): Promise<void>
applyPreferenceProfile(id: string, body: { sections: PersonSectionKey[]; user_ids?: string[] }): Promise<{ updated: number }>
// lib/preferences/legacy.ts
readLegacyBrowserSection(key: LegacyBrowserSection, userKey: string): unknown | undefined
// tableView ← `erp71:table-view:<userKey>`; tableColumns ← `data-table-preferences` (columnVisibility false → hidden, columnOrder → order, pageSize; widths ignored);
// sidebar ← `app-shell-open-groups` (Record<string,boolean> → keys that are true)
// lib/preferences/store.ts
export const usePreferencesStore: UseBoundStore<StoreApi<{
  ready: boolean; scopeKey: string | null; data: MyPreferencesResponse | null;
  hydrate(scopeKey: string, data: MyPreferencesResponse): void; clear(): void;
  save<K extends PersonSectionKey>(key: K, body: unknown, optimistic: SectionValues[K]): void; // debounced PATCH per section
  reset(key: PersonSectionKey): Promise<void>;
}>>
// lib/preferences/use-preference-section.ts
usePreferenceSection<K extends PreferenceSectionKey>(key: K): { ready: boolean; value: SectionValues[K]; source: PreferenceSource }
// lib/preferences/use-preferences-loader.ts
usePreferencesLoader(enabled: boolean): void
// react-query key ['preferences-me', ...workspaceScope()]; caches the response at `erp71:prefs:<tenantId>:<userId>`
```

- [ ] **Step 1: Write the failing tests:**
  - `legacy.test.ts`:
    - `maps data-table-preferences visibility to hidden and drops widths`;
    - `maps app-shell-open-groups to the open keys`;
    - `returns undefined on bad JSON or blocked storage`.
  - `store.test.ts`:
    - `hydrate marks ready`;
    - `usePreferenceSection applies the legacy value only for a listed section`;
    - `ignores legacy keys for an unlisted section`;
    - `save is optimistic and PATCHes once after the debounce`;
    - `a failed save rolls back and raises a toast through the global store`;
    - `reset calls DELETE, replaces the section and drops it from legacy_browser_sections`;
    - `clear on workspace change`.
- [ ] **Step 2: Run them and confirm they fail.** `cd apps/frontend && npx jest --maxWorkers=2 --workerIdleMemoryLimit=600MB src/lib/preferences`. Expected: FAIL.
- [ ] **Step 3: Implement.** Mount `usePreferencesLoader(!inPlatformAdminMode && !inRefereeMode && !inEmployeeMode && Boolean(activeTenant))` in `(app)/layout.tsx` next to the `salesSettingsQuery`. Seed the first paint from the cached response.
- [ ] **Step 4: Run them and confirm they pass.** Same command. Expected: PASS.
- [ ] **Step 5: Commit.** `feat(preferences): frontend store, legacy reader and loader`

### Task 11: List view settings follow the person

**Files:**
- Modify: `apps/frontend/src/components/table/useTableViewSettings.ts` and its tests (`components/data-table/DataTable.view-options.test.tsx`, plus a new `components/table/useTableViewSettings.test.ts`)

**Interfaces:**
- Consumes: `usePreferenceSection('tableView')`, `usePreferencesStore.save` (Task 10).
- Produces: unchanged `useTableViewSettings(tableId)` → `{ settings, isOverridden, update, setOverride, reset }`.

- [ ] **Step 1: Write the failing tests:**
  - `reads global and per-list values from the store when ready`;
  - `update with no override saves { global: patch }`;
  - `setOverride(true) saves { tables: { [id]: global } } and setOverride(false) saves { tables: { [id]: null } }`;
  - `falls back to erp71:table-view:<userKey> when the store is not loaded`.
- [ ] **Step 2: Run them and confirm they fail.** `npx jest --maxWorkers=2 --workerIdleMemoryLimit=600MB src/components/table src/components/data-table/DataTable.view-options.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement.** The hook reads the store when it is `ready`, and otherwise the current localStorage path, which stays for admin, referee and employee modes.
- [ ] **Step 4: Run them and confirm they pass.** Same command. Expected: PASS.
- [ ] **Step 5: Commit.** `feat(tables): list view settings follow the person`

### Task 12: List columns follow the person; no saves on open

**Files:**
- Modify: `apps/frontend/src/components/data-table/useTablePreferences.ts`, `DataTable.tsx`, `hooks/useServerList.ts`, plus the DataTable tests

**Interfaces:**
- Consumes: `usePreferenceSection('tableColumns')`, `save('tableColumns', { [tableId]: entry })`.
- Produces: an unchanged `useTablePreferences` API. `getPreferences(tableId)` returns `columnVisibility` (built from `hidden`), `columnOrder`, `pageSize` and `columnWidths` (still from `data-table-preferences`).

- [ ] **Step 1: Write the failing tests:**
  - `does not save on mount`: mount a `DataTable` with a `tableId`; there must be no `saveMyPreferenceSection` call and no write to `data-table-preferences` visibility, order or page size;
  - `hiding a column saves { [tableId]: { hidden, order, pageSize } }`;
  - `dragging a column saves the order`;
  - `changing page size saves pageSize`;
  - `resizing still writes widths to localStorage only`;
  - `re-seeds columns once when preferences become ready if the user has not changed them`;
  - `useServerList reads pageSize from the store`.
- [ ] **Step 2: Run them and confirm they fail.** `npx jest --maxWorkers=2 --workerIdleMemoryLimit=600MB src/components/data-table src/hooks/useServerList`. Expected: FAIL.
- [ ] **Step 3: Implement.** Remove the three persist effects at `DataTable.tsx` ~682–696. Write from the change handlers (`onColumnVisibilityChange`, the drag handler at ~765, the page-size handler at ~785). The width effect stays.
- [ ] **Step 4: Run them and confirm they pass.** Same command. Expected: PASS.
- [ ] **Step 5: Commit.** `feat(tables): column choices follow the person and save only on change`

### Task 13: Sidebar groups and collapsed default

**Files:**
- Modify: `apps/frontend/src/components/app-shell/AppShellSidebar.tsx`, `apps/frontend/src/components/Sidebar.tsx`, plus their tests

**Interfaces:**
- Consumes: `usePreferenceSection('sidebar')`, `usePreferenceSection('device')`, `save('sidebar', { appShellOpenGroups })`.

- [ ] **Step 1: Write the failing tests:**
  - `AppShellSidebar opens the profile's groups for a member with none saved`;
  - `toggleGroup saves appShellOpenGroups`;
  - `opening the current page's group on navigation saves nothing`;
  - `collapsed: browser value wins, else device.sidebarCollapsed, else expanded`, for both sidebars;
  - `classic Sidebar open groups unchanged (still sidebar-open-groups)`.
- [ ] **Step 2: Run them and confirm they fail.** `npx jest --maxWorkers=2 --workerIdleMemoryLimit=600MB src/components/app-shell src/components/Sidebar`. Expected: FAIL.
- [ ] **Step 3: Implement.** Convert between `Record<string, boolean>` and the `string[]` of open keys at the store boundary.
- [ ] **Step 4: Run them and confirm they pass.** Same command. Expected: PASS.
- [ ] **Step 5: Commit.** `feat(sidebar): app-shell groups follow the person; collapsed starts from the profile`

### Task 14: A new browser's print setup starts from the profile

**Files:**
- Modify: `apps/frontend/src/lib/hooks/useSalePrintPrefs.ts`, `lib/print/density.ts`, `lib/print/type-scale.ts`, plus their tests (`density.test.ts`, `type-scale.test.ts`, and a new `useSalePrintPrefs.test.ts` if none exists)

**Interfaces:**
- Consumes: `usePreferencesStore.getState().data?.sections.device.value` (read synchronously in the non-hook readers).
- Produces: unchanged `useSalePrintPrefs()`, `resolvePrintPaper()`, `readPrintDensity()` and `readPrintTypeScale()`.

- [ ] **Step 1: Write the failing tests:**
  - `paper: stored value → profile Thermal80 → shop default → A4`, one case per rung;
  - `density and type scale: stored → profile → normal`;
  - `skip preview: stored → profile → false`;
  - `nothing is written to localStorage when the profile value is used`;
  - `no profile device fields → today's behaviour exactly`.
- [ ] **Step 2: Run them and confirm they fail.** `npx jest --maxWorkers=2 --workerIdleMemoryLimit=600MB src/lib/print src/lib/hooks/useSalePrintPrefs`. Expected: FAIL.
- [ ] **Step 3: Implement.** Insert the profile rung between the stored value and the existing fallback. Keys, `postMessage` names and the setters are unchanged.
- [ ] **Step 4: Run them and confirm they pass.** Same command. Expected: PASS.
- [ ] **Step 5: Commit.** `feat(print): a new browser starts from the member's profile print setup`

---

## Phase 3 — Screens

### Task 15: Team → Default profiles tab and the profile editor

**Files:**
- Create: `apps/frontend/src/components/preferences/ProfilesPanel.tsx`, `ProfileEditorModal.tsx`, `ApplyProfileModal.tsx`, `copy-my-settings.ts`, plus tests for each
- Modify: `apps/frontend/src/app/(app)/team/page.tsx` (`TeamTab` gains `'profiles'`), and the `teamManagement` strings in `messages/<locale>/core.ts` × 9

**Interfaces:**
- Consumes: the Task 10 API methods; `InvoiceLayoutFields` (`value`, `onChange`, `onValidityChange`); the `TableViewOptions` controls; `usePreferencesStore`; `useSalePrintPrefs` (this browser's device values).
- Produces: `collectMySettings(sections: PreferenceSectionKey[]): SectionPartials`. For each section it returns what the caller sees now: the store value (including the legacy layer) for person sections, and this browser's values from `useSalePrintPrefs` and the sidebars for `device`.

- [ ] **Step 1: Write the failing tests:**
  - `tab shown to owner and MANAGE_USERS holders, hidden otherwise`;
  - `lists profiles with the default badge and role names`;
  - `New profile → create, then the editor opens`;
  - `editor saves invoice print, device, list view and alerts sections through updatePreferenceProfile`;
  - `columns and sidebar cards show "Set for N lists" and Clear sends { tableColumns: null }`;
  - `Copy from my settings sends collectMySettings for the chosen sections, legacy values included`;
  - `Apply modal names the sections and count, then calls applyPreferenceProfile`;
  - `a duplicate name shows an inline error, not a toast`.
- [ ] **Step 2: Run them and confirm they fail.** `npx jest --maxWorkers=2 --workerIdleMemoryLimit=600MB src/components/preferences`. Then `npx jest --maxWorkers=2 --runTestsByPath "src/app/(app)/team/page.test.tsx"`; create this test file if it does not exist. Expected: FAIL.
- [ ] **Step 3: Implement.** `ModalShell` for both modals and `PageHeader` actions for "New profile". Strings go in all nine locales.
- [ ] **Step 4: Run them and confirm they pass.** Same commands, plus `npx jest src/lib/localization/messages/catalog.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit.** `feat(team): default preference profiles tab and editor`

### Task 16: Role select and the invite line

**Files:**
- Modify: `apps/frontend/src/app/(app)/team/page.tsx` (`RolesPanel`, the invite form at ~931), `lib/api.ts` (`createTeamRole` and `updateTeamRole` accept `preference_profile_id`), and the strings × 9

**Interfaces:**
- Consumes: `listRoles` item `preference_profile` (Task 8); `getPreferenceProfiles` (Task 10).

- [ ] **Step 1: Write the failing tests:**
  - `role editor shows a Default profile select with None meaning the workspace default`;
  - `saving sends preference_profile_id (null for None)`;
  - `invite form shows "Starts with: <profile>" for the chosen primary role, the workspace default when the role has none, and nothing when neither exists`.
- [ ] **Step 2: Run them and confirm they fail.** `npx jest --maxWorkers=2 --runTestsByPath "src/app/(app)/team/page.test.tsx"`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them and confirm they pass.** Same command, plus the catalog test. Expected: PASS.
- [ ] **Step 5: Commit.** `feat(team): roles pick a default profile; invites show it`

### Task 17: My preferences

**Files:**
- Create: `apps/frontend/src/components/preferences/MyPreferencesSection.tsx`, plus its test
- Modify: `apps/frontend/src/app/(app)/profile/page.tsx`, `app/(app)/sales/components/PrintSettingsModal.tsx`, `lib/hooks/useInvoicePrintPrefs.ts` (export `reloadInvoicePrintPrefs()` if it has no reload), and the strings × 9 (`profile` and `sales.printSettings` namespaces)

**Interfaces:**
- Consumes: `usePreferenceSection`, `usePreferencesStore.reset`.

- [ ] **Step 1: Write the failing tests.** Each person section shows one of these lines:
  - "Following <profile> default";
  - "Using the built-in setting";
  - "Customised · Reset";
  - "Set on this browser · Reset".

  Then:
  - `Reset calls reset(key)`;
  - `resetting invoicePrint reloads the invoice print hook`;
  - `PrintSettingsModal shows the same line for invoicePrint`.
- [ ] **Step 2: Run them and confirm they fail.** `npx jest --maxWorkers=2 src/components/preferences/MyPreferencesSection` and `npx jest --maxWorkers=2 --runTestsByPath "src/app/(app)/profile/page.test.tsx"`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them and confirm they pass.** Same commands, plus the catalog test. Expected: PASS.
- [ ] **Step 5: Commit.** `feat(profile): my preferences with per-section reset`

### Task 18: Release checks

**Files:**
- Modify: `TODO.md` (move the ROADMAP item to COMPLETED with a dated note; add follow-ups found)

- [ ] **Step 1: Run the affected suites, in sequence and never in parallel:**
  - shared-types: `npx jest`;
  - backend: `npx jest --maxWorkers=2 --workerIdleMemoryLimit=600MB src/preferences src/sales-settings src/alerts src/notifications src/team src/invitations src/employee-portal src/auth src/common`;
  - frontend: `npx jest --maxWorkers=2 --workerIdleMemoryLimit=600MB src/lib/preferences src/components/preferences src/components/table src/components/data-table src/components/app-shell src/lib/print src/lib/hooks src/lib/localization`, plus the three `--runTestsByPath` page tests.

  Expected: all PASS.
- [ ] **Step 2: Typecheck and lint.** `npx tsc --noEmit -p apps/backend`, `npx tsc --noEmit -p apps/frontend`, then `cd apps/frontend && npx next lint --quiet`. Expected: clean.
- [ ] **Step 3: Check the invoice regression.** With no profile, `getMemberInvoicePrint` for every pre-release blob shape returns exactly `normalizeInvoicePrintPrefs(blob)`. The cases are: `{version:1}`, one with `hide_empty_warranty: true`, one with `footer_text: ''`, and one full set. Confirm this is covered by Task 6's tests. If any shape is missing, add it there.
- [ ] **Step 4: Update `TODO.md` and commit.** `chore(todo): default preference profiles done`
- [ ] **Step 5: Write the post-deploy check for the user.** It is a script the user runs: `GET /preferences/me` for one existing member of KH Tradind returns `source` `default` or `member` for every section and lists the three legacy sections, followed by a `/health` check. Production reads from a session are blocked, so hand it over rather than run it.
