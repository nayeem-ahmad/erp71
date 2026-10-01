# Branch Letterheads Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a multi-branch shop assign a different letterhead per store and document type, while single-branch tenants keep today’s company paper unchanged.

**Architecture:** Tenant-owned `PrintTemplate` rows stay as designs. New `PrintTemplateStoreAssignment` maps `(store, doc_type)` to a template. `resolve(tenantId, docType, storeId?)` prefers that override, then the existing doc-type / default / branding chain. Printers pass the **document’s** store into `usePrintHeader` / `resolve()`. Settings → Letterhead Design gains a **What each branch prints** card (hidden until two stores).

**Tech Stack:** NestJS, Prisma/`DatabaseService`, Jest; Next.js 15, React Testing Library, existing HeaderEditor, Tailwind, i18n catalog.

**Spec:** `docs/superpowers/specs/2026-10-01-branch-letterheads-design.md`

## Global Constraints

- Branch is `dev`. Never commit to `main`. Do not stage `.vscode/settings.json`.
- Backend tests from repo root: `npx jest --testPathPatterns="src/print-templates" --config apps/backend/jest.config.ts` (and `src/auth/route-authorization`). Frontend: `npm test --workspace apps/frontend -- <file>`.
- After schema change: `npx prisma generate --schema packages/database/prisma/schema.prisma`.
- No new `StorePermission`. Writes stay `SETTINGS_ADMIN`. Resolve and list assignments stay `PRINT_READ`.
- `GET/PUT /print-templates/assignments` and `GET /print-templates/resolve` are declared **before** `GET :id`.
- Public `/q/:token` keeps `resolve(tenantId, docType)` with **no** `storeId`.
- Message catalog: every locale (`en`, `bn`, `ar`, `de`, `es`, `fr`, `hi`, `ms`, `ur`) must keep the same key paths (`catalog.test.ts`). Real copy in `en` and `bn`; others may copy English.
- One `TODO.md` COMPLETED entry at feature ship, not per task.
- Author: Nayeem Ahmad `<nayeem.ahmad@gmail.com>`. Conventional commits; no Co-Authored-By.
- No Playwright e2e. No extra store contact fields.

## Review Focus

- A `storeId` that belongs to another tenant is ignored on resolve (company chain), never 404. Test in Task 3.
- Resolve without `storeId` must not treat a missing store filter as “no match”; it skips the override step. Test in Task 3.
- PUT `templateId: null` when no row exists is 200, not 404. Test in Task 3.
- A named template that is currently the company default is still a pin (override row stored). Test in Task 3.
- Sales list print of a Gulshan sale calls resolve with that sale’s `store_id`, not the session store. Test in Task 6.

---

## File Structure

| File | Responsibility |
|---|---|
| `packages/database/prisma/schema.prisma` | **modify** — `PrintTemplateStoreAssignment` + reverse arrays |
| `apps/backend/src/print-templates/print-templates.dto.ts` | **modify** — `storeId` on resolve query; upsert DTO; assignment response |
| `apps/backend/src/print-templates/print-templates.dto.spec.ts` | **modify** — whitelist / null `templateId` |
| `apps/backend/src/print-templates/print-templates.service.ts` | **modify** — `resolve(..., storeId?)`, `listAssignments`, `upsertAssignment` |
| `apps/backend/src/print-templates/print-templates.service.spec.ts` | **modify** — override, fallback, pin, clear |
| `apps/backend/src/print-templates/print-templates.controller.ts` | **modify** — assignments routes; pass `storeId` |
| `apps/backend/src/auth/route-authorization.roles.spec.ts` | **modify** — cashier GET assignments, not PUT |
| `apps/frontend/src/lib/api.ts` | **modify** — assignments + resolve `storeId` |
| `apps/frontend/src/lib/print/use-print-header.ts` | **modify** — cache key includes `storeId` |
| `apps/frontend/src/lib/print/use-print-header.test.tsx` | **modify** — cache isolation |
| `apps/frontend/src/lib/hooks/useSalePrinting.ts` | **modify** — resolve at click with `sale.store_id` |
| `apps/frontend/src/lib/hooks/usePurchasePrinting.ts` | **modify** — resolve at click with purchase store |
| `apps/frontend/src/lib/sale-print-actions.ts` | **modify** — pass store name/address |
| `apps/frontend/src/lib/sales-invoice-printer.ts` | **modify** — HeaderContext `storeName` |
| `apps/frontend/src/lib/pos-receipt-printer.ts` | **modify** — company vs store name |
| Other `usePrintHeader` call sites | **modify** — pass document/report store when the print has one |
| `apps/frontend/src/app/(app)/settings/print-templates/page.tsx` | **modify** — assignment card |
| `apps/frontend/src/app/(app)/settings/print-templates/page.test.tsx` | **modify** — hidden / PUT / revert |
| `apps/frontend/src/lib/localization/messages/*/settingsExtras.ts` | **modify** — new keys, all 9 locales |
| `TODO.md` | **modify** — one COMPLETED entry at ship |

---

### Task 1: Prisma model

**Files:**
- Modify: `packages/database/prisma/schema.prisma`

**Interfaces:**
- Consumes: existing `PrintTemplate`, `Store`, `Tenant`
- Produces: `PrintTemplateStoreAssignment` mapped to `print_template_store_assignments`; Prisma client `printTemplateStoreAssignment`; unique `tenant_id_store_id_doc_type`

- [ ] **Step 1: Add the model and reverse arrays**

On `PrintTemplate`, after `tenant Tenant @relation(...)`:

```
  storeAssignments PrintTemplateStoreAssignment[]
```

On `Tenant`, next to `printTemplates PrintTemplate[]`:

```
  printTemplateStoreAssignments PrintTemplateStoreAssignment[]
```

On `Store`, before `@@unique([tenant_id, name])`:

```
  printTemplateAssignments PrintTemplateStoreAssignment[]
```

After `model PrintTemplate { ... }`:

```
/// Per-store override of which letterhead a document type prints.
/// Empty means that branch follows the tenant assignment.
model PrintTemplateStoreAssignment {
  id          String   @id @default(uuid())
  tenant_id   String
  store_id    String
  doc_type    String
  template_id String
  created_at  DateTime @default(now())
  updated_at  DateTime @updatedAt

  tenant   Tenant        @relation(fields: [tenant_id], references: [id], onDelete: Cascade)
  store    Store         @relation(fields: [store_id], references: [id], onDelete: Cascade)
  template PrintTemplate @relation(fields: [template_id], references: [id], onDelete: Cascade)

  @@unique([tenant_id, store_id, doc_type])
  @@index([tenant_id, store_id])
  @@index([template_id])
  @@map("print_template_store_assignments")
}
```

- [ ] **Step 2: Generate the client**

Run: `npx prisma generate --schema packages/database/prisma/schema.prisma`
Expected: Prisma Client generated. No schema errors.

- [ ] **Step 3: Commit**

```bash
git add packages/database/prisma/schema.prisma
git commit -m "feat(print): store letterhead assignment table"
```

---

### Task 2: Assignment DTOs

**Files:**
- Modify: `apps/backend/src/print-templates/print-templates.dto.ts`
- Test: `apps/backend/src/print-templates/print-templates.dto.spec.ts`

**Interfaces:**
- Consumes: existing `PrintDocType`
- Produces:
  - `ResolvePrintTemplateQueryDto.storeId?: string`
  - `UpsertPrintTemplateAssignmentDto { storeId: string; docType: PrintDocType; templateId: string | null }`
  - `PrintTemplateAssignmentDto { store_id: string; doc_type: string; template_id: string }`

- [ ] **Step 1: Write the failing DTO tests** (append a new `describe` in `print-templates.dto.spec.ts`)

```ts
import { ResolvePrintTemplateQueryDto, UpsertPrintTemplateAssignmentDto } from './print-templates.dto';

describe('UpsertPrintTemplateAssignmentDto', () => {
    const parse = (body: Record<string, unknown>) =>
        validate(plainToInstance(UpsertPrintTemplateAssignmentDto, body), {
            whitelist: true,
            forbidNonWhitelisted: true,
        });

    const uuid = '11111111-1111-4111-8111-111111111111';
    const tpl = '22222222-2222-4222-8222-222222222222';

    it('accepts a pin to a named template', async () => {
        expect(await parse({ storeId: uuid, docType: 'SALES_INVOICE', templateId: tpl })).toHaveLength(0);
    });

    it('accepts templateId null to follow company paper', async () => {
        expect(await parse({ storeId: uuid, docType: 'SALES_INVOICE', templateId: null })).toHaveLength(0);
    });

    it('rejects an unknown property', async () => {
        expect(
            (await parse({ storeId: uuid, docType: 'SALES_INVOICE', templateId: tpl, extra: true })).length,
        ).toBeGreaterThan(0);
    });

    it('rejects a document type the printer has no family for', async () => {
        expect(
            (await parse({ storeId: uuid, docType: 'DELIVERY_NOTE', templateId: tpl })).length,
        ).toBeGreaterThan(0);
    });
});

describe('ResolvePrintTemplateQueryDto', () => {
    it('accepts an optional storeId', async () => {
        const errors = await validate(
            plainToInstance(ResolvePrintTemplateQueryDto, {
                docType: 'SALES_INVOICE',
                storeId: '11111111-1111-4111-8111-111111111111',
            }),
            { whitelist: true, forbidNonWhitelisted: true },
        );
        expect(errors).toHaveLength(0);
    });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest --config apps/backend/jest.config.ts --testPathPatterns=src/print-templates/print-templates.dto.spec.ts`
Expected: FAIL — `UpsertPrintTemplateAssignmentDto` is not exported.

- [ ] **Step 3: Add the DTOs**

In `print-templates.dto.ts` add `IsUUID` and `ValidateIf` to the class-validator import.

Extend `ResolvePrintTemplateQueryDto`:

```ts
export class ResolvePrintTemplateQueryDto {
    @IsOptional()
    @IsEnum(PrintDocType)
    docType?: PrintDocType;

    @IsOptional()
    @IsUUID()
    storeId?: string;
}
```

Add:

```ts
export class UpsertPrintTemplateAssignmentDto {
    @IsUUID()
    storeId: string;

    @IsEnum(PrintDocType)
    docType: PrintDocType;

    @ValidateIf((_o, value) => value !== null)
    @IsUUID()
    templateId: string | null;
}

export interface PrintTemplateAssignmentDto {
    store_id: string;
    doc_type: string;
    template_id: string;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest --config apps/backend/jest.config.ts --testPathPatterns=src/print-templates/print-templates.dto.spec.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/print-templates/print-templates.dto.ts apps/backend/src/print-templates/print-templates.dto.spec.ts
git commit -m "feat(print): DTOs for per-store letterhead assignment"
```

---

### Task 3: Resolve and upsert in the service

**Files:**
- Modify: `apps/backend/src/print-templates/print-templates.service.ts`
- Test: `apps/backend/src/print-templates/print-templates.service.spec.ts`

**Interfaces:**
- Consumes: `PrintTemplateStoreAssignment` from Task 1; DTOs from Task 2
- Produces:
  - `resolve(tenantId: string, docType?: PrintDocType, storeId?: string): Promise<ResolvedPrintTemplateDto>`
  - `listAssignments(tenantId: string): Promise<PrintTemplateAssignmentDto[]>`
  - `upsertAssignment(tenantId: string, dto: UpsertPrintTemplateAssignmentDto): Promise<{ success: true }>`

Wire the mock in `beforeEach` with:

```ts
printTemplateStoreAssignment: {
    findUnique: jest.fn(),
    findMany: jest.fn(),
    upsert: jest.fn(),
    deleteMany: jest.fn(),
},
store: { findFirst: jest.fn() },
```

Existing `resolve()` tests stay: they call `resolve('ten1', PrintDocType.X)` with two args. Add `printTemplateStoreAssignment.findUnique` default `mockResolvedValue(null)` so they do not throw if the third arg is later passed.

- [ ] **Step 1: Write the failing service tests** (append)

```ts
import { BadRequestException } from '@nestjs/common';

describe('resolve() with a store', () => {
    it('prefers a store override over the tenant doc-type template', async () => {
        db.store.findFirst.mockResolvedValue({ id: 's1', tenant_id: 'ten1' });
        db.printTemplateStoreAssignment.findUnique.mockResolvedValue({
            template: template({ id: 'gulshan', is_default: false, doc_types: [] }),
        });
        db.printTemplate.findMany.mockResolvedValue([
            template({ id: 'default', is_default: true }),
            template({ id: 'invoice', is_default: false, doc_types: ['SALES_INVOICE'] }),
        ]);

        const result = await service.resolve('ten1', PrintDocType.SALES_INVOICE, 's1');
        expect(result.template_id).toBe('gulshan');
    });

    it('falls back to the tenant chain when the store has no override', async () => {
        db.store.findFirst.mockResolvedValue({ id: 's1', tenant_id: 'ten1' });
        db.printTemplateStoreAssignment.findUnique.mockResolvedValue(null);
        db.printTemplate.findMany.mockResolvedValue([
            template({ id: 'invoice', is_default: false, doc_types: ['SALES_INVOICE'] }),
        ]);

        const result = await service.resolve('ten1', PrintDocType.SALES_INVOICE, 's1');
        expect(result.template_id).toBe('invoice');
    });

    it('ignores a storeId that is not this tenant’s store', async () => {
        db.store.findFirst.mockResolvedValue(null);
        db.printTemplate.findMany.mockResolvedValue([
            template({ id: 'invoice', is_default: false, doc_types: ['SALES_INVOICE'] }),
        ]);

        const result = await service.resolve('ten1', PrintDocType.SALES_INVOICE, 'foreign');
        expect(result.template_id).toBe('invoice');
        expect(db.printTemplateStoreAssignment.findUnique).not.toHaveBeenCalled();
    });

    it('skips the override step when storeId is omitted', async () => {
        db.printTemplate.findMany.mockResolvedValue([
            template({ id: 'invoice', is_default: false, doc_types: ['SALES_INVOICE'] }),
        ]);

        const result = await service.resolve('ten1', PrintDocType.SALES_INVOICE);
        expect(result.template_id).toBe('invoice');
        expect(db.store.findFirst).not.toHaveBeenCalled();
        expect(db.printTemplateStoreAssignment.findUnique).not.toHaveBeenCalled();
    });
});

describe('upsertAssignment()', () => {
    const uuidStore = '11111111-1111-4111-8111-111111111111';
    const uuidTpl = '22222222-2222-4222-8222-222222222222';

    it('upserts a pin to a named template', async () => {
        db.store.findFirst.mockResolvedValue({ id: uuidStore, tenant_id: 'ten1' });
        db.printTemplate.findFirst.mockResolvedValue(template({ id: uuidTpl }));
        db.printTemplateStoreAssignment.upsert.mockResolvedValue({});

        await service.upsertAssignment('ten1', {
            storeId: uuidStore,
            docType: PrintDocType.SALES_INVOICE,
            templateId: uuidTpl,
        });

        expect(db.printTemplateStoreAssignment.upsert).toHaveBeenCalledWith(
            expect.objectContaining({
                where: {
                    tenant_id_store_id_doc_type: {
                        tenant_id: 'ten1',
                        store_id: uuidStore,
                        doc_type: 'SALES_INVOICE',
                    },
                },
            }),
        );
    });

    it('clears a missing pin as a no-op', async () => {
        db.store.findFirst.mockResolvedValue({ id: uuidStore, tenant_id: 'ten1' });
        db.printTemplateStoreAssignment.deleteMany.mockResolvedValue({ count: 0 });

        await expect(
            service.upsertAssignment('ten1', {
                storeId: uuidStore,
                docType: PrintDocType.SALES_INVOICE,
                templateId: null,
            }),
        ).resolves.toEqual({ success: true });
        expect(db.printTemplateStoreAssignment.upsert).not.toHaveBeenCalled();
    });

    it('rejects a template from another tenant', async () => {
        db.store.findFirst.mockResolvedValue({ id: uuidStore, tenant_id: 'ten1' });
        db.printTemplate.findFirst.mockResolvedValue(null);

        await expect(
            service.upsertAssignment('ten1', {
                storeId: uuidStore,
                docType: PrintDocType.SALES_INVOICE,
                templateId: uuidTpl,
            }),
        ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects a store from another tenant', async () => {
        db.store.findFirst.mockResolvedValue(null);

        await expect(
            service.upsertAssignment('ten1', {
                storeId: uuidStore,
                docType: PrintDocType.SALES_INVOICE,
                templateId: uuidTpl,
            }),
        ).rejects.toBeInstanceOf(BadRequestException);
    });
});

describe('listAssignments()', () => {
    it('returns the tenant’s override rows', async () => {
        db.printTemplateStoreAssignment.findMany.mockResolvedValue([
            { store_id: 's1', doc_type: 'SALES_INVOICE', template_id: 'tpl1' },
        ]);
        expect(await service.listAssignments('ten1')).toEqual([
            { store_id: 's1', doc_type: 'SALES_INVOICE', template_id: 'tpl1' },
        ]);
    });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest --config apps/backend/jest.config.ts --testPathPatterns=src/print-templates/print-templates.service.spec.ts`
Expected: FAIL — `resolve` does not take `storeId` / `upsertAssignment` is not a function.

- [ ] **Step 3: Implement**

Import `BadRequestException` and `UpsertPrintTemplateAssignmentDto`, `PrintTemplateAssignmentDto`.

```ts
async resolve(
    tenantId: string,
    docType?: PrintDocType,
    storeId?: string,
): Promise<ResolvedPrintTemplateDto> {
    if (storeId && docType) {
        const store = await this.db.store.findFirst({
            where: { id: storeId, tenant_id: tenantId },
            select: { id: true },
        });
        if (store) {
            const override = await this.db.printTemplateStoreAssignment.findUnique({
                where: {
                    tenant_id_store_id_doc_type: {
                        tenant_id: tenantId,
                        store_id: storeId,
                        doc_type: docType,
                    },
                },
                include: { template: true },
            });
            if (override?.template) {
                return {
                    template_id: override.template.id,
                    name: override.template.name,
                    config: override.template.config as Record<string, unknown>,
                };
            }
        }
    }

    // existing findMany / assigned / default / branding body unchanged
}

async listAssignments(tenantId: string): Promise<PrintTemplateAssignmentDto[]> {
    const rows = await this.db.printTemplateStoreAssignment.findMany({
        where: { tenant_id: tenantId },
        select: { store_id: true, doc_type: true, template_id: true },
    });
    return rows;
}

async upsertAssignment(
    tenantId: string,
    dto: UpsertPrintTemplateAssignmentDto,
): Promise<{ success: true }> {
    const store = await this.db.store.findFirst({
        where: { id: dto.storeId, tenant_id: tenantId },
        select: { id: true },
    });
    if (!store) throw new BadRequestException('Store not found');

    if (dto.templateId === null) {
        await this.db.printTemplateStoreAssignment.deleteMany({
            where: {
                tenant_id: tenantId,
                store_id: dto.storeId,
                doc_type: dto.docType,
            },
        });
        return { success: true };
    }

    const template = await this.db.printTemplate.findFirst({
        where: { id: dto.templateId, tenant_id: tenantId },
        select: { id: true },
    });
    if (!template) throw new BadRequestException('Print template not found');

    await this.db.printTemplateStoreAssignment.upsert({
        where: {
            tenant_id_store_id_doc_type: {
                tenant_id: tenantId,
                store_id: dto.storeId,
                doc_type: dto.docType,
            },
        },
        create: {
            tenant_id: tenantId,
            store_id: dto.storeId,
            doc_type: dto.docType,
            template_id: dto.templateId,
        },
        update: { template_id: dto.templateId },
    });
    return { success: true };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest --config apps/backend/jest.config.ts --testPathPatterns=src/print-templates/print-templates.service.spec.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/print-templates/print-templates.service.ts apps/backend/src/print-templates/print-templates.service.spec.ts
git commit -m "feat(print): resolve letterhead by store override"
```

---

### Task 4: Controller routes and role pins

**Files:**
- Modify: `apps/backend/src/print-templates/print-templates.controller.ts`
- Modify: `apps/backend/src/auth/route-authorization.roles.spec.ts`

**Interfaces:**
- Consumes: service methods from Task 3
- Produces:
  - `GET /print-templates/assignments` `PRINT_READ`
  - `PUT /print-templates/assignments` `SETTINGS_ADMIN`
  - `GET /print-templates/resolve?docType=&storeId=` passes `query.storeId`

Need `Put` in the `@nestjs/common` import.

Declare **before** `@Get(':id')`:

```ts
@RequireAnyStorePermission(...PRINT_READ)
@Get('assignments')
async listAssignments(@Tenant() tenant: TenantContext) {
    return this.printTemplatesService.listAssignments(tenant.tenantId);
}

@RequireAnyStorePermission(...SETTINGS_ADMIN)
@Put('assignments')
async upsertAssignment(
    @Tenant() tenant: TenantContext,
    @Body() dto: UpsertPrintTemplateAssignmentDto,
) {
    return this.printTemplatesService.upsertAssignment(tenant.tenantId, dto);
}
```

Change resolve:

```ts
return this.printTemplatesService.resolve(tenant.tenantId, query.docType, query.storeId);
```

In `route-authorization.roles.spec.ts` cashier `canReach` list, add `'GET /print-templates/assignments'` next to `'GET /print-templates/resolve'`.

In cashier `cannotReach` list, add `'PUT /print-templates/assignments'`.

Find the tenant_admin / SETTINGS canReach list and add `'PUT /print-templates/assignments'` if that file pins settings writes. If no such list exists for `POST /print-templates`, skip — the scanner + SETTINGS_ADMIN decorator is the gate.

- [ ] **Step 1: Write the failing role pin** (cashier cannot PUT)

Add `'PUT /print-templates/assignments'` to cashier `cannotReach`. Run:

`npx jest --config apps/backend/jest.config.ts --testPathPatterns=src/auth/route-authorization.roles.spec.ts`

Expected: FAIL — `no such route: PUT /print-templates/assignments`

- [ ] **Step 2: Add the controller routes** (as above)

- [ ] **Step 3: Re-run role spec plus route-authorization.spec.ts**

```
npx jest --config apps/backend/jest.config.ts --testPathPatterns="src/auth/route-authorization"
```

Expected: PASS. Cashier reaches GET assignments. PUT is gated. No new OPEN_ROUTES entry.

- [ ] **Step 4: Commit**

```bash
git add apps/backend/src/print-templates/print-templates.controller.ts apps/backend/src/auth/route-authorization.roles.spec.ts
git commit -m "feat(print): assignment routes before print-templates :id"
```

---

### Task 5: `usePrintHeader` cache includes storeId

**Files:**
- Modify: `apps/frontend/src/lib/print/use-print-header.ts`
- Test: `apps/frontend/src/lib/print/use-print-header.test.tsx`
- Modify: `apps/frontend/src/lib/api.ts`

**Interfaces:**
- Consumes: `GET /print-templates/resolve?docType=&storeId=`
- Produces:
  - `usePrintHeader(docType?: PrintDocType, { eager?: boolean; storeId?: string })`
  - `PrintHeader.resolve(storeId?: string): Promise<PrintHeader>`
  - Cache key `` `${docType ?? 'DEFAULT'}:${storeId ?? ''}` ``
  - `api.getPrintTemplateAssignments()`, `api.upsertPrintTemplateAssignment(body)`

- [ ] **Step 1: Write the failing hook tests**

```ts
it('caches tenant and store resolves separately', async () => {
    mockFetch.mockImplementation((url: string) => {
        if (String(url).includes('storeId=s1')) {
            return Promise.resolve({ template_id: 'g', name: 'Gulshan', config: { layout: 'logo-center' } });
        }
        return Promise.resolve({ template_id: 'c', name: 'Company', config: { layout: 'logo-left' } });
    });

    const company = renderHook(() => usePrintHeader('SALES_INVOICE'));
    await waitFor(() => expect(company.result.current.headerConfig.layout).toBe('logo-left'));

    const branch = renderHook(() => usePrintHeader('SALES_INVOICE', { storeId: 's1' }));
    await waitFor(() => expect(branch.result.current.headerConfig.layout).toBe('logo-center'));

    expect(mockFetch).toHaveBeenCalledWith('/print-templates/resolve?docType=SALES_INVOICE');
    expect(mockFetch).toHaveBeenCalledWith('/print-templates/resolve?docType=SALES_INVOICE&storeId=s1');
});

it('resolve(storeId) fetches that store’s template', async () => {
    mockFetch.mockResolvedValue({ template_id: 'g', name: 'Gulshan', config: { layout: 'logo-above' } });
    const { result } = renderHook(() => usePrintHeader('SALES_INVOICE', { eager: false }));
    await result.current.resolve('s1');
    expect(mockFetch).toHaveBeenCalledWith('/print-templates/resolve?docType=SALES_INVOICE&storeId=s1');
});
```

Keep the existing “requests each document type once” test: both hooks have no storeId, still one fetch.

- [ ] **Step 2: Run to verify fail**

Run: `npm test --workspace apps/frontend -- src/lib/print/use-print-header.test.tsx`
Expected: FAIL — `resolve` does not take a store id / query has no storeId.

- [ ] **Step 3: Implement**

`resolveTemplate(docType?: PrintDocType, storeId?: string)`:

```ts
const key = `${docType ?? 'DEFAULT'}:${storeId ?? ''}`;
const params = new URLSearchParams();
if (docType) params.set('docType', docType);
if (storeId) params.set('storeId', storeId);
const query = params.toString() ? `?${params.toString()}` : '';
```

`usePrintHeader(docType?, { eager = true, storeId }: UsePrintHeaderOptions = {})`

`resolve` callback:

```ts
const resolve = useCallback(async (nextStoreId?: string): Promise<PrintHeader> => {
    const id = nextStoreId ?? storeId;
    const resolved = await resolveTemplate(docType, id);
    ...
}, [docType, storeId, fallbackConfig, companyName]);
```

Eager effect depends on `[docType, storeId, eager]`.

In `api.ts` next to the existing print-template helpers:

```ts
getPrintTemplateAssignments: () => fetchWithAuth('/print-templates/assignments'),
upsertPrintTemplateAssignment: (data: { storeId: string; docType: string; templateId: string | null }) =>
    fetchWithAuth('/print-templates/assignments', {
        method: 'PUT',
        body: JSON.stringify(data),
        headers: { 'Content-Type': 'application/json' },
    }),
```

- [ ] **Step 4: Run tests to pass**

Run: `npm test --workspace apps/frontend -- src/lib/print/use-print-header.test.tsx`
Expected: PASS (existing cases still call `/print-templates/resolve?docType=SALES_INVOICE` with no storeId).

- [ ] **Step 5: Commit**

```bash
git add apps/frontend/src/lib/print/use-print-header.ts apps/frontend/src/lib/print/use-print-header.test.tsx apps/frontend/src/lib/api.ts
git commit -m "feat(print): cache resolved letterhead per store"
```

---

### Task 6: Sale and purchase print use the document’s store

**Files:**
- Modify: `apps/frontend/src/lib/sale-print-actions.ts`
- Modify: `apps/frontend/src/lib/sales-invoice-printer.ts`
- Modify: `apps/frontend/src/lib/pos-receipt-printer.ts`
- Modify: `apps/frontend/src/lib/hooks/useSalePrinting.ts`
- Modify: `apps/frontend/src/lib/hooks/usePurchasePrinting.ts`
- Test: `apps/frontend/src/lib/sale-print-actions.test.ts`
- Test: `apps/frontend/src/lib/sales-invoice-printer.test.ts`

**Interfaces:**
- Consumes: `PrintHeader.resolve(storeId?: string)` from Task 5
- Produces: invoice HeaderContext `storeName` from the sale’s store; address from store when non-empty

Add to `PrintableSale`:

```ts
store_id?: string | null;
store?: { name?: string; address?: string | null } | null;
```

Add optional `storeName?: string; companyAddress?: string` on the object `printSaleInvoice` passes to `printSalesInvoice`.

`printSalesInvoice` HeaderContext:

```ts
storeName: data.storeName,
address: data.companyAddress || data.companyAddress, // store address wins when the caller set companyAddress from the store
```

Spec: store address when non-empty, else company address. So `printSaleInvoice` should set:

```ts
companyAddress: sale.store?.address || undefined,
storeName: sale.store?.name,
```

And `printSalesInvoice`:

```ts
storeName: data.storeName,
address: data.companyAddress || data.companyAddress,
```

Wait — InvoiceData already has `companyAddress`. Pass store address as `companyAddress` when present, and always pass `storeName`. Add `storeName?: string` to `InvoiceData`.

```ts
const headerContext: HeaderContext = {
    ...
    companyName: data.companyName || 'RETAIL STORE',
    storeName: data.storeName,
    address: data.companyAddress,
    phone: data.companyPhone,
};
```

POS receipt (`printPOSReceipt` HeaderContext):

```ts
companyName: data.companyName || data.storeName || 'RETAIL STORE',
storeName: data.storeName,
```

Add `companyName?: string` to the POS data type if missing; `printSaleReceipt` currently sets `storeName: ctx.invoiceHeader.companyName`. Change to:

```ts
companyName: ctx.invoiceHeader.companyName,
storeName: sale.store?.name,
```

`useSalePrinting` — do not use mount-time headerConfig for the print. Inside `withSale`, after loading the sale:

```ts
const storeId = sale.store_id ?? sale.store?.id;
const [invoice, challan] = await Promise.all([
    invoiceHeader.resolve(storeId ?? undefined),
    challanHeader.resolve(storeId ?? undefined),
]);
await print(sale, { ...ctx, invoiceHeader: invoice, challanHeader: challan });
```

That requires `print` to take ctx or withSale to rebuild ctx. Simplest: change the inner `print` callback to receive the sale, and `withSale` resolves headers then calls `printSaleInvoice(sale, size, { ...ctx, invoiceHeader }, skipPreview)`.

`usePurchasePrinting`: after `getPurchaseInvoice`, `const headerForPrint = await header.resolve(data.purchase.store_id ?? data.purchase.store?.id)` and pass `{ ...ctx, header: headerForPrint }`.

- [ ] **Step 1: Failing tests**

In `sale-print-actions.test.ts`:

```ts
it('passes the sale’s store name onto the invoice', () => {
    printSaleInvoice(
        { ...listShapedSale, store: { name: 'Gulshan', address: '12 Gulshan Ave' } },
        'A4',
        ctx,
        true,
    );
    expect(printSalesInvoice).toHaveBeenCalledWith(
        expect.objectContaining({
            storeName: 'Gulshan',
            companyAddress: '12 Gulshan Ave',
        }),
        'A4',
        undefined,
    );
});
```

In `sales-invoice-printer.test.ts` (uses `document.write` HTML):

```ts
it('substitutes {{store_name}} from the sale’s store', () => {
    const html = render({
        ...baseInvoice,
        storeName: 'Gulshan',
        headerConfig: { lines: [{ text: '{{store_name}}' }] },
    });
    expect(html).toContain('Gulshan');
});
```

If `headerConfig.lines` needs more fields, merge over defaults — `renderHeaderHtml` already does `resolveHeaderConfig`.

- [ ] **Step 2: Run to fail**

`npm test --workspace apps/frontend -- src/lib/sale-print-actions.test.ts src/lib/sales-invoice-printer.test.ts`
Expected: FAIL — `storeName` not in invoice payload / HTML.

- [ ] **Step 3: Implement** as specified above. Check `pos-receipt-printer.ts` data type for `companyName`.

- [ ] **Step 4: Run to pass** those two files plus any existing pos-receipt tests:

`npm test --workspace apps/frontend -- src/lib/sale-print-actions.test.ts src/lib/sales-invoice-printer.test.ts src/lib/pos-receipt-printer.ts`
(If pos-receipt has a `.test.ts`, run that.)

- [ ] **Step 5: Commit**

```bash
git add apps/frontend/src/lib/sale-print-actions.ts apps/frontend/src/lib/sale-print-actions.test.ts apps/frontend/src/lib/sales-invoice-printer.ts apps/frontend/src/lib/sales-invoice-printer.test.ts apps/frontend/src/lib/pos-receipt-printer.ts apps/frontend/src/lib/hooks/useSalePrinting.ts apps/frontend/src/lib/hooks/usePurchasePrinting.ts
git commit -m "feat(print): use the document store for letterhead and tokens"
```

---

### Task 7: Remaining print call sites

**Files:** every remaining `usePrintHeader(...)` call site. Pass the document or report store when the print has one; omit it for company / all-stores / public quotation.

| File | storeId |
|---|---|
| `sales/pos/page.tsx` | sale / current POS store on print |
| `sales/new/page.tsx` | the sale’s store |
| `sales/daily-report/page.tsx` | the report’s `storeId` |
| `sales/quotes/page.tsx` | quotation.store_id (in-app only) |
| `sales/orders/page.tsx`, `sales/orders/[id]/page.tsx` | order.store_id |
| `sales/returns/page.tsx`, `sales/returns/[id]/page.tsx` | return.store_id |
| `sales/customer-payments/page.tsx` | payment store when present |
| `purchases/returns/[id]/page.tsx` | return.store_id |
| `purchases/supplier-payments/page.tsx` | payment store when present |
| `accounting/vouchers/page.tsx` | voucher.store_id when present |
| `accounting/reports/pl/page.tsx`, `balance-sheet/page.tsx`, `trial-balance/page.tsx` | pass `storeId` only when `scope === 'branch'` (one store); omit for company / all stores |
| `components/data-table/DataTable.tsx` | omit (list reports spanning the current filter; no single document store) |

Do **not** change `apps/backend/src/sales-quotations/sales-quotations.service.ts` `shareLetterhead` — it already calls `resolve(tenantId, docType)` with two arguments.

- [ ] **Step 1: Pin public quotation stays company paper**

In `apps/backend/src/sales-quotations/sales-quotations.service.spec.ts` (or public-quotation spec), add or extend a test that `printTemplates.resolve` is called with two arguments (tenantId, docType) and **not** the quote’s store id. If no existing mock, skip adding a new spec file; add the assertion to the nearest existing `shareLetterhead` / public quotation test.

- [ ] **Step 2: Wire each call site**

Pattern for a page that already has `storeId` in state (daily report, store-scoped P&L):

```ts
const printHeader = usePrintHeader('DAILY_REPORT', { storeId: storeId || undefined });
```

Pattern for a list that prints a row: on click, `await printHeader.resolve(row.store_id)` before opening the print window. If the page currently uses `printHeader.headerConfig` directly, switch that print handler to `const header = await printHeader.resolve(row.store_id)`.

P&L / BS / TB: `usePrintHeader('LIST_REPORT', { storeId: scope === 'branch' ? storeId : undefined })`.

- [ ] **Step 3: Run the affected page tests**

`npm test --workspace apps/frontend -- src/app/(app)/sales/daily-report/page.test.tsx src/app/(app)/sales/quotes`
Expected: PASS (mocks of `usePrintHeader` already return `{ headerConfig, resolve }`; if a test asserts the hook was called with only the doc type, update it to allow the optional storeId).

- [ ] **Step 4: Commit**

```bash
git add apps/frontend/src/app apps/frontend/src/components/data-table/DataTable.tsx
git commit -m "feat(print): pass document store into letterhead resolve"
```

---

### Task 8: i18n keys

**Files:** `apps/frontend/src/lib/localization/messages/{en,bn,ar,de,es,fr,hi,ms,ur}/settingsExtras.ts`

**Interfaces:**
- Consumes: none
- Produces: `settingsExtras.printTemplates.assignments` with the same keys in all 9 files

Add inside `printTemplates` (sibling of `sections`):

```ts
assignments: {
    title: 'What each branch prints',
    company: 'Company',
    hint: 'Company default follows the template assigned to that document type. A named template stays on this branch if company paper later changes.',
    companyDefault: 'Company default',
    saveFailed: 'Failed to save the branch letterhead.',
    loadFailed: 'Failed to load branch letterheads.',
    companyHelp: 'Company paper is assigned on each template via document types, below.',
},
```

`en` as above. `bn` real Bangla. Other 7 locales may copy the English strings.

- [ ] **Step 1: Add keys to `en` and `bn` first, run catalog test to watch other locales fail**

Run: `npm test --workspace apps/frontend -- src/lib/localization/messages/catalog.test.ts`
Expected: FAIL — missing `assignments` on other locales.

- [ ] **Step 2: Add the same key tree to the other seven files**

- [ ] **Step 3: Re-run catalog test**

Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add apps/frontend/src/lib/localization/messages
git commit -m "feat(print): i18n for branch letterhead assignment"
```

---

### Task 9: Assignment card on Letterhead Design

**Files:**
- Modify: `apps/frontend/src/app/(app)/settings/print-templates/page.tsx`
- Test: `apps/frontend/src/app/(app)/settings/print-templates/page.test.tsx`

**Interfaces:**
- Consumes: `api.getStores`, `api.getPrintTemplateAssignments`, `api.upsertPrintTemplateAssignment`, `clearPrintTemplateCache`, `copy.assignments`, `HeaderEditor` `DOC_TYPES` (export the array from `HeaderEditor.tsx` or duplicate the list — **export `DOC_TYPES`** from HeaderEditor to stay in lockstep)

Card is **above** the template chips. Hidden when `stores.length < 2`.

- [ ] **Step 1: Export `DOC_TYPES` from HeaderEditor** (same array). Import it in the page.

- [ ] **Step 2: Write failing page tests**

Extend the api mock:

```ts
getStores: jest.fn(),
getPrintTemplateAssignments: jest.fn(),
upsertPrintTemplateAssignment: jest.fn(),
```

`beforeEach`:

```ts
(mockApi.getStores as jest.Mock).mockResolvedValue([{ id: 's1', name: 'Main' }]);
(mockApi.getPrintTemplateAssignments as jest.Mock).mockResolvedValue([]);
```

```ts
it('hides branch assignment when the tenant has one store', async () => {
    render(<PrintTemplatesPage />);
    await screen.findByText('Letterhead');
    expect(screen.queryByText('What each branch prints')).not.toBeInTheDocument();
});

it('shows branch assignment when the tenant has two stores', async () => {
    (mockApi.getStores as jest.Mock).mockResolvedValue([
        { id: 's1', name: 'Gulshan' },
        { id: 's2', name: 'Dhanmondi' },
    ]);
    render(<PrintTemplatesPage />);
    expect(await screen.findByText('What each branch prints')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Gulshan' }));
    expect(screen.getByText('Company default')).toBeInTheDocument();
});

it('PUTs a named template for the selected branch and type', async () => {
    (mockApi.getStores as jest.Mock).mockResolvedValue([
        { id: 's1', name: 'Gulshan' },
        { id: 's2', name: 'Dhanmondi' },
    ]);
    (mockApi.upsertPrintTemplateAssignment as jest.Mock).mockResolvedValue({ success: true });
    render(<PrintTemplatesPage />);
    await screen.findByText('What each branch prints');
    fireEvent.click(screen.getByRole('button', { name: 'Gulshan' }));
    const selects = screen.getAllByRole('combobox');
    // first combobox in the card is Sales invoice (DOC_TYPES[0] === SALES_INVOICE)
    fireEvent.change(selects[0], { target: { value: 'tpl1' } });
    await waitFor(() =>
        expect(mockApi.upsertPrintTemplateAssignment).toHaveBeenCalledWith({
            storeId: 's1',
            docType: 'SALES_INVOICE',
            templateId: 'tpl1',
        }),
    );
});

it('PUTs templateId null for Company default', async () => {
    (mockApi.getStores as jest.Mock).mockResolvedValue([
        { id: 's1', name: 'Gulshan' },
        { id: 's2', name: 'Dhanmondi' },
    ]);
    (mockApi.getPrintTemplateAssignments as jest.Mock).mockResolvedValue([
        { store_id: 's1', doc_type: 'SALES_INVOICE', template_id: 'tpl1' },
    ]);
    (mockApi.upsertPrintTemplateAssignment as jest.Mock).mockResolvedValue({ success: true });
    render(<PrintTemplatesPage />);
    await screen.findByText('What each branch prints');
    fireEvent.click(screen.getByRole('button', { name: 'Gulshan' }));
    fireEvent.change(screen.getAllByRole('combobox')[0], { target: { value: '' } });
    await waitFor(() =>
        expect(mockApi.upsertPrintTemplateAssignment).toHaveBeenCalledWith({
            storeId: 's1',
            docType: 'SALES_INVOICE',
            templateId: null,
        }),
    );
});

it('reverts the select when PUT fails', async () => {
    (mockApi.getStores as jest.Mock).mockResolvedValue([
        { id: 's1', name: 'Gulshan' },
        { id: 's2', name: 'Dhanmondi' },
    ]);
    (mockApi.upsertPrintTemplateAssignment as jest.Mock).mockRejectedValue(new Error('nope'));
    render(<PrintTemplatesPage />);
    await screen.findByText('What each branch prints');
    fireEvent.click(screen.getByRole('button', { name: 'Gulshan' }));
    fireEvent.change(screen.getAllByRole('combobox')[0], { target: { value: 'tpl1' } });
    await waitFor(() => expect(mockApi.upsertPrintTemplateAssignment).toHaveBeenCalled());
    expect((screen.getAllByRole('combobox')[0] as HTMLSelectElement).value).toBe('');
});
```

Note: the preview paper-size `<Select>` is also a combobox. Scope the assignment selects: put `aria-label={copy.docTypes[docType]}` on each assignment `<select>` and query `getByRole('combobox', { name: 'Sales Invoice' })` (use the actual `copy.docTypes.SALES_INVOICE` string from en). Adjust the test names to that label rather than `selects[0]`.

- [ ] **Step 3: Run to fail**

`npm test --workspace apps/frontend -- src/app/(app)/settings/print-templates/page.test.tsx`
Expected: FAIL — card copy not rendered / getStores not mocked (existing tests must still pass: mock `getStores` as one store so the card stays hidden).

- [ ] **Step 4: Implement the card** in `page.tsx`

Load `api.getStores()` and `api.getPrintTemplateAssignments()` alongside templates.

State: `stores: {id,name}[]`, `assignments: PrintTemplateAssignmentDto[]`, `assignStoreId: string | 'company'` default `'company'`.

On store pill click, show a row per `DOC_TYPES`. Value of the select is the assignment’s `template_id` or `''` for Company default.

`onChange`: optimistic set, `PUT`, `clearPrintTemplateCache()` on success; on failure toast `copy.assignments.saveFailed` and restore previous value.

Company pill: paragraph `copy.assignments.companyHelp`. No dropdowns.

Do not write assignments from template Save.

- [ ] **Step 5: Run page tests to pass**

Expected: PASS, including existing save/delete/upload tests.

- [ ] **Step 6: Commit**

```bash
git add apps/frontend/src/app/(app)/settings/print-templates
git commit -m "feat(print): assign letterheads per branch on the design page"
```

---

### Task 10: Ship checklist

**Files:**
- Modify: `TODO.md`

- [ ] **Step 1: Run the focused suites**

```
npx jest --config apps/backend/jest.config.ts --testPathPatterns="src/print-templates|src/auth/route-authorization"
npm test --workspace apps/frontend -- src/lib/print/use-print-header.test.tsx src/lib/sale-print-actions.test.ts src/lib/sales-invoice-printer.test.ts src/app/(app)/settings/print-templates/page.test.tsx src/lib/localization/messages/catalog.test.ts
```

Expected: PASS

- [ ] **Step 2: Add one COMPLETED entry** at the top of `TODO.md` `## COMPLETED` (create that heading if the file’s convention puts completed items at the bottom — follow the existing COMPLETED section):

```
- [x] **Per-branch letterheads** — store override of which print template a document type uses; unset follows company paper. 2026-10-01
```

- [ ] **Step 3: Commit**

```bash
git add TODO.md
git commit -m "docs: note branch letterheads as completed"
```
