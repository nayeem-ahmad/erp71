# Platform-Admin Business Type + Catalog Import

**Date:** 2026-07-16
**Status:** Approved, ready for implementation plan

## Problem

A tenant who did not select a business type at signup has no way to load the
surgical/medical starter catalog (1,173 products). There is no post-signup path
to set `business_type` and no way to run the catalog import for an existing
tenant.

Worse, the import is broken for *every* tenant, including those who did select a
business type at signup.

### The underlying bug

`seedBusinessTypeTemplate` is exported from `packages/database/index.ts:4`, but
`packages/database/package.json` sets `"main": "./index.js"`, and `index.js` is a
hand-written CommonJS file that was never given the export. TypeScript resolves
imports against `index.ts` (via `"types"`), so it typechecks; Node resolves
against `index.js`, so the function is `undefined` at runtime:

```
$ node -e "console.log(typeof require('@erp71/database').seedBusinessTypeTemplate)"
undefined
```

The two call sites do not fail soft. At `apps/backend/src/auth/auth.service.ts:490`:

```ts
seedBusinessTypeTemplate(this.db, tenant.id, dto.businessType).catch((err) => ...)
```

Calling `undefined(...)` throws `TypeError` **synchronously**, before a promise
exists — so the attached `.catch()` never runs. In `setupTenant` the call is not
inside a try/catch, so selecting a business type at onboarding 500s
`POST /auth/setup-tenant` *after* the tenant transaction has already committed:
the tenant and store exist, no products are seeded, and the user sees an error.
Same shape at `apps/backend/src/admin-tenants/admin-tenants.service.ts:695`.

`admin-tenants.service.spec.ts:1-11` mocks `@erp71/database` wholesale, so the
real `index.js` is never loaded in tests. `git log` shows this is a recurring
class of bug in this file — commits `9374ffc` (seedTenantDemoData) and `6372327`
(DEMO_ACCOUNT_EMAIL) were the same omission.

**Consequence for this design:** existing tenants may have
`business_type = 'SURGICAL_MEDICAL'` already saved *and* an empty catalog. The
fix must be able to rescue them without changing their business type.

## Scope

In scope:

1. Make `seedBusinessTypeTemplate` reachable at runtime.
2. Two platform-admin-only endpoints: set business type, run catalog import.
3. Harden the two existing call sites so they fail soft.
4. An export-surface regression test.
5. Tighten `businessType` validation; extract the list to shared-types.
6. Admin UI: a control card in the tenant detail modal.

Out of scope:

- Tenant-facing self-serve catalog import (platform-admin only, by decision).
- Backend e2e specs. There are none in the repo today
  (`find apps/backend -name "*.e2e-spec.ts"` is empty), so guard wiring on the
  new routes will not be covered by tests. Pre-existing gap, flagged not fixed.
- Templates for business types other than `SURGICAL_MEDICAL`. Only
  `surgical-medical.json` exists.
- Rewriting the seeder for speed (see Risks).

## Decisions

| Decision | Choice | Why |
|---|---|---|
| Action shape | Type selector + always-available Import button | Import must be runnable independently of setting the type, or tenants already set to `SURGICAL_MEDICAL` with empty catalogs can't be rescued. |
| Execution | Synchronous, returns a summary | ~375 sequential round-trips, estimated at a few seconds. Rare admin action; real success/failure feedback beats matching the fire-and-forget convention that hid this bug. |
| Endpoints | Two, one per action | Matches the module's existing narrow-route style (`updateLocalization`, `suspendTenant`, `sms-credits`). A single route with a `runImport` flag conflates a fast metadata write with a multi-second bulk op and can't be audit-logged honestly. |

## Design

### 1. Database package — make the function reachable

`packages/database` has **no build step** (`package.json` scripts are only
`generate` / `db:push` / `db:seed` / `db:studio`). The `.js` files are
hand-maintained duplicates of the `.ts` files — `bootstrap-accounting.js`,
`tenant-role.seed.js`, `payment-method.seed.js`, `seed-demo.js`,
`accounting.constants.js` all have both siblings.

- Hand-write `packages/database/prisma/templates/seed-template.js` mirroring
  `seed-template.ts`. It **must** live in `prisma/templates/` — the seeder
  resolves its JSON via `path.join(__dirname, ...)` at `seed-template.ts:31-34`,
  next to `surgical-medical.json`.
- Add `seedBusinessTypeTemplate` to `index.js`, using the explicit-key style
  already used for the `seedDemo` exports (not a spread).
- Change the seeder's return type from `void` to a summary object:
  `{ created, skipped, groups, subgroups, brands }`. It already computes the
  totals at `seed-template.ts:105-108`. Both existing call sites ignore the
  return value, so this is additive.

### 2. Backend — two endpoints

Both go on `AdminTenantsController`, inheriting the class-level
`@UseGuards(JwtAuthGuard, PlatformAdminGuard)` at
`admin-tenants.controller.ts:19-22`. `TenantInterceptor` is **not** applied —
the admin controller never opts in, and `tenantId` comes from the URL param
while the service queries `this.db` unscoped. Follow that.

**`PATCH /admin/tenants/:tenantId/business-type`** → `setBusinessType(tenantId, dto, adminUserId)`

Follows `updateLocalization` (`admin-tenants.service.ts:374-422`) exactly:

1. `findFirst` with `ACTIVE_TENANT_FILTER` (`{ deleted_at: null }`, line 43) → `NotFoundException`
2. `tenant.update({ business_type })`
3. `await this.auditService.log('tenant.business_type.set', 'Tenant', { userId: adminUserId }, tenantId, { business_type })`
4. Return the updated tenant

Does **not** trigger an import. Setting the type and importing are separate acts.

**`POST /admin/tenants/:tenantId/catalog-import`** → `importCatalog(tenantId, adminUserId)`

1. `findFirst` with `ACTIVE_TENANT_FILTER` → `NotFoundException`
2. `BadRequestException` if `business_type` is null, or if no template file
   exists for it (currently anything but `SURGICAL_MEDICAL`)
3. `await seedBusinessTypeTemplate(this.db, tenantId, tenant.business_type)`
4. `await this.auditService.log('tenant.catalog.import', 'Tenant', { userId: adminUserId }, tenantId, summary)`
5. Return the summary

Re-runnable by design: the seeder upserts brands/groups/subgroups and skips SKUs
already present on the tenant (`seed-template.ts:79-88`), so a repeat call is a
no-op rather than a duplicate.

**Validation.** Add `@IsIn(BUSINESS_TYPES)` to the new DTO and to the two
existing ones (`auth.dto.ts:69-71`, `admin-tenants.dto.ts:97-99`), which are
`@IsOptional() @IsString()` today — `businessType: "ANYTHING"` is currently
accepted and persisted. `BUSINESS_TYPES` moves to `packages/shared-types`; it is
hardcoded in three places today (`CreateTenantModal.tsx:193-196`,
`onboarding/page.tsx:55-56`, and a comment at `schema.prisma:343`).

Note `business_type` stays a nullable free-form `String` in Prisma
(`schema.prisma:343`) — no migration. Validation is enforced at the DTO layer
only, which is enough for the two write paths and avoids a migration on a column
whose value set is still in flux.

### 3. Harden the existing call sites

Wrap `auth.service.ts:490` and `admin-tenants.service.ts:695` in real
`try/catch` blocks, not `.catch()` — a synchronous throw sails straight past a
promise handler, which is the entire bug. They stay fire-and-forget so signup
stays fast; the new admin endpoint is the reliable path.

### 4. Frontend

A fourth control card in `TenantDetailModal.tsx`, alongside the existing
subscription (lines 303-367), localization (369-413), and nav layout (415-437)
cards, reusing their badge + title + description + action-button template with
`isSavingX` state and a `<Loader2 className="animate-spin" />` swap.

- A `<select>` of `BUSINESS_TYPES` with its own Save button →
  `api.setAdminTenantBusinessType`
- A separate "Import catalog" button → `api.importAdminTenantCatalog`, showing
  the returned created/skipped counts in a toast. Gated behind a
  `window.confirm` (slow, bulk), matching the existing destructive-op pattern at
  `TenantDetailModal.tsx:150-173`.
- Handler shape follows `saveLocalization`: guard → confirm → `setIsSavingX(true)`
  → `api.<method>` → `await loadTenant(tenant.id)` → `onToast(...)` →
  `onChanged()` → `finally` reset. Errors go to the local `error` string
  rendered at line 246.
- Two `api.ts` methods next to `updateAdminTenantLocalization` (line 1274),
  as thin `fetchWithAuth` wrappers.
- i18n keys under `t.admin.tenants.*` for en/bn/ms.

Per the project UI rules: `ModalShell` is already in use here, `blue-600` for
both primary actions, no new accent color, `formatBDT()` not needed (no money).

### 5. Testing

- **Export-surface test** — `require` the real `packages/database/index.js` and
  assert the exported functions exist. This is the one test that catches the
  recurring bug class; the `jest.mock('@erp71/database')` strategy in
  `admin-tenants.service.spec.ts` structurally cannot.
- **Service specs** for `setBusinessType` and `importCatalog` — happy path,
  `NotFoundException` on unknown/deleted tenant, `BadRequestException` on null
  or template-less business type. Follows the existing describe-per-method
  pattern with the hand-rolled `db` mock and `makeTenant(overrides)` factory
  (`admin-tenants.service.spec.ts:36`).
- **Manual verification against a real tenant** before claiming done: run the
  import, observe the actual wall-clock time and the resulting product count.

## Risks

- **Import duration is estimated, not measured.** The synchronous decision rests
  on ~375 sequential round-trips being a few seconds. If real timing is closer
  to 30s, the request risks a gateway timeout and the execution decision must be
  revisited (batch the upserts, or fall back to fire-and-forget + audit row).
  This must be measured before the change is called done — and reported back
  rather than quietly worked around.
- **Hand-written `.js` duplicates will drift** from their `.ts` sources again.
  The export-surface test catches a missing export but not a diverged
  implementation. A real build step for `packages/database` is the actual fix;
  out of scope here.
- **Concurrent imports** for the same tenant are not guarded. Two admins
  clicking at once could race on the brand/group upserts. Low likelihood
  (platform-admin only, rare action) and the failure mode is a unique-constraint
  error rather than corruption. Accepted, not fixed.
