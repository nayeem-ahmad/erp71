# Platform-Admin Business Type + Catalog Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give platform admins a way to set a tenant's business type after signup and run the surgical/medical catalog import, and fix the export bug that makes the existing signup-time import throw.

**Architecture:** Two narrow platform-admin endpoints on the existing `AdminTenantsController` (`PATCH :tenantId/business-type`, `POST :tenantId/catalog-import`), backed by the existing `seedBusinessTypeTemplate` seeder once it is actually reachable from the package's CommonJS entrypoint. The import runs synchronously and returns a created/skipped summary. UI is a fourth control card in the existing tenant detail modal.

**Tech Stack:** NestJS 10, Prisma 5, Next.js 15, Jest + ts-jest, class-validator, Tailwind.

**Spec:** `docs/superpowers/specs/2026-07-16-admin-catalog-import-design.md` (commit `9723307`)

## Global Constraints

- Branch: work on `dev`. `.githooks/` blocks commits on `main`.
- `packages/database` has **no build step**. Its `.js` files are hand-maintained duplicates of the `.ts` files. Any new export needs both a `.ts` and a hand-written `.js` sibling, plus a line in `index.js`.
- `packages/shared-types` **does** have a build step (`main: dist/index.js`, `npm run build` → `tsc`). Changes there are invisible to the backend at runtime until rebuilt.
- `seed-template.js` must live in `packages/database/prisma/templates/` — the seeder resolves its JSON with `path.join(__dirname, ...)`.
- Admin endpoints do **not** use `TenantInterceptor`. `AdminTenantsController` never opts in; `tenantId` comes from the URL param and the service queries `this.db` unscoped.
- New/changed UI: `blue-600` for primary actions (existing cards use violet/slate — do not copy that; per `CLAUDE.md` the one accent is `blue-600`). `ModalShell` is already in use. Touch targets ≥44px.
- All UI strings go through `useI18n()` / `t.admin.tenants.*` and must be added to **all three** locales (`en`, `bn`, `ms`) — `apps/frontend/src/lib/localization/messages/catalog.test.ts` enforces key parity.
- Audit action naming convention: `tenant.<thing>.<verb>`, entity `'Tenant'`, ctx `{ userId: adminUserId }`, entityId `tenantId`. `await` it, never fire-and-forget.
- Run backend tests from `apps/backend` (`npx jest <path>`). Jest `moduleNameMapper` maps `@erp71/database` → `packages/database/`.
- Per `CLAUDE.md`: update `TODO.md` when done (Task 7).

---

## File Structure

**Create:**
- `packages/database/prisma/templates/seed-template.js` — hand-written CommonJS mirror of `seed-template.ts`
- `apps/backend/test/database-exports.spec.ts` — export-surface regression test

**Modify:**
- `packages/shared-types/index.ts` — add `BusinessType`, `BUSINESS_TYPE_VALUES`, `BUSINESS_TYPES_WITH_TEMPLATE`, `BUSINESS_TYPE_LABELS`
- `packages/database/index.js:1-16` — add the `seedBusinessTypeTemplate` export
- `packages/database/prisma/templates/seed-template.ts:26-112` — return a summary instead of `void`
- `apps/backend/src/admin-tenants/admin-tenants.dto.ts:97-99` + new DTO — `@IsIn` validation
- `apps/backend/src/admin-tenants/admin-tenants.controller.ts:60-67` — two new routes
- `apps/backend/src/admin-tenants/admin-tenants.service.ts:695-699` + new methods
- `apps/backend/src/admin-tenants/admin-tenants.service.spec.ts` — specs for both methods
- `apps/backend/src/auth/auth.service.ts:490-494` — harden
- `apps/backend/src/auth/auth.dto.ts:69-71` — `@IsIn` validation
- `apps/frontend/src/lib/api.ts:1274-1281` — two client methods
- `apps/frontend/src/components/admin/tenants/types.ts:7-43` — `business_type` on `TenantRecord`
- `apps/frontend/src/components/admin/tenants/TenantDetailModal.tsx` — fourth control card
- `apps/frontend/src/lib/localization/messages/{en,bn,ms}/admin.ts:179-191` — new keys

---

### Task 1: Shared business-type constants

**Files:**
- Modify: `packages/shared-types/index.ts` (add after `SubscriptionPlanCode`, line ~318)

**Interfaces:**
- Consumes: nothing
- Produces: `BusinessType` (const object + type), `BUSINESS_TYPE_VALUES: BusinessType[]`, `BUSINESS_TYPES_WITH_TEMPLATE: BusinessType[]`, `BUSINESS_TYPE_LABELS: Record<BusinessType, string>`

- [ ] **Step 1: Add the constants**

Insert into `packages/shared-types/index.ts` immediately after line 318 (`export type SubscriptionPlanCode = ...`). This mirrors the existing `PaymentMethodType` / `PAYMENT_METHOD_TYPE_VALUES` pattern at lines 17-27.

```ts
export const BusinessType = {
  SURGICAL_MEDICAL: 'SURGICAL_MEDICAL',
  PHARMACY: 'PHARMACY',
  GROCERY: 'GROCERY',
  COMPUTER_HARDWARE: 'COMPUTER_HARDWARE',
} as const;
export type BusinessType = (typeof BusinessType)[keyof typeof BusinessType];

export const BUSINESS_TYPE_VALUES = Object.values(BusinessType) as BusinessType[];

/** Business types that have a starter product catalog under packages/database/prisma/templates/. */
export const BUSINESS_TYPES_WITH_TEMPLATE: BusinessType[] = [BusinessType.SURGICAL_MEDICAL];

export const BUSINESS_TYPE_LABELS: Record<BusinessType, string> = {
  SURGICAL_MEDICAL: 'Surgical / Medical',
  PHARMACY: 'Pharmacy',
  GROCERY: 'Grocery',
  COMPUTER_HARDWARE: 'Computer Hardware',
};
```

- [ ] **Step 2: Build the package**

The backend resolves `@erp71/shared-types` to `dist/index.js` at runtime. Without this the new constants are `undefined` in NestJS — the exact class of bug this whole plan exists to fix.

Run: `cd packages/shared-types && npm run build`
Expected: exits 0, no TS errors.

- [ ] **Step 3: Verify the built output actually exports them**

Run:
```bash
cd packages/shared-types && node -e "const s=require('./dist/index.js'); console.log(s.BUSINESS_TYPE_VALUES, s.BUSINESS_TYPES_WITH_TEMPLATE)"
```
Expected: `[ 'SURGICAL_MEDICAL', 'PHARMACY', 'GROCERY', 'COMPUTER_HARDWARE' ] [ 'SURGICAL_MEDICAL' ]`

- [ ] **Step 4: Commit**

```bash
git add packages/shared-types/index.ts
git commit -m "feat(shared-types): add BusinessType constants and template registry"
```

---

### Task 2: Make seedBusinessTypeTemplate reachable and return a summary

This is the task that fixes the live bug. Everything downstream depends on it.

**Files:**
- Modify: `packages/database/prisma/templates/seed-template.ts:26-112`
- Create: `packages/database/prisma/templates/seed-template.js`
- Modify: `packages/database/index.js`
- Create: `apps/backend/test/database-exports.spec.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `seedBusinessTypeTemplate(prisma, tenantId, businessType) => Promise<CatalogImportSummary>` where `CatalogImportSummary = { created: number; skipped: number; groups: number; subgroups: number; brands: number }`. Task 4 calls this and returns the summary to the client.

- [ ] **Step 1: Write the failing export-surface test**

Create `apps/backend/test/database-exports.spec.ts`. This requires the real `index.js` by explicit relative path, deliberately bypassing jest's `moduleNameMapper` so it tests the exact file Node loads in production. No `jest.mock` — that is the whole point.

```ts
/**
 * Guards the runtime export surface of @erp71/database.
 *
 * packages/database has no build step: index.js is hand-maintained alongside
 * index.ts. TypeScript resolves imports against index.ts ("types"), Node against
 * index.js ("main"), so an export present only in the .ts typechecks fine and is
 * undefined at runtime. That has shipped three times (9374ffc, 6372327, and the
 * seedBusinessTypeTemplate bug this test was added for). Service specs mock the
 * package wholesale, so they cannot catch it.
 */
// eslint-disable-next-line @typescript-eslint/no-var-requires
const database = require('../../../packages/database/index.js');

describe('@erp71/database runtime exports', () => {
    it.each([
        'seedBusinessTypeTemplate',
        'seedDefaultTenantRoles',
        'seedDefaultPaymentMethods',
        'bootstrapDefaultAccountingForTenant',
        'seedDemoAccount',
        'seedTenantDemoData',
    ])('exports %s as a function from index.js', (name) => {
        expect(typeof database[name]).toBe('function');
    });
});
```

- [ ] **Step 2: Run it to confirm it fails on exactly one export**

Run: `cd apps/backend && npx jest test/database-exports.spec.ts`
Expected: FAIL — `seedBusinessTypeTemplate` case fails with `expect(received).toBe(expected) // Expected: "function", Received: "undefined"`. The other five PASS. If any other case fails, stop and investigate before continuing.

- [ ] **Step 3: Change the .ts seeder to return a summary**

In `packages/database/prisma/templates/seed-template.ts`, add the summary interface after `TemplateData` (line 24):

```ts
export interface CatalogImportSummary {
  created: number;
  skipped: number;
  groups: number;
  subgroups: number;
  brands: number;
}
```

Change the signature at line 26-30 from `Promise<void>` to `Promise<CatalogImportSummary>`.

Change the early return at line 36-39 to:

```ts
  if (!fs.existsSync(templatePath)) {
    console.log(`No product template found for business type: ${businessType}`);
    return { created: 0, skipped: 0, groups: 0, subgroups: 0, brands: 0 };
  }
```

Add counters before the group loop (line 64) and tally inside it. Replace lines 64-112 with:

```ts
  // Create groups → subgroups → products
  let created = 0;
  let skipped = 0;
  let subgroupCount = 0;

  for (const groupData of template.groups) {
    const group = await prisma.productGroup.upsert({
      where: { tenant_id_name: { tenant_id: tenantId, name: groupData.name } },
      create: { tenant_id: tenantId, name: groupData.name },
      update: {},
    });

    for (const subgroupData of groupData.subgroups) {
      subgroupCount += 1;
      const subgroup = await prisma.productSubgroup.upsert({
        where: { group_id_name: { group_id: group.id, name: subgroupData.name } },
        create: { tenant_id: tenantId, group_id: group.id, name: subgroupData.name },
        update: {},
      });

      // Skip SKUs already present for this tenant
      const skus = subgroupData.products.map((p) => p.sku);
      const existing = await prisma.product.findMany({
        where: { tenant_id: tenantId, sku: { in: skus } },
        select: { sku: true },
      });
      const existingSkus = new Set(existing.map((p: { sku: string }) => p.sku));

      const toCreate = subgroupData.products
        .filter((p) => !existingSkus.has(p.sku))
        .map((p) => ({
          tenant_id: tenantId,
          name: p.name,
          sku: p.sku,
          price: p.purchasePrice,
          group_id: group.id,
          subgroup_id: subgroup.id,
          brand_id: p.brand ? (brandMap.get(p.brand) ?? null) : null,
        }));

      created += toCreate.length;
      skipped += subgroupData.products.length - toCreate.length;

      if (toCreate.length > 0) {
        await prisma.product.createMany({ data: toCreate, skipDuplicates: true });
      }
    }
  }

  console.log(
    `Seeded ${businessType} template for tenant ${tenantId}: ${created} products created, ${skipped} skipped, across ${template.groups.length} groups`,
  );

  return {
    created,
    skipped,
    groups: template.groups.length,
    subgroups: subgroupCount,
    brands: brandNames.size,
  };
```

- [ ] **Step 4: Hand-write the CommonJS mirror**

Create `packages/database/prisma/templates/seed-template.js`. It must sit in this directory — `__dirname` resolves `surgical-medical.json` from here. Follow the plain-CommonJS style of `packages/database/prisma/tenant-role.seed.js`.

```js
const fs = require('fs');
const path = require('path');

/**
 * Hand-written CommonJS mirror of seed-template.ts.
 * packages/database has no build step — keep the two in sync when either changes.
 * Guarded by apps/backend/test/database-exports.spec.ts.
 */
async function seedBusinessTypeTemplate(prisma, tenantId, businessType) {
    const templatePath = path.join(
        __dirname,
        `${businessType.toLowerCase().replace(/_/g, '-')}.json`,
    );

    if (!fs.existsSync(templatePath)) {
        console.log(`No product template found for business type: ${businessType}`);
        return { created: 0, skipped: 0, groups: 0, subgroups: 0, brands: 0 };
    }

    const template = JSON.parse(fs.readFileSync(templatePath, 'utf-8'));

    // Collect unique brand names
    const brandNames = new Set();
    for (const group of template.groups) {
        for (const subgroup of group.subgroups) {
            for (const product of subgroup.products) {
                if (product.brand) brandNames.add(product.brand);
            }
        }
    }

    // Upsert brands
    const brandMap = new Map();
    for (const brandName of brandNames) {
        const brand = await prisma.brand.upsert({
            where: { tenant_id_name: { tenant_id: tenantId, name: brandName } },
            create: { tenant_id: tenantId, name: brandName },
            update: {},
        });
        brandMap.set(brandName, brand.id);
    }

    // Create groups → subgroups → products
    let created = 0;
    let skipped = 0;
    let subgroupCount = 0;

    for (const groupData of template.groups) {
        const group = await prisma.productGroup.upsert({
            where: { tenant_id_name: { tenant_id: tenantId, name: groupData.name } },
            create: { tenant_id: tenantId, name: groupData.name },
            update: {},
        });

        for (const subgroupData of groupData.subgroups) {
            subgroupCount += 1;
            const subgroup = await prisma.productSubgroup.upsert({
                where: { group_id_name: { group_id: group.id, name: subgroupData.name } },
                create: { tenant_id: tenantId, group_id: group.id, name: subgroupData.name },
                update: {},
            });

            const skus = subgroupData.products.map((p) => p.sku);
            const existing = await prisma.product.findMany({
                where: { tenant_id: tenantId, sku: { in: skus } },
                select: { sku: true },
            });
            const existingSkus = new Set(existing.map((p) => p.sku));

            const toCreate = subgroupData.products
                .filter((p) => !existingSkus.has(p.sku))
                .map((p) => ({
                    tenant_id: tenantId,
                    name: p.name,
                    sku: p.sku,
                    price: p.purchasePrice,
                    group_id: group.id,
                    subgroup_id: subgroup.id,
                    brand_id: p.brand ? (brandMap.get(p.brand) ?? null) : null,
                }));

            created += toCreate.length;
            skipped += subgroupData.products.length - toCreate.length;

            if (toCreate.length > 0) {
                await prisma.product.createMany({ data: toCreate, skipDuplicates: true });
            }
        }
    }

    console.log(
        `Seeded ${businessType} template for tenant ${tenantId}: ${created} products created, ${skipped} skipped, across ${template.groups.length} groups`,
    );

    return {
        created,
        skipped,
        groups: template.groups.length,
        subgroups: subgroupCount,
        brands: brandNames.size,
    };
}

module.exports = { seedBusinessTypeTemplate };
```

- [ ] **Step 5: Wire it into index.js**

Modify `packages/database/index.js`. Add the require after line 5 and the export key after line 15, matching the existing explicit-key style used for `seedDemo`:

```js
const prisma = require('@prisma/client');
const accounting = require('./prisma/bootstrap-accounting.js');
const tenantRoles = require('./prisma/tenant-role.seed.js');
const paymentMethods = require('./prisma/payment-method.seed.js');
const seedDemo = require('./prisma/seed-demo.js');
const seedTemplate = require('./prisma/templates/seed-template.js');

module.exports = {
    ...prisma,
    ...accounting,
    ...tenantRoles,
    ...paymentMethods,
    DEMO_ACCOUNT_EMAIL: seedDemo.DEMO_ACCOUNT_EMAIL,
    DEMO_ACCOUNT_PASSWORD: seedDemo.DEMO_ACCOUNT_PASSWORD,
    seedDemoAccount: seedDemo.seedDemoAccount,
    seedTenantDemoData: seedDemo.seedTenantDemoData,
    seedBusinessTypeTemplate: seedTemplate.seedBusinessTypeTemplate,
};
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `cd apps/backend && npx jest test/database-exports.spec.ts`
Expected: PASS, 6 tests.

- [ ] **Step 7: Commit**

```bash
git add packages/database/prisma/templates/seed-template.ts \
        packages/database/prisma/templates/seed-template.js \
        packages/database/index.js \
        apps/backend/test/database-exports.spec.ts
git commit -m "fix(database): export seedBusinessTypeTemplate from index.js

The function was exported from index.ts only. Node resolves the package
via \"main\": index.js, so it was undefined at runtime and every call site
threw TypeError synchronously — past the attached .catch() — 500ing
signup after the tenant transaction had already committed.

Adds a hand-written CommonJS mirror (no build step in this package), the
missing export, and a test asserting the real index.js export surface.
The seeder now also returns a created/skipped summary."
```

---

### Task 3: Harden the existing call sites and tighten validation

**Files:**
- Modify: `apps/backend/src/auth/auth.service.ts:490-494`
- Modify: `apps/backend/src/auth/auth.dto.ts:69-71`
- Modify: `apps/backend/src/admin-tenants/admin-tenants.service.ts:695-699`
- Modify: `apps/backend/src/admin-tenants/admin-tenants.dto.ts:97-99`

**Interfaces:**
- Consumes: `BUSINESS_TYPE_VALUES` from Task 1
- Produces: nothing new

- [ ] **Step 1: Harden the auth.service.ts call site**

Replace lines 490-494 of `apps/backend/src/auth/auth.service.ts`:

```ts
        if (dto.businessType) {
            // Deliberately not awaited: signup should not block on a bulk import.
            // Must be try/catch, not .catch() — a synchronous throw never reaches
            // a promise handler, which 500'd signup after the tenant had committed.
            try {
                void seedBusinessTypeTemplate(this.db, result.tenant.id, dto.businessType).catch((err) =>
                    console.error(`Failed to seed product template for ${dto.businessType}:`, err),
                );
            } catch (err) {
                console.error(`Failed to start product template seed for ${dto.businessType}:`, err);
            }
        }
```

- [ ] **Step 2: Harden the admin-tenants.service.ts call site**

Replace lines 695-699 of `apps/backend/src/admin-tenants/admin-tenants.service.ts`:

```ts
        if (dto.businessType) {
            // Deliberately not awaited; see the note in AuthService.setupTenant.
            try {
                void seedBusinessTypeTemplate(this.db, tenant.id, dto.businessType).catch((err: any) =>
                    console.error(`[AdminTenantsService] Failed to seed business type template:`, err),
                );
            } catch (err) {
                console.error(`[AdminTenantsService] Failed to start business type template seed:`, err);
            }
        }
```

- [ ] **Step 3: Tighten the two existing DTOs**

In `apps/backend/src/admin-tenants/admin-tenants.dto.ts`, add `BUSINESS_TYPE_VALUES` to the `@erp71/shared-types` import (add the import if the file has none), then replace lines 97-99:

```ts
    @IsOptional()
    @IsIn(BUSINESS_TYPE_VALUES)
    businessType?: string;
```

Apply the identical change to `businessType` in `apps/backend/src/auth/auth.dto.ts:69-71`. `@IsIn` is already imported in the admin DTO (used for `planCode` at line 101); check and add the import in `auth.dto.ts` if missing.

- [ ] **Step 4: Verify the backend still compiles and existing specs pass**

Run: `cd apps/backend && npx tsc --noEmit -p tsconfig.json && npx jest src/admin-tenants src/auth`
Expected: tsc exits 0; all existing specs PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/auth/auth.service.ts apps/backend/src/auth/auth.dto.ts \
        apps/backend/src/admin-tenants/admin-tenants.service.ts \
        apps/backend/src/admin-tenants/admin-tenants.dto.ts
git commit -m "fix(backend): fail soft on catalog seed, validate businessType

Wraps both seedBusinessTypeTemplate call sites in try/catch so a seed
failure can never again 500 a request whose tenant transaction already
committed, and replaces the unvalidated @IsString() businessType with
@IsIn(BUSINESS_TYPE_VALUES) — 'ANYTHING' was previously persisted."
```

---

### Task 4: Backend endpoints

**Files:**
- Modify: `apps/backend/src/admin-tenants/admin-tenants.dto.ts` (new DTO)
- Modify: `apps/backend/src/admin-tenants/admin-tenants.service.ts` (two methods, after `updateLocalization` which ends at line 422)
- Modify: `apps/backend/src/admin-tenants/admin-tenants.controller.ts` (two routes, after line 67)
- Modify: `apps/backend/src/admin-tenants/admin-tenants.service.spec.ts` (two describes)

**Interfaces:**
- Consumes: `seedBusinessTypeTemplate` + `CatalogImportSummary` (Task 2); `BUSINESS_TYPE_VALUES`, `BUSINESS_TYPES_WITH_TEMPLATE` (Task 1)
- Produces:
  - `AdminTenantsService.setBusinessType(tenantId: string, dto: SetAdminTenantBusinessTypeDto, adminUserId: string) => Promise<{ id: string; business_type: string | null }>`
  - `AdminTenantsService.importCatalog(tenantId: string, adminUserId: string) => Promise<CatalogImportSummary & { business_type: string }>`
  - Routes: `PATCH /admin/tenants/:tenantId/business-type`, `POST /admin/tenants/:tenantId/catalog-import`

- [ ] **Step 1: Write the failing service specs**

Append to `apps/backend/src/admin-tenants/admin-tenants.service.spec.ts`, inside the top-level `describe('AdminTenantsService')`.

First, fix the existing mock. Line 3 currently reads `seedBusinessTypeTemplate: jest.fn().mockResolvedValue(undefined)` — the seeder now returns a summary, so change it to:

```ts
    seedBusinessTypeTemplate: jest.fn().mockResolvedValue({
        created: 0, skipped: 0, groups: 0, subgroups: 0, brands: 0,
    }),
```

```ts
describe('setBusinessType', () => {
    it('updates business_type and writes an audit row', async () => {
        db.tenant.findFirst.mockResolvedValue(makeTenant({ id: 't1', business_type: null }));
        db.tenant.update.mockResolvedValue({ id: 't1', business_type: 'SURGICAL_MEDICAL' });

        const result = await service.setBusinessType('t1', { businessType: 'SURGICAL_MEDICAL' }, 'admin1');

        expect(db.tenant.update).toHaveBeenCalledWith({
            where: { id: 't1' },
            data: { business_type: 'SURGICAL_MEDICAL' },
            select: { id: true, business_type: true },
        });
        expect(auditService.log).toHaveBeenCalledWith(
            'tenant.business_type.set',
            'Tenant',
            { userId: 'admin1' },
            't1',
            { business_type: 'SURGICAL_MEDICAL', previous_business_type: null },
        );
        expect(result).toEqual({ id: 't1', business_type: 'SURGICAL_MEDICAL' });
    });

    it('throws NotFoundException for an unknown or deleted tenant', async () => {
        db.tenant.findFirst.mockResolvedValue(null);

        await expect(
            service.setBusinessType('nope', { businessType: 'SURGICAL_MEDICAL' }, 'admin1'),
        ).rejects.toBeInstanceOf(NotFoundException);
        expect(db.tenant.update).not.toHaveBeenCalled();
    });

    it('does not run the catalog import', async () => {
        db.tenant.findFirst.mockResolvedValue(makeTenant({ id: 't1', business_type: null }));
        db.tenant.update.mockResolvedValue({ id: 't1', business_type: 'SURGICAL_MEDICAL' });

        await service.setBusinessType('t1', { businessType: 'SURGICAL_MEDICAL' }, 'admin1');

        expect(seedBusinessTypeTemplate).not.toHaveBeenCalled();
    });
});

describe('importCatalog', () => {
    it('runs the seeder and returns the summary', async () => {
        db.tenant.findFirst.mockResolvedValue(makeTenant({ id: 't1', business_type: 'SURGICAL_MEDICAL' }));
        (seedBusinessTypeTemplate as jest.Mock).mockResolvedValue({
            created: 1173, skipped: 0, groups: 24, subgroups: 103, brands: 42,
        });

        const result = await service.importCatalog('t1', 'admin1');

        expect(seedBusinessTypeTemplate).toHaveBeenCalledWith(db, 't1', 'SURGICAL_MEDICAL');
        expect(result).toEqual({
            business_type: 'SURGICAL_MEDICAL',
            created: 1173, skipped: 0, groups: 24, subgroups: 103, brands: 42,
        });
        expect(auditService.log).toHaveBeenCalledWith(
            'tenant.catalog.import',
            'Tenant',
            { userId: 'admin1' },
            't1',
            { business_type: 'SURGICAL_MEDICAL', created: 1173, skipped: 0, groups: 24, subgroups: 103, brands: 42 },
        );
    });

    it('is re-runnable and reports skipped SKUs on a second run', async () => {
        db.tenant.findFirst.mockResolvedValue(makeTenant({ id: 't1', business_type: 'SURGICAL_MEDICAL' }));
        (seedBusinessTypeTemplate as jest.Mock).mockResolvedValue({
            created: 0, skipped: 1173, groups: 24, subgroups: 103, brands: 42,
        });

        const result = await service.importCatalog('t1', 'admin1');

        expect(result.created).toBe(0);
        expect(result.skipped).toBe(1173);
    });

    it('throws NotFoundException for an unknown or deleted tenant', async () => {
        db.tenant.findFirst.mockResolvedValue(null);

        await expect(service.importCatalog('nope', 'admin1')).rejects.toBeInstanceOf(NotFoundException);
        expect(seedBusinessTypeTemplate).not.toHaveBeenCalled();
    });

    it('throws BadRequestException when the tenant has no business type', async () => {
        db.tenant.findFirst.mockResolvedValue(makeTenant({ id: 't1', business_type: null }));

        await expect(service.importCatalog('t1', 'admin1')).rejects.toBeInstanceOf(BadRequestException);
        expect(seedBusinessTypeTemplate).not.toHaveBeenCalled();
    });

    it('throws BadRequestException when the business type has no template', async () => {
        db.tenant.findFirst.mockResolvedValue(makeTenant({ id: 't1', business_type: 'PHARMACY' }));

        await expect(service.importCatalog('t1', 'admin1')).rejects.toBeInstanceOf(BadRequestException);
        expect(seedBusinessTypeTemplate).not.toHaveBeenCalled();
    });
});
```

Add to the file's existing imports as needed: `BadRequestException` from `@nestjs/common`, and `seedBusinessTypeTemplate` from `@erp71/database` (so the specs can assert on the mock).

The `makeTenant` factory (line 36) ends with `...overrides` at line 65, so `makeTenant({ business_type: null })` works without touching the factory.

- [ ] **Step 2: Run the specs to verify they fail**

Run: `cd apps/backend && npx jest src/admin-tenants/admin-tenants.service.spec.ts -t "setBusinessType"`
Expected: FAIL with `service.setBusinessType is not a function`.

- [ ] **Step 3: Add the DTO**

Append to `apps/backend/src/admin-tenants/admin-tenants.dto.ts`:

```ts
export class SetAdminTenantBusinessTypeDto {
    @IsIn(BUSINESS_TYPE_VALUES)
    businessType: string;
}
```

- [ ] **Step 4: Implement the two service methods**

Insert into `apps/backend/src/admin-tenants/admin-tenants.service.ts` after `updateLocalization` (which ends at line 422). Add `BUSINESS_TYPES_WITH_TEMPLATE` to the existing `@erp71/shared-types` import at lines 10-18, and `SetAdminTenantBusinessTypeDto` to the DTO import at lines 26-41. `seedBusinessTypeTemplate` is already imported at line 9.

```ts
    async setBusinessType(
        tenantId: string,
        dto: SetAdminTenantBusinessTypeDto,
        adminUserId: string,
    ) {
        const tenant = await this.db.tenant.findFirst({
            where: { id: tenantId, ...ACTIVE_TENANT_FILTER },
            select: { id: true, business_type: true },
        });
        if (!tenant) {
            throw new NotFoundException('Tenant not found');
        }

        const updated = await this.db.tenant.update({
            where: { id: tenantId },
            data: { business_type: dto.businessType },
            select: { id: true, business_type: true },
        });

        await this.auditService.log(
            'tenant.business_type.set',
            'Tenant',
            { userId: adminUserId },
            tenantId,
            {
                business_type: updated.business_type,
                previous_business_type: tenant.business_type,
            },
        );

        return updated;
    }

    /**
     * Loads the starter product catalog for the tenant's business type.
     * Runs synchronously — the seeder is re-runnable (it upserts groups/brands and
     * skips SKUs the tenant already has), so a repeat call is a safe no-op.
     */
    async importCatalog(tenantId: string, adminUserId: string) {
        const tenant = await this.db.tenant.findFirst({
            where: { id: tenantId, ...ACTIVE_TENANT_FILTER },
            select: { id: true, business_type: true },
        });
        if (!tenant) {
            throw new NotFoundException('Tenant not found');
        }

        if (!tenant.business_type) {
            throw new BadRequestException(
                'This tenant has no business type. Set a business type before importing a catalog.',
            );
        }

        if (!BUSINESS_TYPES_WITH_TEMPLATE.includes(tenant.business_type as any)) {
            throw new BadRequestException(
                `No starter catalog is available for business type ${tenant.business_type}.`,
            );
        }

        const summary = await seedBusinessTypeTemplate(this.db, tenantId, tenant.business_type);

        await this.auditService.log(
            'tenant.catalog.import',
            'Tenant',
            { userId: adminUserId },
            tenantId,
            { business_type: tenant.business_type, ...summary },
        );

        return { business_type: tenant.business_type, ...summary };
    }
```

- [ ] **Step 5: Add the two routes**

Insert into `apps/backend/src/admin-tenants/admin-tenants.controller.ts` after `updateLocalization` (line 67). Add `SetAdminTenantBusinessTypeDto` to the DTO import at lines 5-17. Both routes inherit the class-level `@UseGuards(JwtAuthGuard, PlatformAdminGuard)` at line 20 — do not add per-route guards.

```ts
    @Patch(':tenantId/business-type')
    setBusinessType(
        @Param('tenantId') tenantId: string,
        @Body() dto: SetAdminTenantBusinessTypeDto,
        @Request() req: any,
    ) {
        return this.adminTenantsService.setBusinessType(tenantId, dto, req.user.userId);
    }

    @Post(':tenantId/catalog-import')
    importCatalog(
        @Param('tenantId') tenantId: string,
        @Request() req: any,
    ) {
        return this.adminTenantsService.importCatalog(tenantId, req.user.userId);
    }
```

- [ ] **Step 6: Run the specs to verify they pass**

Run: `cd apps/backend && npx jest src/admin-tenants/admin-tenants.service.spec.ts`
Expected: PASS, including the 8 new tests. Existing tests still PASS.

- [ ] **Step 7: Typecheck**

Run: `cd apps/backend && npx tsc --noEmit -p tsconfig.json`
Expected: exits 0.

- [ ] **Step 8: Commit**

```bash
git add apps/backend/src/admin-tenants/
git commit -m "feat(admin): endpoints to set tenant business type and import catalog

PATCH :tenantId/business-type sets the field; POST :tenantId/catalog-import
runs the seeder synchronously and returns a created/skipped summary. Split
in two so the import is re-runnable independently — tenants whose type is
already correct but whose catalog is empty (from the export bug) can be
rescued without changing their business type."
```

---

### Task 5: Admin UI control card

**Files:**
- Modify: `apps/frontend/src/lib/api.ts` (after line 1281)
- Modify: `apps/frontend/src/components/admin/tenants/types.ts:7-43`
- Modify: `apps/frontend/src/lib/localization/messages/{en,bn,ms}/admin.ts` (after line ~191)
- Modify: `apps/frontend/src/components/admin/tenants/TenantDetailModal.tsx`

**Interfaces:**
- Consumes: the two routes from Task 4; `BUSINESS_TYPE_VALUES`, `BUSINESS_TYPE_LABELS` from Task 1
- Produces: nothing downstream

- [ ] **Step 1: Add the api.ts client methods**

Insert into `apps/frontend/src/lib/api.ts` after `updateAdminTenantLocalization` (line 1281), matching its thin `fetchWithAuth` shape:

```ts
    setAdminTenantBusinessType: (tenantId: string, businessType: string) => fetchWithAuth(`/admin/tenants/${tenantId}/business-type`, {
        method: 'PATCH',
        body: JSON.stringify({ businessType }),
        headers: { 'Content-Type': 'application/json' },
    }),
    importAdminTenantCatalog: (tenantId: string): Promise<{
        business_type: string;
        created: number;
        skipped: number;
        groups: number;
        subgroups: number;
        brands: number;
    }> => fetchWithAuth(`/admin/tenants/${tenantId}/catalog-import`, {
        method: 'POST',
    }),
```

- [ ] **Step 2: Add business_type to TenantRecord**

In `apps/frontend/src/components/admin/tenants/types.ts`, add to the `TenantRecord` type after line 11 (`secondary_locale?: ...`):

```ts
    business_type?: string | null;
```

No backend change is needed to populate it: `getTenant` at `admin-tenants.service.ts:261` uses `include`, so all scalar tenant columns are already returned.

- [ ] **Step 3: Add i18n keys to all three locales**

In `apps/frontend/src/lib/localization/messages/en/admin.ts`, insert after the `localizationControls` block (ends line 191):

```ts
        businessTypeControls: {
            badge: 'Catalog',
            title: 'Business type & starter catalog',
            description: 'Set the business type, then import the starter product catalog. Importing is safe to repeat — products already in the catalog are skipped.',
            typeLabel: 'Business type',
            typePlaceholder: 'Select a business type',
            save: 'Save business type',
            saved: 'Business type updated.',
            saveFailed: 'Failed to update business type.',
            import: 'Import catalog',
            importConfirm: 'Import the starter catalog for {name}? This may take a few seconds.',
            imported: 'Imported {created} products ({skipped} already existed).',
            importFailed: 'Failed to import the catalog.',
            noTemplate: 'No starter catalog is available for this business type yet.',
            noTypeSet: 'Set a business type before importing a catalog.',
        },
```

Add the same key structure with translated values to `bn/admin.ts` and `ms/admin.ts`. `catalog.test.ts` enforces key parity across locales — a missing key fails the suite.

- [ ] **Step 4: Add the card to TenantDetailModal**

In `apps/frontend/src/components/admin/tenants/TenantDetailModal.tsx`:

Add to the imports at line 3-9:
```ts
import { BUSINESS_TYPE_LABELS, BUSINESS_TYPE_VALUES, BUSINESS_TYPES_WITH_TEMPLATE } from '@erp71/shared-types';
```
Add `Download` to the existing `lucide-react` import at line 4.

Add after line 37 (`const nc = m.navLayoutControls;`):
```ts
    const bt = m.businessTypeControls;
```

Add state after line 48:
```ts
    const [businessTypeDraft, setBusinessTypeDraft] = useState('');
    const [isSavingBusinessType, setIsSavingBusinessType] = useState(false);
    const [isImportingCatalog, setIsImportingCatalog] = useState(false);
```

Seed the draft from the loaded tenant. Add immediately after the `useEffect` that syncs `localizationDraft` (lines 82-84):

```ts
    useEffect(() => {
        setBusinessTypeDraft(tenant?.business_type ?? '');
    }, [tenant?.business_type]);
```

Add the two handlers after `saveLocalization` (ends line 173), following its exact shape:
```ts
    const saveBusinessType = async () => {
        if (!tenant || !businessTypeDraft) return;
        setIsSavingBusinessType(true);
        setError('');
        try {
            await api.setAdminTenantBusinessType(tenant.id, businessTypeDraft);
            await loadTenant(tenant.id);
            onToast(bt.saved);
            onChanged();
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : bt.saveFailed);
        } finally {
            setIsSavingBusinessType(false);
        }
    };

    const importCatalog = async () => {
        if (!tenant) return;
        if (!window.confirm(formatMessage(bt.importConfirm, { name: tenant.name }))) return;
        setIsImportingCatalog(true);
        setError('');
        try {
            const summary = await api.importAdminTenantCatalog(tenant.id);
            onToast(formatMessage(bt.imported, {
                created: String(summary.created),
                skipped: String(summary.skipped),
            }));
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : bt.importFailed);
        } finally {
            setIsImportingCatalog(false);
        }
    };
```

Add the card in the JSX after the nav layout card (ends line 437). Note this uses `blue-600` per `CLAUDE.md`, not the violet/slate of its neighbours:

```tsx
                            <div className="rounded-lg border border-blue-100 bg-blue-50/70 p-5 space-y-4">
                                <div>
                                    <p className="text-[10px] font-medium text-blue-400">{bt.badge}</p>
                                    <h3 className="mt-2 text-lg font-bold tracking-tight text-blue-900">{bt.title}</h3>
                                    <p className="mt-1 text-xs text-blue-700/80">{bt.description}</p>
                                </div>
                                <select
                                    value={businessTypeDraft}
                                    onChange={(event) => setBusinessTypeDraft(event.target.value)}
                                    aria-label={bt.typeLabel}
                                    className="w-full rounded-lg border border-blue-100 bg-white px-4 py-3 text-sm font-medium outline-none"
                                >
                                    <option value="">{bt.typePlaceholder}</option>
                                    {BUSINESS_TYPE_VALUES.map((value) => (
                                        <option key={value} value={value}>{BUSINESS_TYPE_LABELS[value]}</option>
                                    ))}
                                </select>
                                <div className="flex flex-wrap gap-3">
                                    <button
                                        type="button"
                                        onClick={() => void saveBusinessType()}
                                        disabled={isSavingBusinessType || !businessTypeDraft || businessTypeDraft === (tenant.business_type ?? '')}
                                        className="inline-flex min-h-touch items-center rounded-lg bg-blue-600 px-5 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:opacity-60"
                                    >
                                        {isSavingBusinessType ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                                        {bt.save}
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => void importCatalog()}
                                        disabled={isImportingCatalog || !tenant.business_type || !BUSINESS_TYPES_WITH_TEMPLATE.includes(tenant.business_type as never)}
                                        className="inline-flex min-h-touch items-center gap-2 rounded-lg border border-blue-200 bg-white px-5 py-3 text-sm font-semibold text-blue-700 transition hover:bg-blue-100 disabled:opacity-60"
                                    >
                                        {isImportingCatalog ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                                        {bt.import}
                                    </button>
                                </div>
                                {!tenant.business_type ? (
                                    <p className="text-xs font-medium text-blue-700">{bt.noTypeSet}</p>
                                ) : !BUSINESS_TYPES_WITH_TEMPLATE.includes(tenant.business_type as never) ? (
                                    <p className="text-xs font-medium text-blue-700">{bt.noTemplate}</p>
                                ) : null}
                            </div>
```

The import button reads `tenant.business_type` (the saved value), not `businessTypeDraft` — importing must reflect what is actually persisted, not an unsaved dropdown selection.

- [ ] **Step 5: Typecheck and run the frontend suites**

Run: `cd apps/frontend && npx tsc --noEmit && npx jest src/lib/localization src/app/\(app\)/admin`
Expected: tsc exits 0; `catalog.test.ts` PASSES (key parity across en/bn/ms); admin page tests PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/frontend/src/lib/api.ts apps/frontend/src/components/admin/tenants/ \
        apps/frontend/src/lib/localization/messages/
git commit -m "feat(admin): business type + catalog import card in tenant detail"
```

---

### Task 6: Verify against a real tenant

The synchronous-execution decision rests on an **estimate** (~375 sequential round-trips ≈ a few seconds), not a measurement. This task exists to replace that estimate with a number. Do not skip it, and do not quietly work around a bad result — report it.

**Files:** none (verification only)

- [ ] **Step 1: Start the stack**

Run the backend and frontend against the local dev database per the repo's normal dev flow (`npm run dev`). Confirm the backend boots — a missing `.js` sibling or an unbuilt `shared-types` shows up here as a startup or first-request failure.

- [ ] **Step 2: Exercise the real flow as a platform admin**

Log in as a platform admin, open Admin → Tenants, open a tenant with no catalog, set the business type to Surgical / Medical, save, then click Import catalog. Observe the toast.

- [ ] **Step 3: Measure the import**

Time the request end to end (browser devtools Network tab, or `time curl` against the endpoint with a platform-admin token).

Record: wall-clock seconds, and the `created` / `skipped` counts from the response.

Expected on a fresh tenant: `created: 1173`, `skipped: 0`, `groups: 24`, `subgroups: 103`, `brands: 42`.

- [ ] **Step 4: Verify re-runnability**

Click Import catalog a second time on the same tenant.
Expected: `created: 0`, `skipped: 1173`. No duplicate products, no unique-constraint error.

- [ ] **Step 5: Verify the products actually landed**

Impersonate the tenant (or query directly) and confirm the product list shows the imported catalog with groups, subgroups, and brands populated.

- [ ] **Step 6: Report the timing**

**If the import took more than ~10 seconds, stop and report to the user before proceeding.** The synchronous decision was made on the assumption of a few seconds; a materially slower result means revisiting it (batch the upserts, or fall back to fire-and-forget plus an audit row), which is a spec change and the user's call — not something to paper over with a timeout bump.

If it is fast, record the measured time in the completion notes.

---

### Task 7: Update TODO.md

**Files:**
- Modify: `TODO.md`

`CLAUDE.md` requires this after every task, no exceptions.

- [ ] **Step 1: Update and commit**

Check off any related items, and add to the `## COMPLETED` section:

```markdown
- [x] Platform-admin business type + starter catalog import; fixed seedBusinessTypeTemplate export bug that 500'd signup after tenant commit — done 2026-07-16
```

Add any newly discovered work items to the appropriate priority section. Two known candidates surfaced during design, both deliberately out of scope:
- A real build step for `packages/database` (the hand-written `.js` duplicates will drift again)
- Backend e2e specs — there are none, so guard wiring on admin routes is untested

```bash
git add TODO.md
git commit -m "docs: update TODO for admin catalog import"
```

---

## Notes for the implementer

- **The bug is live.** Before Task 2, `node -e "console.log(typeof require('./packages/database').seedBusinessTypeTemplate)"` prints `undefined` from the repo root. That is not a test artifact — it is what production does.
- **Why `try/catch` and not `.catch()`** (Task 3): calling `undefined(...)` throws synchronously, before a promise object exists, so there is nothing for `.catch()` to attach to. This is the single subtlety behind the whole incident.
- **Don't add a Prisma migration.** `business_type` stays a nullable free-form `String` (`schema.prisma:343`); validation is DTO-layer only, by decision in the spec. Only one of the four business types has a template, so the value set is still in flux.
- **Keep the `.ts` and `.js` seeder in sync.** If you change one in review, change both.
