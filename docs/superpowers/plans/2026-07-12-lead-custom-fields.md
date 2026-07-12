# Lead Custom Fields Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let each tenant define up to 10 text-only custom fields on CRM Leads, built on a reusable custom-fields engine.

**Architecture:** A generic `CustomFieldDefinition` table keyed by a `CustomFieldEntity` enum stores per-tenant field definitions (10 stable slots `cf_1`…`cf_10`). Per-lead values live in a `Lead.custom_fields` JSONB column. A new backend `custom-fields` module exposes GET/PUT; the leads create/update/import paths sanitize values against active definitions. The frontend gets a CRM settings config page plus custom inputs/columns on the lead form, detail, list, and CSV import.

**Tech Stack:** NestJS + Prisma (PostgreSQL), Next.js 15 + React, class-validator, Jest, `@erp71/shared-types` permission matrix.

## Global Constraints

- All business queries scoped to `tenantId` via `TenantInterceptor` (see [CLAUDE.md](../../../CLAUDE.md)).
- New permissions added to `packages/shared-types/index.ts` first.
- Prisma schema changes require a migration file; production applies via `prisma db push` on backend startup (reads `schema.prisma` directly), so the migration is for local/history parity.
- Backend tests: `cd apps/backend && npx jest <path>`.
- Day-to-day work on `dev` branch; commit frequently.
- Field cap: **10 active** definitions per tenant per entity. Field type: **text only**. Deletion is **non-destructive** (deactivate slot, keep stored values).
- Custom field value: coerce to trimmed string, ≤ 500 chars. Label: required, trimmed, ≤ 40 chars, unique among active fields.

---

### Task 1: Prisma schema — CustomFieldDefinition model + Lead.custom_fields

**Files:**
- Modify: `packages/database/prisma/schema.prisma` (Lead model ~line 1375; Tenant model ~line 320; add enum + model)
- Create: `packages/database/prisma/migrations/20260712130000_add_lead_custom_fields/migration.sql`

**Interfaces:**
- Produces: Prisma model `CustomFieldDefinition` with fields `id, tenant_id, entity, key, label, order, is_active, created_at, updated_at`; enum `CustomFieldEntity { LEAD }`; `Lead.custom_fields Json?`. Prisma client accessor `db.customFieldDefinition`.

- [ ] **Step 1: Add the enum and model to schema.prisma**

Add near the other CRM models (after the `Lead` model block, before the next model). Insert the enum next to other enums or directly above the model:

```prisma
enum CustomFieldEntity {
  LEAD
}

model CustomFieldDefinition {
  id         String            @id @default(uuid())
  tenant_id  String
  entity     CustomFieldEntity
  key        String
  label      String
  order      Int               @default(0)
  is_active  Boolean           @default(true)
  created_at DateTime          @default(now())
  updated_at DateTime          @updatedAt

  tenant Tenant @relation(fields: [tenant_id], references: [id], onDelete: Cascade)

  @@unique([tenant_id, entity, key])
  @@index([tenant_id, entity])
}
```

- [ ] **Step 2: Add the JSON column to the Lead model**

In `model Lead { … }`, add after the `mobile` line:

```prisma
  custom_fields           Json?
```

- [ ] **Step 3: Add the back-relation on the Tenant model**

In `model Tenant { … }`, in its relations block (where other `SomeModel[]` relations are listed), add:

```prisma
  customFieldDefinitions CustomFieldDefinition[]
```

- [ ] **Step 4: Format and validate the schema**

Run: `cd packages/database && npx prisma format && npx prisma validate`
Expected: `The schema at prisma/schema.prisma is valid 🚀`

- [ ] **Step 5: Write the migration SQL**

Create `packages/database/prisma/migrations/20260712130000_add_lead_custom_fields/migration.sql`:

```sql
-- Reusable per-tenant custom fields, wired to leads first.
CREATE TYPE "CustomFieldEntity" AS ENUM ('LEAD');

CREATE TABLE "CustomFieldDefinition" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "entity" "CustomFieldEntity" NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CustomFieldDefinition_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CustomFieldDefinition_tenant_id_entity_key_key" ON "CustomFieldDefinition"("tenant_id", "entity", "key");
CREATE INDEX "CustomFieldDefinition_tenant_id_entity_idx" ON "CustomFieldDefinition"("tenant_id", "entity");

ALTER TABLE "CustomFieldDefinition" ADD CONSTRAINT "CustomFieldDefinition_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Lead" ADD COLUMN "custom_fields" JSONB;
```

- [ ] **Step 6: Regenerate the Prisma client**

Run: `cd packages/database && npx prisma generate`
Expected: `Generated Prisma Client` success message.

- [ ] **Step 7: Commit**

```bash
git add packages/database/prisma/schema.prisma packages/database/prisma/migrations/20260712130000_add_lead_custom_fields
git commit -m "feat(db): add CustomFieldDefinition model and Lead.custom_fields"
```

---

### Task 2: Add MANAGE_CRM_SETTINGS permission

**Files:**
- Modify: `packages/shared-types/index.ts` (enum ~line 62; `ROLE_DEFAULT_PERMISSIONS` OWNER auto-included; MANAGER list ~line 100; labels ~line 178; `STORE_PERMISSION_GROUPS` CRM group ~line 245)

**Interfaces:**
- Produces: `StorePermission.MANAGE_CRM_SETTINGS = "MANAGE_CRM_SETTINGS"`, present in the CRM permission group, labelled, and granted to OWNER (automatic via `Object.values`) and MANAGER.

- [ ] **Step 1: Add the enum member**

In the `// CRM` block of the `StorePermission` object, after `CREATE_LEAD_CONVERSATIONS`:

```ts
  MANAGE_CRM_SETTINGS: "MANAGE_CRM_SETTINGS",
```

- [ ] **Step 2: Grant to MANAGER by default**

In `ROLE_DEFAULT_PERMISSIONS[UserRole.MANAGER]`, after `StorePermission.CREATE_LEAD_CONVERSATIONS`:

```ts
    StorePermission.MANAGE_CRM_SETTINGS,
```

(OWNER already receives it via `Object.values(StorePermission)`.)

- [ ] **Step 3: Add the label**

In the label map, after the `CREATE_LEAD_CONVERSATIONS` label line:

```ts
  [StorePermission.MANAGE_CRM_SETTINGS]: "Manage CRM custom fields & settings",
```

- [ ] **Step 4: Add to the CRM permission group**

In `STORE_PERMISSION_GROUPS`, the `label: "CRM"` group's `permissions` array, after `CREATE_LEAD_CONVERSATIONS`:

```ts
      StorePermission.MANAGE_CRM_SETTINGS,
```

- [ ] **Step 5: Build shared-types to verify types**

Run: `cd packages/shared-types && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add packages/shared-types/index.ts
git commit -m "feat(permissions): add MANAGE_CRM_SETTINGS store permission"
```

---

### Task 3: Backend custom-fields module (definitions CRUD + sanitizer)

**Files:**
- Create: `apps/backend/src/custom-fields/custom-fields.dto.ts`
- Create: `apps/backend/src/custom-fields/custom-fields.service.ts`
- Create: `apps/backend/src/custom-fields/custom-fields.service.spec.ts`
- Create: `apps/backend/src/custom-fields/custom-fields.controller.ts`
- Create: `apps/backend/src/custom-fields/custom-fields.module.ts`
- Modify: `apps/backend/src/app.module.ts` (import + register `CustomFieldsModule`)

**Interfaces:**
- Consumes: `DatabaseService` (`db.customFieldDefinition`), `CustomFieldEntity` from `@prisma/client`, `StorePermission` from `@erp71/shared-types`.
- Produces:
  - `class CustomFieldsService` with:
    - `listDefinitions(tenantId: string, entity: CustomFieldEntity): Promise<CustomFieldDefinitionDto[]>` — active defs ordered by `order`.
    - `saveDefinitions(tenantId: string, entity: CustomFieldEntity, dto: SaveCustomFieldsDto): Promise<CustomFieldDefinitionDto[]>` — reconciles slots, caps at 10.
    - `sanitizeValues(tenantId: string, entity: CustomFieldEntity, input: Record<string, unknown> | undefined): Promise<Record<string, string> | undefined>` — strips unknown/inactive keys, coerces values.
  - `const MAX_CUSTOM_FIELDS = 10`, `const CUSTOM_FIELD_SLOTS = ['cf_1', … , 'cf_10']`.
  - DTO shapes: `SaveCustomFieldsDto { fields: CustomFieldInput[] }`, `CustomFieldInput { key?: string; label: string; order?: number }`, `CustomFieldDefinitionDto { key: string; label: string; order: number }`.

- [ ] **Step 1: Write the DTOs**

Create `apps/backend/src/custom-fields/custom-fields.dto.ts`:

```ts
import { Type } from 'class-transformer';
import {
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';

export class CustomFieldInput {
  @IsOptional()
  @IsString()
  key?: string;

  @IsString()
  @MinLength(1)
  @MaxLength(40)
  label: string;

  @IsOptional()
  @IsInt()
  order?: number;
}

export class SaveCustomFieldsDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CustomFieldInput)
  fields: CustomFieldInput[];
}

export interface CustomFieldDefinitionDto {
  key: string;
  label: string;
  order: number;
}
```

- [ ] **Step 2: Write failing service tests**

Create `apps/backend/src/custom-fields/custom-fields.service.spec.ts`:

```ts
import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { CustomFieldEntity } from '@prisma/client';
import { CustomFieldsService } from './custom-fields.service';
import { DatabaseService } from '../database/database.service';

describe('CustomFieldsService', () => {
  let service: CustomFieldsService;
  let db: any;
  const tenantId = 'tenant-1';

  beforeEach(async () => {
    jest.clearAllMocks();
    db = {
      customFieldDefinition: {
        findMany: jest.fn().mockResolvedValue([]),
        upsert: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({}),
      },
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CustomFieldsService,
        { provide: DatabaseService, useValue: db },
      ],
    }).compile();
    service = module.get(CustomFieldsService);
  });

  it('assigns cf_ slots to new fields and caps at 10', async () => {
    await expect(
      service.saveDefinitions(tenantId, CustomFieldEntity.LEAD, {
        fields: Array.from({ length: 11 }, (_, i) => ({ label: `F${i}` })),
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('reuses the first inactive slot for a new field', async () => {
    db.customFieldDefinition.findMany.mockResolvedValue([
      { key: 'cf_1', label: 'Old', order: 0, is_active: false },
    ]);
    const result = await service.saveDefinitions(tenantId, CustomFieldEntity.LEAD, {
      fields: [{ label: 'Region' }],
    });
    expect(result[0].key).toBe('cf_1');
    expect(result[0].label).toBe('Region');
  });

  it('sanitizeValues keeps only active keys and coerces to string', async () => {
    db.customFieldDefinition.findMany.mockResolvedValue([
      { key: 'cf_1', label: 'Region', order: 0, is_active: true },
    ]);
    const out = await service.sanitizeValues(tenantId, CustomFieldEntity.LEAD, {
      cf_1: 42,
      cf_9: 'ignored',
    });
    expect(out).toEqual({ cf_1: '42' });
  });

  it('rejects duplicate active labels', async () => {
    await expect(
      service.saveDefinitions(tenantId, CustomFieldEntity.LEAD, {
        fields: [{ label: 'Region' }, { label: 'region' }],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd apps/backend && npx jest src/custom-fields/custom-fields.service.spec.ts`
Expected: FAIL (`Cannot find module './custom-fields.service'`).

- [ ] **Step 4: Write the service**

Create `apps/backend/src/custom-fields/custom-fields.service.ts`:

```ts
import { BadRequestException, Injectable } from '@nestjs/common';
import { CustomFieldEntity } from '@prisma/client';
import { DatabaseService } from '../database/database.service';
import {
  CustomFieldDefinitionDto,
  SaveCustomFieldsDto,
} from './custom-fields.dto';

export const MAX_CUSTOM_FIELDS = 10;
export const CUSTOM_FIELD_SLOTS = Array.from(
  { length: MAX_CUSTOM_FIELDS },
  (_, i) => `cf_${i + 1}`,
);
const MAX_VALUE_LENGTH = 500;

@Injectable()
export class CustomFieldsService {
  constructor(private readonly db: DatabaseService) {}

  async listDefinitions(
    tenantId: string,
    entity: CustomFieldEntity,
  ): Promise<CustomFieldDefinitionDto[]> {
    const rows = await this.db.customFieldDefinition.findMany({
      where: { tenant_id: tenantId, entity, is_active: true },
      orderBy: { order: 'asc' },
    });
    return rows.map((r) => ({ key: r.key, label: r.label, order: r.order }));
  }

  async saveDefinitions(
    tenantId: string,
    entity: CustomFieldEntity,
    dto: SaveCustomFieldsDto,
  ): Promise<CustomFieldDefinitionDto[]> {
    const inputs = dto.fields.map((f) => ({
      key: f.key?.trim() || undefined,
      label: f.label.trim(),
      order: f.order,
    }));

    if (inputs.some((f) => !f.label)) {
      throw new BadRequestException('Custom field label is required.');
    }
    if (inputs.length > MAX_CUSTOM_FIELDS) {
      throw new BadRequestException(
        `A maximum of ${MAX_CUSTOM_FIELDS} custom fields is allowed.`,
      );
    }
    const seen = new Set<string>();
    for (const f of inputs) {
      const norm = f.label.toLowerCase();
      if (seen.has(norm)) {
        throw new BadRequestException(`Duplicate custom field label: ${f.label}`);
      }
      seen.add(norm);
    }

    const existing = await this.db.customFieldDefinition.findMany({
      where: { tenant_id: tenantId, entity },
    });
    const usedKeys = new Set(
      inputs.map((f) => f.key).filter((k): k is string => Boolean(k)),
    );
    const freeSlots = CUSTOM_FIELD_SLOTS.filter((s) => !usedKeys.has(s));

    // Assign a slot to each new (keyless) input.
    const resolved = inputs.map((f, idx) => {
      const key = f.key ?? freeSlots.shift();
      if (!key) {
        throw new BadRequestException(
          `A maximum of ${MAX_CUSTOM_FIELDS} custom fields is allowed.`,
        );
      }
      return { key, label: f.label, order: f.order ?? idx };
    });

    // Upsert active definitions; deactivate everything not in the new set.
    for (const r of resolved) {
      await this.db.customFieldDefinition.upsert({
        where: {
          tenant_id_entity_key: { tenant_id: tenantId, entity, key: r.key },
        },
        create: {
          tenant_id: tenantId,
          entity,
          key: r.key,
          label: r.label,
          order: r.order,
          is_active: true,
        },
        update: { label: r.label, order: r.order, is_active: true },
      });
    }
    const keepKeys = resolved.map((r) => r.key);
    const toDeactivate = existing
      .filter((e) => !keepKeys.includes(e.key) && e.is_active)
      .map((e) => e.key);
    if (toDeactivate.length) {
      await this.db.customFieldDefinition.updateMany({
        where: { tenant_id: tenantId, entity, key: { in: toDeactivate } },
        data: { is_active: false },
      });
    }

    return resolved
      .sort((a, b) => a.order - b.order)
      .map((r) => ({ key: r.key, label: r.label, order: r.order }));
  }

  async sanitizeValues(
    tenantId: string,
    entity: CustomFieldEntity,
    input: Record<string, unknown> | undefined,
  ): Promise<Record<string, string> | undefined> {
    if (!input || typeof input !== 'object') return undefined;
    const defs = await this.listDefinitions(tenantId, entity);
    const activeKeys = new Set(defs.map((d) => d.key));
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(input)) {
      if (!activeKeys.has(key)) continue;
      if (value === null || value === undefined) continue;
      out[key] = String(value).trim().slice(0, MAX_VALUE_LENGTH);
    }
    return Object.keys(out).length ? out : undefined;
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd apps/backend && npx jest src/custom-fields/custom-fields.service.spec.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Write the controller**

Create `apps/backend/src/custom-fields/custom-fields.controller.ts`:

```ts
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Put,
  Query,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { CustomFieldEntity } from '@prisma/client';
import { StorePermission } from '@erp71/shared-types';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { StorePermissionGuard } from '../auth/store-permission.guard';
import { RequireStorePermission } from '../auth/store-permission.decorator';
import { TenantInterceptor } from '../database/tenant.interceptor';
import { Tenant, TenantContext } from '../database/tenant.decorator';
import { CustomFieldsService } from './custom-fields.service';
import { SaveCustomFieldsDto } from './custom-fields.dto';

function parseEntity(entity?: string): CustomFieldEntity {
  if (entity === CustomFieldEntity.LEAD) return CustomFieldEntity.LEAD;
  throw new BadRequestException('Unsupported custom-field entity.');
}

@Controller('custom-fields')
@UseGuards(JwtAuthGuard, StorePermissionGuard)
@UseInterceptors(TenantInterceptor)
export class CustomFieldsController {
  constructor(private readonly service: CustomFieldsService) {}

  @Get()
  list(@Tenant() tenant: TenantContext, @Query('entity') entity?: string) {
    return this.service.listDefinitions(tenant.tenantId, parseEntity(entity));
  }

  @Put()
  @RequireStorePermission(StorePermission.MANAGE_CRM_SETTINGS)
  save(
    @Tenant() tenant: TenantContext,
    @Body() dto: SaveCustomFieldsDto,
    @Query('entity') entity?: string,
  ) {
    return this.service.saveDefinitions(tenant.tenantId, parseEntity(entity), dto);
  }
}
```

Note: `GET` has no `@RequireStorePermission`, so any authenticated tenant user can read definitions to render forms (matches how the guard passes through when no permission metadata is set).

- [ ] **Step 7: Write the module and register it**

Create `apps/backend/src/custom-fields/custom-fields.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { CustomFieldsService } from './custom-fields.service';
import { CustomFieldsController } from './custom-fields.controller';

@Module({
  imports: [DatabaseModule],
  controllers: [CustomFieldsController],
  providers: [CustomFieldsService],
  exports: [CustomFieldsService],
})
export class CustomFieldsModule {}
```

In `apps/backend/src/app.module.ts`, add the import near the other module imports:

```ts
import { CustomFieldsModule } from './custom-fields/custom-fields.module';
```

and add `CustomFieldsModule` to the `imports: [ … ]` array of `@Module`.

- [ ] **Step 8: Verify build**

Run: `cd apps/backend && npx tsc --noEmit -p tsconfig.json 2>&1 | grep -i custom-fields; echo done`
Expected: `done` with no custom-fields errors.

- [ ] **Step 9: Commit**

```bash
git add apps/backend/src/custom-fields apps/backend/src/app.module.ts
git commit -m "feat(custom-fields): backend module for tenant custom field definitions"
```

---

### Task 4: Wire custom_fields into lead create/update

**Files:**
- Modify: `apps/backend/src/crm-leads/crm-leads.dto.ts` (`CreateLeadDto`, `UpdateLeadDto`)
- Modify: `apps/backend/src/crm-leads/crm-leads.service.ts` (constructor, `create`, `update`, `create` data, `mapLeadData`)
- Modify: `apps/backend/src/crm-leads/crm-leads.module.ts` (import `CustomFieldsModule`)
- Modify/Create: `apps/backend/src/crm-leads/crm-leads.service.spec.ts` (add custom_fields test; create if absent)

**Interfaces:**
- Consumes: `CustomFieldsService.sanitizeValues` from Task 3; `CustomFieldEntity.LEAD`.
- Produces: leads persist a sanitized `custom_fields` object; unknown keys stripped.

- [ ] **Step 1: Add custom_fields to the DTOs**

In `crm-leads.dto.ts`, add to `CreateLeadDto` and `UpdateLeadDto` (both classes):

```ts
  @IsOptional()
  @IsObject()
  custom_fields?: Record<string, string>;
```

Ensure `IsObject` is imported from `class-validator` at the top of the file (add it to the existing import list).

- [ ] **Step 2: Inject CustomFieldsService and import its module**

In `crm-leads.module.ts`, add `CustomFieldsModule` to `imports`:

```ts
import { CustomFieldsModule } from '../custom-fields/custom-fields.module';
// ...
    imports: [CustomersModule, CustomFieldsModule],
```

In `crm-leads.service.ts` constructor, inject it:

```ts
  constructor(
    private readonly db: DatabaseService,
    private readonly customFields: CustomFieldsService,
  ) {}
```

Add the import at the top:

```ts
import { CustomFieldEntity } from '@prisma/client';
import { CustomFieldsService } from '../custom-fields/custom-fields.service';
```

(If the constructor currently only injects `db`, preserve any other existing injected dependencies.)

- [ ] **Step 3: Sanitize on create**

In `create()`, after computing `score` and before `return this.db.lead.create({`, add:

```ts
    const customFields = await this.customFields.sanitizeValues(
      tenantId,
      CustomFieldEntity.LEAD,
      dto.custom_fields,
    );
```

In the `data: { … }` object, add:

```ts
        custom_fields: customFields ?? undefined,
```

- [ ] **Step 4: Sanitize on update**

In `update()`, after loading `existing` and before building the update data (where `mapLeadData(dto)` is used), add:

```ts
    const customFields = await this.customFields.sanitizeValues(
      tenantId,
      CustomFieldEntity.LEAD,
      dto.custom_fields,
    );
```

Then include it in the update `data` (merge with the mapped data), e.g. after the `mapLeadData` spread:

```ts
        ...(customFields !== undefined ? { custom_fields: customFields } : {}),
```

Also ensure `mapLeadData` does **not** pass `custom_fields` raw: in `mapLeadData` (the `{ ...dto }` builder), delete the raw key so only the sanitized value is written:

```ts
    const { custom_fields: _ignored, ...rest } = dto as any;
    return rest;
```

(Adjust to the existing `mapLeadData` shape; the goal is that raw `dto.custom_fields` never reaches Prisma unsanitized.)

- [ ] **Step 5: Write a failing test for sanitized persistence**

In `crm-leads.service.spec.ts` (create following the `sales-reports.service.spec.ts` mock pattern if it does not exist), add a test that mocks `CustomFieldsService.sanitizeValues` to return `{ cf_1: 'Gold' }` and asserts `db.lead.create` is called with `data.custom_fields = { cf_1: 'Gold' }`. Provide `CustomFieldsService` as a mock in the testing module:

```ts
{ provide: CustomFieldsService, useValue: { sanitizeValues: jest.fn().mockResolvedValue({ cf_1: 'Gold' }) } }
```

- [ ] **Step 6: Run the tests**

Run: `cd apps/backend && npx jest src/crm-leads/crm-leads.service.spec.ts`
Expected: PASS (including the new custom_fields test).

- [ ] **Step 7: Verify build**

Run: `cd apps/backend && npx tsc --noEmit -p tsconfig.json 2>&1 | grep -i crm-lead; echo done`
Expected: `done` with no crm-lead errors.

- [ ] **Step 8: Commit**

```bash
git add apps/backend/src/crm-leads
git commit -m "feat(crm-leads): persist sanitized custom_fields on create/update"
```

---

### Task 5: Wire custom_fields into lead CSV import

**Files:**
- Modify: `apps/backend/src/crm-leads/crm-leads.service.ts` (`importRows`)

**Interfaces:**
- Consumes: `CustomFieldsService.listDefinitions`, `CustomFieldsService.sanitizeValues`.
- Produces: import maps each active definition's `label` as a column into its `key`; values sanitized onto `custom_fields`.

- [ ] **Step 1: Load definitions once and map columns in castRow**

At the start of `importRows`, before `return runImport(…)`:

```ts
    const defs = await this.customFields.listDefinitions(
      tenantId,
      CustomFieldEntity.LEAD,
    );
```

In the `castRow` return object, add a `custom_fields` property built from the incoming row by matching each definition's label (case-insensitive) to a raw column:

```ts
                custom_fields: defs.reduce<Record<string, string>>((acc, def) => {
                    const raw2 = raw[def.label] ?? raw[def.label.toLowerCase()];
                    if (raw2 !== undefined && raw2 !== null && String(raw2).trim() !== '') {
                        acc[def.key] = String(raw2).trim().slice(0, 500);
                    }
                    return acc;
                }, {}),
```

- [ ] **Step 2: Persist custom_fields in the import create and update callbacks**

In the import `create` callback's `data`, add:

```ts
                        custom_fields: Object.keys(row.custom_fields ?? {}).length
                            ? row.custom_fields
                            : undefined,
```

In the import `update` callback's `data`, add:

```ts
                        ...(Object.keys(row.custom_fields ?? {}).length
                            ? { custom_fields: row.custom_fields }
                            : {}),
```

(The values already come only from known definition keys, so no further sanitize call is needed. `row` type is inferred from `castRow`, which now includes `custom_fields: Record<string, string>`.)

- [ ] **Step 3: Verify build**

Run: `cd apps/backend && npx tsc --noEmit -p tsconfig.json 2>&1 | grep -i crm-lead; echo done`
Expected: `done` with no errors.

- [ ] **Step 4: Commit**

```bash
git add apps/backend/src/crm-leads/crm-leads.service.ts
git commit -m "feat(crm-leads): map custom fields in CSV import"
```

---

### Task 6: Frontend API client — custom fields methods

**Files:**
- Modify: `apps/frontend/src/lib/api.ts` (add methods near the CRM Leads section ~line 486)

**Interfaces:**
- Produces:
  - `api.getCustomFields(entity: string): Promise<CustomFieldDef[]>`
  - `api.saveCustomFields(entity: string, fields: { key?: string; label: string; order?: number }[]): Promise<CustomFieldDef[]>`
  - exported type `CustomFieldDef = { key: string; label: string; order: number }`.

- [ ] **Step 1: Add the type and methods**

In `apps/frontend/src/lib/api.ts`, in the exported `api` object near the CRM Leads block, add:

```ts
    // Custom Fields
    getCustomFields: (entity: string) =>
        fetchWithAuth(`/custom-fields?entity=${encodeURIComponent(entity)}`),
    saveCustomFields: (entity: string, fields: { key?: string; label: string; order?: number }[]) =>
        fetchWithAuth(`/custom-fields?entity=${encodeURIComponent(entity)}`, {
            method: 'PUT',
            body: JSON.stringify({ fields }),
        }),
```

If the file exports shared types elsewhere, add near them:

```ts
export type CustomFieldDef = { key: string; label: string; order: number };
```

- [ ] **Step 2: Verify frontend typecheck**

Run: `cd apps/frontend && npx tsc --noEmit 2>&1 | grep -i api.ts; echo done`
Expected: `done` with no api.ts errors.

- [ ] **Step 3: Commit**

```bash
git add apps/frontend/src/lib/api.ts
git commit -m "feat(frontend): custom fields API client methods"
```

---

### Task 7: CRM Settings — Custom Fields config page

**Files:**
- Create: `apps/frontend/src/app/(app)/crm/settings/custom-fields/page.tsx`
- Modify: sidebar/nav config to add the entry (locate via `grep -rn "routes.crm.leads" apps/frontend/src/lib` and the sidebar component that lists CRM links)
- Modify: `apps/frontend/src/lib/routes.ts` (add `crm.customFields` route)

**Interfaces:**
- Consumes: `api.getCustomFields('LEAD')`, `api.saveCustomFields('LEAD', …)`, `hasPermission` from `@/lib/permissions`, `MANAGE_CRM_SETTINGS`.
- Produces: a page where owner/admins edit up to 10 labels.

- [ ] **Step 1: Add the route**

In `apps/frontend/src/lib/routes.ts`, under the `crm` group, add:

```ts
    customFields: '/crm/settings/custom-fields',
```

- [ ] **Step 2: Build the config page**

Create `apps/frontend/src/app/(app)/crm/settings/custom-fields/page.tsx`:

```tsx
'use client';

import { useState, useEffect } from 'react';
import { api } from '@/lib/api';
import { Plus, Trash2, Save } from 'lucide-react';

const MAX_FIELDS = 10;
type Field = { key?: string; label: string };

export default function CustomFieldsSettingsPage() {
    const [fields, setFields] = useState<Field[]>([]);
    const [saving, setSaving] = useState(false);
    const [loaded, setLoaded] = useState(false);

    useEffect(() => {
        api.getCustomFields('LEAD')
            .then((data: any[]) => setFields(Array.isArray(data) ? data.map((d) => ({ key: d.key, label: d.label })) : []))
            .catch(() => setFields([]))
            .finally(() => setLoaded(true));
    }, []);

    const addField = () => {
        if (fields.length >= MAX_FIELDS) return;
        setFields([...fields, { label: '' }]);
    };
    const removeField = (idx: number) => setFields(fields.filter((_, i) => i !== idx));
    const setLabel = (idx: number, label: string) =>
        setFields(fields.map((f, i) => (i === idx ? { ...f, label } : f)));

    const save = async () => {
        const cleaned = fields.map((f) => ({ key: f.key, label: f.label.trim() })).filter((f) => f.label);
        setSaving(true);
        try {
            const result = await api.saveCustomFields('LEAD', cleaned);
            setFields(Array.isArray(result) ? result.map((d: any) => ({ key: d.key, label: d.label })) : []);
            alert('Custom fields saved.');
        } catch (err: unknown) {
            alert(err instanceof Error ? err.message : 'Failed to save custom fields.');
        } finally {
            setSaving(false);
        }
    };

    if (!loaded) return <div className="p-4 text-sm text-gray-500">Loading…</div>;

    return (
        <div className="overflow-y-auto h-full bg-[#f3f4f6] p-3 md:p-4 font-sans text-gray-900 text-[13px] space-y-4">
            <h1 className="text-lg font-semibold">Lead Custom Fields</h1>
            <p className="text-xs text-gray-500">Define up to {MAX_FIELDS} extra fields for your leads. Text only.</p>
            <div className="space-y-2 max-w-lg">
                {fields.map((f, idx) => (
                    <div key={f.key ?? `new-${idx}`} className="flex items-center gap-2">
                        <input
                            value={f.label}
                            onChange={(e) => setLabel(idx, e.target.value)}
                            maxLength={40}
                            placeholder={`Field ${idx + 1} name`}
                            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
                        />
                        <button onClick={() => removeField(idx)} className="p-2 text-gray-400 hover:text-rose-600">
                            <Trash2 className="w-4 h-4" />
                        </button>
                    </div>
                ))}
                {fields.length < MAX_FIELDS && (
                    <button onClick={addField} className="inline-flex items-center gap-1 text-sm text-violet-600">
                        <Plus className="w-4 h-4" /> Add field
                    </button>
                )}
            </div>
            <button
                onClick={save}
                disabled={saving}
                className="inline-flex items-center gap-2 bg-violet-600 text-white rounded-lg px-4 py-2 text-sm disabled:opacity-50"
            >
                <Save className="w-4 h-4" /> {saving ? 'Saving…' : 'Save'}
            </button>
        </div>
    );
}
```

- [ ] **Step 3: Add a nav entry gated by permission**

Locate the CRM sidebar/menu definition (run `grep -rln "routes.crm.leads" apps/frontend/src`). Add a "Custom Fields" link to the CRM section pointing to `routes.crm.customFields`, gated with `hasPermission(permissions, 'MANAGE_CRM_SETTINGS')` following the existing pattern for permission-gated links in that file. If the sidebar already filters by permission via a `permission` property on link objects, set `permission: 'MANAGE_CRM_SETTINGS'`.

- [ ] **Step 4: Manual verification**

Run the app (`/run` or the project's dev command). As an OWNER, navigate to CRM → Custom Fields, add two fields ("Region", "Segment"), save, reload — confirm they persist. Confirm the nav link is hidden for a role lacking `MANAGE_CRM_SETTINGS`.

- [ ] **Step 5: Commit**

```bash
git add apps/frontend/src/app/\(app\)/crm/settings apps/frontend/src/lib/routes.ts apps/frontend/src/<sidebar-file>
git commit -m "feat(frontend): CRM custom fields settings page"
```

---

### Task 8: Lead create/edit form — render custom field inputs

**Files:**
- Modify: `apps/frontend/src/app/(app)/crm/leads/lead-form-fields.tsx` (`LeadFormState`, `emptyLeadForm`, `leadFormToPayload`, `LeadFormFields` component; add a `leadFromForm`/hydrate helper if present)
- Modify: `apps/frontend/src/app/(app)/crm/leads/new/page.tsx` and `apps/frontend/src/app/(app)/crm/leads/[id]/page.tsx` (fetch definitions, pass to `LeadFormFields`)

**Interfaces:**
- Consumes: `api.getCustomFields('LEAD')`, `CustomFieldDef`.
- Produces: `LeadFormState.custom_fields: Record<string,string>`; form renders one input per definition; payload includes non-empty custom fields.

- [ ] **Step 1: Extend the form state**

In `lead-form-fields.tsx`, add to `LeadFormState`:

```ts
    custom_fields: Record<string, string>;
```

In `emptyLeadForm()` return object add:

```ts
    custom_fields: {},
```

If a `leadToForm`/hydration function exists that maps an existing lead into `LeadFormState` (used by the edit page), add:

```ts
        custom_fields: (lead.custom_fields as Record<string, string>) ?? {},
```

- [ ] **Step 2: Include custom fields in the payload**

In `leadFormToPayload`, before `return payload;`, add:

```ts
    const customFields = Object.entries(form.custom_fields ?? {}).reduce<Record<string, string>>((acc, [k, v]) => {
        const val = String(v ?? '').trim();
        if (val) acc[k] = val;
        return acc;
    }, {});
    if (Object.keys(customFields).length) {
        (payload as Record<string, unknown>).custom_fields = customFields;
    }
```

- [ ] **Step 3: Render inputs in LeadFormFields**

Add a `customFieldDefs` prop to `LeadFormFieldsProps`:

```ts
    customFieldDefs?: { key: string; label: string }[];
```

In the `LeadFormFields` component signature destructure it (`customFieldDefs = []`), and render before the closing `</div>` of the grid:

```tsx
            {customFieldDefs.map((def) => (
                <div key={def.key}>
                    <label className={labelClass}>{def.label}</label>
                    <input
                        value={form.custom_fields?.[def.key] ?? ''}
                        onChange={(e) => onChange({ ...form, custom_fields: { ...form.custom_fields, [def.key]: e.target.value } })}
                        className={inputClass}
                        maxLength={500}
                    />
                </div>
            ))}
```

- [ ] **Step 4: Fetch and pass definitions from the pages**

In `new/page.tsx` and `[id]/page.tsx`, add state and effect:

```tsx
    const [customFieldDefs, setCustomFieldDefs] = useState<{ key: string; label: string }[]>([]);
    useEffect(() => {
        api.getCustomFields('LEAD')
            .then((d: any[]) => setCustomFieldDefs(Array.isArray(d) ? d : []))
            .catch(() => setCustomFieldDefs([]));
    }, []);
```

Pass to the component: `<LeadFormFields … customFieldDefs={customFieldDefs} />`.

- [ ] **Step 5: Verify typecheck**

Run: `cd apps/frontend && npx tsc --noEmit 2>&1 | grep -iE 'lead-form|crm/leads'; echo done`
Expected: `done` with no errors.

- [ ] **Step 6: Manual verification**

Create a lead with values in the custom fields; save; open the lead in edit mode and confirm the values load. Confirm the custom inputs disappear when no definitions exist.

- [ ] **Step 7: Commit**

```bash
git add apps/frontend/src/app/\(app\)/crm/leads/lead-form-fields.tsx apps/frontend/src/app/\(app\)/crm/leads/new/page.tsx "apps/frontend/src/app/(app)/crm/leads/[id]/page.tsx"
git commit -m "feat(frontend): render lead custom fields in create/edit form"
```

---

### Task 9: Lead detail view — show custom field values

**Files:**
- Modify: `apps/frontend/src/app/(app)/crm/leads/[id]/page.tsx` (detail render section)

**Interfaces:**
- Consumes: `customFieldDefs` (already fetched in Task 8), the loaded lead's `custom_fields`.
- Produces: a labelled read view of custom values.

- [ ] **Step 1: Render the values**

In the lead detail display section (where other lead attributes like email/category are shown), add a block that maps active definitions to their stored value:

```tsx
{customFieldDefs
    .filter((def) => (lead?.custom_fields as Record<string, string> | undefined)?.[def.key])
    .map((def) => (
        <div key={def.key} className="flex justify-between text-sm">
            <span className="text-gray-500">{def.label}</span>
            <span className="text-gray-900">{(lead.custom_fields as Record<string, string>)[def.key]}</span>
        </div>
    ))}
```

Adjust the markup to match the surrounding detail layout (grid vs list). Only show fields that have a value.

- [ ] **Step 2: Verify typecheck**

Run: `cd apps/frontend && npx tsc --noEmit 2>&1 | grep -i 'crm/leads'; echo done`
Expected: `done`.

- [ ] **Step 3: Manual verification**

Open a lead that has custom field values and confirm they render under the correct labels; open a lead with no custom values and confirm the block is empty (not broken).

- [ ] **Step 4: Commit**

```bash
git add "apps/frontend/src/app/(app)/crm/leads/[id]/page.tsx"
git commit -m "feat(frontend): show custom fields on lead detail"
```

---

### Task 10: Leads list — optional custom field columns

**Files:**
- Modify: `apps/frontend/src/app/(app)/crm/leads/page.tsx` (`Lead` interface, `columns`, fetch defs)

**Interfaces:**
- Consumes: `api.getCustomFields('LEAD')`; the leads list already returns `custom_fields` (the API returns the full lead row — confirm `findAll` selects it; if it uses an explicit `select`, add `custom_fields: true`).
- Produces: one appended, toggleable column per active definition.

- [ ] **Step 1: Ensure the list query returns custom_fields**

Check `crm-leads.service.ts` `findAll`: if it uses an explicit `select`, add `custom_fields: true`; if it returns full rows (no `select`), no change needed. If a `select` exists and is modified, this belongs in a backend commit.

- [ ] **Step 2: Extend the Lead interface and fetch defs**

In `page.tsx`, add to the `Lead` interface:

```ts
    custom_fields: Record<string, string> | null;
```

Add state + effect (mirroring Task 8):

```tsx
    const [customFieldDefs, setCustomFieldDefs] = useState<{ key: string; label: string }[]>([]);
    useEffect(() => {
        api.getCustomFields('LEAD').then((d: any[]) => setCustomFieldDefs(Array.isArray(d) ? d : [])).catch(() => setCustomFieldDefs([]));
    }, []);
```

- [ ] **Step 3: Append custom columns**

In the `columns` `useMemo`, after the existing columns array (and include `customFieldDefs` in the dependency list), append:

```tsx
        ...customFieldDefs.map((def) =>
            columnHelper.accessor((row) => row.custom_fields?.[def.key] ?? '', {
                id: `cf_${def.key}`,
                header: def.label,
                cell: (info) => <span className="text-gray-700">{info.getValue() as string}</span>,
            }),
        ),
```

If the `DataTable` component supports column visibility toggling, these appear in that menu automatically; otherwise they render as normal columns. Keep them last so the core columns stay stable.

- [ ] **Step 4: Verify typecheck**

Run: `cd apps/frontend && npx tsc --noEmit 2>&1 | grep -i 'crm/leads/page'; echo done`
Expected: `done`.

- [ ] **Step 5: Manual verification**

With two custom fields defined and a lead carrying values, confirm the columns appear in the leads table with the correct headers and values.

- [ ] **Step 6: Commit**

```bash
git add "apps/frontend/src/app/(app)/crm/leads/page.tsx" apps/backend/src/crm-leads/crm-leads.service.ts
git commit -m "feat(frontend): custom field columns in leads list"
```

---

### Task 11: CSV import — dynamic custom field columns

**Files:**
- Modify: `apps/frontend/src/app/(app)/crm/leads/page.tsx` (`LEAD_IMPORT_FIELDS` → derived from defs; `ImportDialog` wiring)

**Interfaces:**
- Consumes: `customFieldDefs` (fetched in Task 10), `ImportField` type.
- Produces: import field list includes one optional column per active definition (label = header, `key` = target). The backend (Task 5) maps them onto `custom_fields`.

- [ ] **Step 1: Derive the import fields from definitions**

In `page.tsx`, replace the module-level `LEAD_IMPORT_FIELDS` usage at the `ImportDialog` call site with a memoized list that appends custom fields:

```tsx
    const importFields: ImportField[] = useMemo(
        () => [
            ...LEAD_IMPORT_FIELDS,
            ...customFieldDefs.map((def) => ({ key: def.key, label: def.label, required: false })),
        ],
        [customFieldDefs],
    );
```

Pass `fields={importFields}` to `<ImportDialog … />` instead of the static `LEAD_IMPORT_FIELDS`.

Note: the backend import (Task 5) matches columns by **label**, and the frontend `ImportDialog` sends rows keyed by the mapped field `key`. Confirm which the backend receives — if `ImportDialog` emits rows keyed by `field.key` (i.e. `cf_1`), update Task 5 Step 1 to match rows by `def.key` instead of `def.label`. Verify by logging one import payload during manual testing and align the two sides.

- [ ] **Step 2: Verify typecheck**

Run: `cd apps/frontend && npx tsc --noEmit 2>&1 | grep -i 'crm/leads/page'; echo done`
Expected: `done`.

- [ ] **Step 3: Manual verification (end-to-end)**

Define custom field "Region". Prepare a CSV with headers `Name,Mobile,Region` and one row. Import via the leads Import dialog, map the columns, confirm the created lead shows the Region value in the form/detail/column. This verifies the frontend `key`/`label` contract against the backend mapping from Task 5 — fix whichever side mismatches.

- [ ] **Step 4: Commit**

```bash
git add "apps/frontend/src/app/(app)/crm/leads/page.tsx"
git commit -m "feat(frontend): include custom fields in leads CSV import"
```

---

## Self-Review Notes

- **Spec coverage:** engine + `LEAD` wiring (Tasks 1,3,4,5), storage JSONB (Task 1), config page + permission (Tasks 2,7), form (Task 8), detail (Task 9), list columns (Task 10), CSV import/export mapping (Tasks 5,11), 10-slot non-destructive model + cap + validation (Task 3), sanitizer on all write paths (Tasks 3,4,5). Export beyond import columns: leads export reuses the same column set (Task 10 columns) — no separate export code path exists to change; if a dedicated CSV export exists, it inherits the appended columns.
- **Open contract to verify at runtime:** the `ImportDialog` key-vs-label contract (Task 11 Step 1/Step 3, Task 5 Step 1). The plan flags it explicitly and resolves it during the end-to-end import test rather than guessing.
- **Deferred (YAGNI):** non-text field types, entities beyond `LEAD`, per-field required/search — out of scope per spec.
