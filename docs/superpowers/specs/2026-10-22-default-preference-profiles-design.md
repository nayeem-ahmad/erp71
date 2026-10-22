# Default preference profiles for new staff

**Date:** 2026-10-22
**Status:** Draft pending review
**Asked as:** "How can we have a default user profile so that a new user gets
a ready state to start with? Example settings that should be part of the
default pack: print settings, UI settings and so on." The user here is a new
staff member joining an existing workspace, not a new business.

## Decisions

The user skipped the design questions and accepted the outline plan given in
chat on 2026-10-20. The calls below are mine, made in that plan or while
writing this spec, and are open to correction:

1. **Lookup at read time, not a copy at invite.** A setting resolves as
   *the member's own choice → their primary role's profile → the workspace
   default profile → built-in*. Nothing is copied when a membership is made.
2. **Profiles attach to roles**, plus at most one workspace default.
3. **Person settings follow the person; device settings stay with the
   browser.** Paper size, print density, print text size and "skip preview"
   are per browser on purpose (`lib/print/density.ts`, `useSalePrintPrefs`:
   "they describe the printer sitting next to this browser"). A profile only
   supplies their starting value on a browser that has none.
4. **Language is not in profiles.** The workspace already has
   `Tenant.default_locale`. Instead, an account *created* by joining a
   workspace starts in that workspace's language (changed from the chat plan,
   which proposed copying a profile language).
5. **Existing members see no change on release day.** Their browser-only
   settings keep showing, section by section, until they change that
   section, reset it, or an admin applies a profile to it (§6).
   Invoice layouts saved before release are filled out to complete sets once,
   so a later profile cannot change a live tenant's invoices.
6. **Reuse `MANAGE_USERS`** for managing profiles; no new permission.
7. **The Flutter app is out of scope**, apart from what it inherits through
   `/alerts/preferences` (§4.4).

---

## Problem

1. **A new member starts from built-in defaults.** Every per-member setting
   that exists (`TenantUser.invoice_print_prefs`,
   `TenantUser.payment_method_prefs`, `UserAlertPreference`) is null or
   absent for a new member, and the shop has no way to say what "new" should
   look like. An owner who wants every cashier on the detailed invoice with
   the balance always printed has to sit at each cashier's login and set it.
2. **Most UI settings live only in the browser**, so nobody can set them for
   someone else and they do not follow a person to another device:
   - `components/table/useTableViewSettings.ts` — list density, text size,
     striping, fit-to-width, per-list overrides. Keyed per user in
     `localStorage` (`erp71:table-view:<userKey>`); its own comment says
     moving it to the server "is the next step".
   - `components/data-table/useTablePreferences.ts` — per list: visible
     columns, column order, page size, column widths
     (`data-table-preferences`, one blob for the whole browser, ~100 lists).
   - `components/Sidebar.tsx` (`sidebar-collapsed`, `sidebar-width`,
     `sidebar-open-groups`) and `components/app-shell/AppShellSidebar.tsx`
     (`app-shell-collapsed`, `app-shell-panel-width`,
     `app-shell-open-groups`) — the layout renders one or the other
     depending on `platformFeatures.appShell`.
   - Print: `erp71:sales-print:paper-size`, `erp71:sales-print:skip-preview`,
     `erp71:print:density`, `erp71:print:type-scale`.
3. **Shared counter PCs leak one person's browser settings to the next.**
   A new cashier on an old till inherits whatever columns and open sidebar
   groups the previous person left there.
4. **A new account always starts in English.** `User.preferred_locale`
   defaults to `en` and neither `InvitationsService.acceptWithSignup` nor
   `EmployeeLoginService.create` sets it, so a Bangla workspace's new
   cashier lands in English (the layout uses
   `localStorage.locale || user.preferred_locale`).

## Goals

- An owner or user manager builds a profile once ("Cashier", "Accountant")
  and attaches it to roles. A member who has not changed a setting gets it
  from their role's profile, on any device, from their first sign-in.
- A member's own change always wins and follows them to any device in that
  workspace.
- A browser with no stored print setup starts from the signed-in member's
  profile instead of the shop default or A4.
- An admin can, on purpose, send chosen members back to the profile.
- With no profile saved, every screen and every printout is exactly what it
  is today.

## Non-goals

- Workspace-wide settings that already have a tenant level: letterheads and
  print templates, `SalesSettings`, the nav layout (`TenantNavLayout`),
  document numbering.
- Locking a setting so a member cannot change it.
- An admin editing one named member's preferences field by field (they can
  only send members back to the profile with Apply).
- Choosing a profile per invitation. The role decides.
- Payment-method layouts, report defaults (`lib/accounting-report-scope.ts`),
  CRM views (`lib/crm-scope.ts`, `crm-activity-layout.ts`,
  `use-leads-view.ts`) and project board views. They fit the same registry
  later; see Phase 4.
- The `locale` key a shared browser keeps from the previous person.
- The Flutter app's own settings screens.

## Anti-goals

- A profile change silently overwriting what a member chose themselves.
- KH Tradind's invoices (or any live tenant's) printing differently on
  release day. Their members' saved `invoice_print_prefs` are full sets and
  must keep winning.
- Any print, list or sidebar failing because a preference could not be read.
  Every reader falls back; nothing throws.
- An extra request per screen. Preferences load once per workspace session.
- One cashier's leftover browser settings becoming a *new* cashier's
  settings after this ships.

---

## Design

### 1. Sections

A **section** is one group of settings with one normaliser and one place
the member's own answers are stored.

| Key | Kind | Contents | Member's own answers live in |
|---|---|---|---|
| `invoicePrint` | person | `InvoicePrintPrefs` fields | `TenantUser.invoice_print_prefs` (existing) |
| `tableView` | person | `global: TableViewSettings`, `tables: { [tableId]: TableViewSettings }` | `TenantUser.preferences.tableView` |
| `tableColumns` | person | `{ [tableId]: { hidden?: string[]; order?: string[]; pageSize?: number } }` | `TenantUser.preferences.tableColumns` |
| `sidebar` | person | `appShellOpenGroups?: string[]` | `TenantUser.preferences.sidebar` |
| `alerts` | person | `mutedTypes: string[]`, `quiet: { enabled, from, to }` (minutes) | `UserAlertPreference` row (existing) |
| `device` | device | `paperSize`, `printDensity`, `printTypeScale`, `skipPreview`, `sidebarCollapsed` | the browser, under today's keys |

Stays per browser and is **not** in a profile: column widths, sidebar and
panel widths, the till's `counter_id`, floating-panel positions, dismissed
help panels, the demo banner.

`tableColumns.hidden` replaces today's `columnVisibility` map. A profile
lists what is hidden, so a column added to a list later shows by default.

The classic `Sidebar.tsx` keeps its open groups in the browser and out of
profiles: it reopens the current page's group and rewrites
`sidebar-open-groups` on every navigation (an accordion), so a stored value
would be overwritten on the first page load and would cost a save per
navigation. `AppShellSidebar` adds to its open groups only when the user
toggles one, so its set means something.

**Saves happen only on a user's own change.** A hook must never write a
section when it loads or when it reconciles state on mount. `DataTable`
writes visibility, order and page size when a list opens today; on the
server that would freeze profile values into members' own answers, so that
write must go.

### 2. Resolution

**Person sections**, for member M in workspace T:

```text
built-in  ←  workspace default profile  OR  M's role profile  ←  [legacy browser value]  ←  M's own
```

- **Which profile.** `TenantRole.preference_profile_id` of M's primary
  role (`TenantUser.tenant_role_id`). If that role has none, or M has no
  role (an owner, an employee-portal login), the workspace default profile.
  If there is no default, none.
- **Merging.** Flat objects (`invoicePrint`, `tableView.global`, `alerts`,
  `device`) merge field by field: a later layer's field replaces an earlier
  one's, and a field a layer does not set falls through. A per-list entry
  inside `tableView.tables` or `tableColumns` is replaced whole. Arrays
  are replaced whole.
- **Stale references are skipped.** A column id the list no longer has, a
  sidebar group that no longer exists, or an unknown alert type is dropped
  on read, never an error.
- **Source.** Each resolved section reports `source`: `member` if M's own
  layer sets any field, `browser` if a legacy browser value is in use,
  otherwise `profile` if the profile does, otherwise `default`. The UI uses
  it for "Following Cashier default", "Customised · Reset" and "Set on this
  browser · Reset".
- **Legacy browser value**: only for the sections still listed in M's
  `legacy_browser_sections` (§6).

**Device section**, on browser B:

```text
paper size:   B's stored value → M's profile device.paperSize → SalesSettings paper size → A4
density etc.: B's stored value → M's profile value → built-in
```

The profile value is used, not written into B. B stores something only when
someone changes it on B, as today. So a fresh till shows a cashier the
Cashier profile's print setup and a manager the Manager profile's, until
someone picks a setup on that till. `GET /preferences/me` returns only the
device fields the profile actually sets, never a built-in value: a built-in
A4 there would override the shop's `SalesSettings` paper size.

**Alerts** keep today's row semantics: an existing `UserAlertPreference`
row is the member's whole answer (its columns are all non-null), so the
profile applies only when there is no row.

**Invoice print.** A blob saved before release holds the fields that existed
when it was saved. `warranty_column` (added 2026-10-06), `table_borders`
(10-07) and `signature_space_mm` (10-15) are missing from older ones, and a
missing field prints today as the built-in default. So the release's sync
(§6) rewrites every non-null `invoice_print_prefs` once as
`normalizeInvoicePrintPrefs(blob)`, a complete set. That is exactly what it
prints today, and from then on no profile can change it. After release:

- a key that is present is an answer, **including `null`**:
  `footer_text: null` means the built-in thank-you line and
  `signature_space_mm: null` the built-in gap, so neither falls through to
  the profile;
- a key that is absent falls through;
- a save merges only the submitted fields into the member's stored layer,
  not into the resolved value, so profile values are never frozen into a
  member's own answers.

### 3. Shared types — `packages/shared-types/preferences.ts`

- `PREFERENCE_SECTIONS` and per-section types, built-in defaults, and two
  normalisers per section: `normalizeXPartial(raw): Partial<X>` keeps only
  fields that are present and valid, and `normalizeX(raw): X` returns a
  complete set. `invoicePrint` gains `normalizeInvoicePrintPrefsPartial`
  in `invoice-print.ts`.
- Move `TableViewSettings`, `DEFAULT_TABLE_VIEW` and `sanitizeTableView`
  from `apps/frontend/src/components/table/view-settings.ts` into shared-types
  (the frontend re-exports them), so the API validates against the same rules,
  as `invoice-print.ts` already does.
- `PreferenceProfilePrefs = { version: 1; sections: { [K in SectionKey]?: Partial<…> } }`
  and `MemberPreferences = { version: 1; tableView?; tableColumns?; sidebar? }`.
- `resolvePreferences({ profile, member, legacy? })` →
  `{ [K]: { value, source } }`. It is pure, used by the API and the
  frontend, and handles every merge rule in §2.
- Limits, enforced by the normalisers: list ids match
  `/^[a-z0-9][a-z0-9_.:-]{0,79}$/`, at most 300 lists per map, at most 100
  column ids per list, page size within the list's allowed sizes, at most
  50 sidebar group ids.

Exported from `packages/shared-types/index.ts`. Remember
`npm run build --workspace packages/shared-types` before backend and
frontend runs.

### 4. Backend

#### 4.1 Schema (`packages/database/prisma/schema.prisma`)

```prisma
/// A starting set of a member's own preferences — invoice print, lists,
/// sidebar, alerts and a new browser's print setup — that an owner builds once
/// and attaches to roles. Read at lookup time, never copied onto members: a
/// member who has not changed a setting follows the profile as it changes.
model PreferenceProfile {
  id         String   @id @default(uuid())
  tenant_id  String
  name       String
  /// The profile for members whose role has none. At most one per tenant,
  /// kept so in the service as PrintTemplate.is_default is.
  is_default Boolean  @default(false)
  /// PreferenceProfilePrefs JSON — see packages/shared-types/preferences.ts.
  prefs      Json
  created_at DateTime @default(now())
  updated_at DateTime @updatedAt
  updated_by String?

  tenant Tenant       @relation(fields: [tenant_id], references: [id], onDelete: Cascade)
  roles  TenantRole[]

  @@unique([tenant_id, name])
  @@index([tenant_id])
  @@map("preference_profiles")
}
```

- `TenantRole.preference_profile_id String?` → `PreferenceProfile`,
  `onDelete: SetNull`.
- `TenantUser.preferences Json?`: the member's own answers for the sections
  that have no column of their own (`MemberPreferences`).
- `TenantUser.legacy_browser_sections String[] @default([])`: the person
  sections that still read this member's old browser values (§6).
- `Tenant.preferenceProfiles PreferenceProfile[]` back-relation.

Production applies the schema with `db push` in
`apps/backend/scripts/db-prepare.sh`, so every change is additive. Also
write the migration for local and dev databases, as the repo expects.

#### 4.2 `apps/backend/src/preferences/` (new module)

`PreferencesService`:

- `profileFor(tenantId, userId)`: one query, the membership with
  `tenantRole.preferenceProfile`, falling back to the tenant's
  `is_default` profile.
- `resolveFor(tenantId, userId)`: reads `TenantUser.preferences`,
  `invoice_print_prefs`, `legacy_browser_sections`, the
  `UserAlertPreference` row and the profile, then calls
  `resolvePreferences`.
- `saveSection(tenantId, userId, key, partial)`: validates with the
  section's partial normaliser and merges into the member's own layer. For
  keys in `TenantUser.preferences` it locks the row first, as
  `PaymentMethodsService.writeLayout` does, so two devices saving different
  sections do not overwrite each other. `invoicePrint` writes
  `invoice_print_prefs`; `alerts` upserts the `UserAlertPreference` row;
  `device` is refused (400): it is never stored on the server for a member.
- `resetSection`: removes the key, sets `invoice_print_prefs` to null, or
  deletes the alert row.
- Saving, resetting or applying a section also removes it from
  `legacy_browser_sections`, in the same write.

`PreferencesController` (`@Controller('preferences')`, `JwtAuthGuard`,
`TenantInterceptor`, no store permission: it only ever touches the caller's
own membership):

- `GET /preferences/me` →
  `{ profile: { id, name } | null, legacy_browser_sections, sections: { [key]: { value, source } } }`.
  `device` holds only the fields the profile sets, for the frontend to use
  when the browser has nothing stored. The server resolves without the
  browser layer, which only the frontend can add.
- `PATCH /preferences/me/:section` (partial body) → that section, resolved.
- `DELETE /preferences/me/:section` → that section, resolved.

`PreferenceProfilesController` (`@Controller('preference-profiles')`,
`@RequireStorePermission(MANAGE_USERS)`; owners pass the guard as
everywhere else):

- `GET /` → `[{ id, name, is_default, roles: [{ id, name }], updated_at }]`.
- `GET /:id` → the profile with its resolved sections.
- `POST /` `{ name, is_default?, sections? }`; `PATCH /:id` (each
  section sent replaces that section; `null` clears it); `DELETE /:id`.
  Setting `is_default` clears it on the others in the same transaction.
  Sections are validated with the same partial normalisers.
- There is no capture endpoint. "Copy from my settings" (§5.3) is the
  frontend sending the values the admin currently sees, browser-only ones
  included, through `PATCH /:id`. A capture done on the server would copy
  built-in values for every admin whose setup still lives only in the
  browser.
- `POST /:id/apply` `{ sections: SectionKey[], user_ids?: string[] }`:
  clears those sections from the members' own answers and from their
  `legacy_browser_sections`, so they follow the profile again. Without
  `user_ids` it targets every member whose resolved profile is this one. It
  never touches the caller unless they are listed. It returns
  `{ updated }`. This is the only path that changes other members'
  preferences, and it is always an explicit admin action.
- Names are unique per tenant (409). Every query is scoped by `tenant_id`;
  a foreign profile id is 404.
- Audit (`AuditService.log`): `PREFERENCE_PROFILE_CREATED`, `_UPDATED`,
  `_DELETED`, `_APPLIED` (with `user_ids` and `sections`).

#### 4.3 Existing endpoints that change

- `SalesSettingsService.getMemberInvoicePrint`: returns the resolved
  `invoicePrint` (member → profile → built-in). `updateMemberInvoicePrint`
  merges the submitted fields into the stored member layer (§2). The
  response shape is unchanged, so the print code does not change.
- `TeamService.listRoles`, `createRole`, `updateRoleTemplate` and their
  DTOs: add `preference_profile_id` (nullable; must belong to the tenant,
  otherwise 400). Role editing stays owner-only as today.
- `InvitationsService.acceptWithSignup` and `EmployeeLoginService.create`:
  set `preferred_locale` to the tenant's `default_locale` when
  `localization_enabled`, otherwise `en`. An existing account accepting an
  invite is untouched.

#### 4.4 Alerts

- `AlertsController.describe` and `AlertPolicyService.decide` /
  `isQuietFor`: when the member has no `UserAlertPreference` row, use the
  profile's `alerts` before `DEFAULT_QUIET` and no muted types. With a
  row, nothing changes.
- The push path gains one query, and only for members with no row. It is
  cached per `(tenantId, userId)` for the length of one dispatch.
- `PUT /alerts/preferences` sends partial bodies (the Flutter app sends one
  field at a time). When it creates a member's first row, the row starts
  from the member's resolved values, not the column defaults, so muting one
  type does not drop the profile's quiet hours.
- The Flutter app reads `/alerts/preferences` and so shows profile values
  without any change.

### 5. Frontend

#### 5.1 Store — `apps/frontend/src/lib/preferences/`

- `usePreferencesStore` (zustand): `load()`, `section(key)`,
  `save(key, partial)` and `reset(key)`. Saves are optimistic, debounced
  per section (builder's choice of delay), and roll back with a toast on
  failure.
- Loaded from `(app)/layout.tsx` once the workspace is resolved and
  reloaded when `workspaceEpoch` changes. The last response is cached in
  `localStorage` under `erp71:prefs:<tenantId>:<userId>` for the first
  paint. Hooks keep reading after mount, as they do now, to avoid hydration
  mismatches.
- Not loaded in platform-admin, referee or employee-portal mode. Lists and
  the sidebar there keep today's browser storage, so every converted hook
  falls back to its current `localStorage` behaviour when the store is not
  loaded.

#### 5.2 Hooks that move onto it

- `useTableViewSettings` reads and writes `tableView`. Per its own comment,
  this store is the only thing that has to learn about the move.
- `useTablePreferences`: visibility (as `hidden`), order and page size go
  through `tableColumns`; `columnWidths` stays in `data-table-preferences`.
  Consumers (`DataTable`, `useServerList`, `useColumnWidths`) keep their
  API. `DataTable`'s write-on-open goes (§1).
- `AppShellSidebar.tsx`: `appShellOpenGroups`, saved only when the user
  toggles a group. Both sidebars take their collapsed state from the
  browser, else `device.sidebarCollapsed`. The classic sidebar's open
  groups and both widths are unchanged.
- `useSalePrintPrefs`, `resolvePrintPaper`, `readPrintDensity` and
  `readPrintTypeScale`: when the browser has nothing stored, use
  `device.*` before today's fallback (`resolvePrintPaper` stays async, the
  density and type-scale readers stay sync and read the store's current
  value). Storage keys, the print window's `postMessage` names and the
  write paths are unchanged.

#### 5.3 Screens

- **Team → Default profiles**: a third tab on `app/(app)/team/page.tsx`
  beside Members and Roles, shown to owners and `MANAGE_USERS` holders.
  It lists profiles with a "Workspace default" badge and the roles using
  each, and has a "New profile" action in the `PageHeader`.
- **Profile editor** (`ModalShell`, or a sub-route if it grows; builder's
  call): name, "Use for members whose role has no profile", and one card
  per section:
  - Invoice print: `InvoiceLayoutFields`, controlled by the profile value
    instead of `getMyInvoicePrint`.
  - New-browser print setup: paper size, compact, text size, skip preview,
    sidebar collapsed.
  - Lists: the `TableViewOptions` controls for the global set.
  - Columns and sidebar groups: these are set only by Copy from my
    settings; the card shows "Set for N lists" with a Clear button.
  - Alerts: mute checkboxes over the alert types and quiet hours.

  Two actions:
  - **Copy from my settings**: choose sections. The frontend reads what
    this admin currently sees in each (legacy browser values and this
    browser's device values included) and sends it with `PATCH /:id`.
  - **Apply to members…**: a `ModalShell` confirmation naming the sections
    and the number of members affected, then `apply`.
- **Roles tab**: the role editor gets a "Default profile" select (None =
  workspace default).
- **Invite member**: one read-only line under the role picker:
  "Starts with: Cashier profile" (or the workspace default, or nothing).
- **My profile** (`/profile`, reached from the avatar menu): a "My
  preferences" section listing each section with its source and a Reset
  button. `PrintSettingsModal` shows the same line for `invoicePrint`.
- Every new string in all nine locales (`lib/i18n.tsx`).

### 6. Release-day behaviour and legacy browser values

- A new one-shot sync, `sync:member-prefs-legacy`
  (`packages/database/prisma/sync-member-prefs-legacy.ts`), runs in
  `db-prepare.sh` after the push. If the `PlatformSetting`
  `(group 'migrations', key 'member_prefs_legacy_backfill')` is absent, it
  does two things in one transaction and then writes that row:
  - sets `legacy_browser_sections = ['tableView', 'tableColumns', 'sidebar']`
    on every existing `TenantUser`;
  - rewrites every non-null `invoice_print_prefs` as a complete set (§2).

  On later deploys it does nothing, so members who join afterwards are
  never listed. The migration SQL for local databases does the same.
- For a listed section, the frontend reads the browser's old value
  (`data-table-preferences` visibility/order/pageSize,
  `app-shell-open-groups`, `erp71:table-view:<userKey>`) after the profile
  and before the member's own server layer. Nothing is uploaded
  automatically. The first time they change that section, the frontend
  saves the whole section as they see it, so nothing jumps, and the server
  takes it off the list.
- Reset (My preferences) and Apply also take the section off the list,
  so the profile shows from the next load on that browser.
- A member with an empty list (everyone who joins after release) never
  reads those keys, so a new cashier on an old till starts from the profile.
- With no profile saved, every resolved value equals today's. Owners create
  profiles after the deploy.

### 7. Phases

1. **Foundation** (backend): the schema, the sync, the shared-types
   registry and resolver, the preferences module (`/preferences/me`,
   profile CRUD and apply), invoice print through the lookup, the role
   field, and new-account language.
2. **Frontend store and hooks**: the store, the table view, columns,
   sidebar and device defaults, and the legacy reads.
3. **Screens and alerts**: the Default profiles tab, the editor, the
   role select, the invite line, My preferences, and alerts through the
   lookup.
4. **Later, in its own spec**: payment-method layouts (per-branch method
   ids make a profile branch-specific), report defaults, CRM and project
   views.

Phases 1–3 ship as one release PR, after a single `dev` integration.

## Testing

Shared types (jest):

- `resolvePreferences`: layer order; field-level merge; whole-entry
  replacement for list maps; legacy layer only for listed sections; source
  per section (including `browser`); stale column and group ids dropped; an
  unknown section ignored; an older `version` normalised.
- Partial normalisers: invalid fields dropped, valid ones kept; a present
  `null` kept for `footer_text` and `signature_space_mm`; the size limits.

Backend (jest, `--maxWorkers=2`, affected dirs only):

- Which profile: role profile, role without one → default, no role →
  default, no default → built-in, profile deleted → role falls back.
- `PATCH`/`DELETE /preferences/me/:section` for each section; `device`
  refused; concurrent saves of two sections both survive; another member's
  data never readable; save and reset take the section off
  `legacy_browser_sections`.
- `GET /preferences/me`: `device` carries only the fields the profile
  sets; with no profile it is empty, so the shop paper size still applies.
- Invoice print: a filled-out pre-release blob wins over a profile that
  sets a footer, borders and signature space (KH Tradind case); a new
  member gets the profile; a save stores only the submitted fields, and a
  submitted `null` footer stays the member's answer.
- Profiles: name clash 409; one default per tenant; a foreign id 404;
  sections validated on `PATCH`; apply clears only the chosen sections for
  the chosen members, takes them off `legacy_browser_sections`, and
  audits; non-`MANAGE_USERS` refused.
- Alerts: no row → profile quiet hours and mutes in `decide`; a row wins;
  a first partial `PUT` keeps the profile's other values.
- Language: a new account through invite signup and through employee login
  gets the workspace language when localization is on, `en` when off; an
  existing account is untouched.
- Sync: lists the three sections on existing rows and fills out existing
  invoice blobs, once; a second run leaves a member who joined since with
  an empty list and touches no blob.
- `src/common/` and route-authorization baseline tests updated for the new
  routes.

Frontend (`--runTestsByPath` for `(app)` pages):

- Store: load, optimistic save, rollback, reset, workspace switch.
- Each converted hook: server value, profile value, legacy value only for
  a listed section, built-in fallback; device values used only when the
  browser has nothing; no save on load; today's `localStorage` behaviour
  when the store is not loaded.
- Team tab, profile editor, Copy from my settings (sends shown values,
  legacy ones included), apply confirmation, role select, invite line, My
  preferences.

Print regression: render a KH Tradind invoice with no profile before and
after, and compare byte for byte.

## Release

One PR `dev` → `main` after `next lint --quiet` over `apps/frontend`. The
deploy pushes the schema and runs `sync:member-prefs-legacy` once. Check
`/health` after. Then check that `GET /preferences/me` for an existing
member returns `source: default` or `member` everywhere and lists the three
legacy sections. The production read for that check goes to the user as a
script, since production reads from a session are blocked.

## Left to the builder

- Debounce timings and the first-paint cache details.
- Whether the profile editor is a `ModalShell` or a sub-route.
- Copy for every new string.
- Whether `profileFor` is cached within a request.
- How `apply` without `user_ids` collects its targets (one query is
  expected).
