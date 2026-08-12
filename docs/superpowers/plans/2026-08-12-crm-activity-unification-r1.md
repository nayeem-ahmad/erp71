# CRM Activity Unification — R1 (expand + backfill) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the `CrmActivity` table, its purpose taxonomy, the backend module that owns it, and a re-runnable backfill — so the new model becomes the write path while every legacy table and endpoint keeps working untouched.

**Architecture:** One new Prisma model `CrmActivity`, polymorphic over lead and customer (nullable `lead_id` / `customer_id`, exactly one set), where `status` — `PLANNED` / `DONE` / `CANCELLED` — separates the planned from the logged rather than a second table. A second new model `CrmActivityPurpose` joins the existing generic `LeadTaxonomyKind` machinery so it inherits the taxonomy service, controller and settings UI for free. `Lead.next_step*` and two new `Customer.next_activity*` columns become read-only rollups of the earliest `PLANNED` activity, written only by `CrmActivitiesService.recalculateRollup()`. Everything is additive: no legacy table, column or endpoint is dropped or modified in R1.

**Tech Stack:** NestJS 11, Prisma, PostgreSQL, Jest (`apps/backend`), `@nestjs/schedule` for crons.

**Spec:** `docs/superpowers/specs/2026-08-12-crm-activity-unification-design.md`

## Global Constraints

Every task's requirements implicitly include this section.

- **Additive only.** R1 must not drop or alter any existing column, table or endpoint. `prisma migrate diff` between `main` and the branch must emit zero `DROP` and zero `ALTER COLUMN`. Production reconciles schema with `prisma db push --accept-data-loss` on container start (`apps/backend/Dockerfile:105`) and never runs the migrations directory, so a non-additive change silently destroys data on the next restart.
- **Multi-tenancy.** Every query filters on `tenant_id`. Cross-tenant ids return 404, never 403.
- **Exactly one parent.** Every write path asserts exactly one of `lead_id` / `customer_id` is set — both set and neither set are `BadRequestException`.
- **Rollup columns are write-protected.** `Lead.next_step`, `Lead.next_step_date`, `Lead.next_step_assigned_to`, `Customer.next_activity_id`, `Customer.next_activity_date` are written *only* by `CrmActivitiesService.recalculateRollup()`. No other service, and no DTO, may set them.
- **Test command:** `npm test --workspace=apps/backend -- <pattern>`. Full suite: `npm test --workspace=apps/backend`.
- **Baseline:** backend typecheck has 3 known pre-existing test-file errors; 4 `test/*.spec.ts` integration suites fail without a live Postgres. Both are expected — do not chase them.
- **Package mirror trap:** `packages/database/package.json` sets `main: ./index.js` / `types: ./index.ts`. Anything added to `prisma/lead-taxonomy.seed.ts` MUST also be added to `prisma/lead-taxonomy.seed.js`. A `.ts`-only edit compiles clean and is `undefined` at runtime.
- **Commit style:** conventional commits, scope `crm`. Work on `dev`; never commit to `main`.

---

## File Structure

**Create:**

| Path | Responsibility |
|---|---|
| `apps/backend/src/crm-activities/crm-activities.dto.ts` | Request DTOs + the sort allowlist keys |
| `apps/backend/src/crm-activities/crm-activities.service.ts` | All activity reads/writes, rollup recalculation, the two crons |
| `apps/backend/src/crm-activities/crm-activities.controller.ts` | Routes + permission decorators |
| `apps/backend/src/crm-activities/crm-activities.module.ts` | Wiring |
| `apps/backend/src/crm-activities/crm-activities.service.spec.ts` | Service unit tests |
| `packages/database/prisma/sync-crm-activities.ts` | Idempotent backfill, runs on every container start |

**Modify:**

| Path | Change |
|---|---|
| `packages/database/prisma/schema.prisma` | `CrmActivity`, `CrmActivityPurpose`, rollup columns, back-relations |
| `apps/backend/src/crm-lead-taxonomy/lead-taxonomy.dto.ts` | `PURPOSE = 'purposes'` |
| `apps/backend/src/crm-lead-taxonomy/crm-lead-taxonomy.service.ts` | `model()`, `CONSUMERS`, `LABELS` |
| `packages/database/prisma/lead-taxonomy.seed.ts` + `.js` | `DEFAULT_ACTIVITY_PURPOSES` |
| `packages/database/prisma/sync-lead-taxonomy.ts` | Seed purposes for existing tenants |
| `apps/backend/src/crm-leads/crm-leads.service.ts` | Cancel planned activities on convert/lost; stop accepting `next_step` on update |
| `apps/backend/src/crm-lead-conversations/crm-lead-conversations.dto.ts` | Drop the three `next_step*` fields |
| `apps/backend/src/crm-lead-conversations/crm-lead-conversations.service.ts` | Stop writing `next_step*` |
| `apps/backend/src/app.module.ts` | Register `CrmActivitiesModule` |
| `apps/backend/Dockerfile` | Add `sync:crm-activities` to the start chain |
| `packages/database/package.json` | `sync:crm-activities` script |

Task 7 moves the two crons out of `crm-follow-ups.service.ts`. That file and its module stay registered and serving reads through R1 — they are deleted in R3, not here.

---

## Task 1: Schema — `CrmActivity`, `CrmActivityPurpose`, rollup columns

**Files:**
- Modify: `packages/database/prisma/schema.prisma`

**Interfaces:**
- Consumes: nothing.
- Produces: Prisma delegates `db.crmActivity` and `db.crmActivityPurpose`. Columns `Lead.next_activity_id`, `Customer.next_activity_id`, `Customer.next_activity_date`. Every later task depends on these.

- [ ] **Step 1: Add the two models to `schema.prisma`**

Append after the `CrmFollowUp` model (around line 2293):

```prisma
model CrmActivityPurpose {
  id         String   @id @default(uuid())
  tenant_id  String
  code       String
  name       String
  icon       String?
  sort_order Int      @default(0)
  is_system  Boolean  @default(false)
  is_active  Boolean  @default(true)
  created_at DateTime @default(now())
  updated_at DateTime @updatedAt

  tenant     Tenant        @relation(fields: [tenant_id], references: [id], onDelete: Cascade)
  activities CrmActivity[]

  @@unique([tenant_id, code])
  @@unique([tenant_id, name])
  @@index([tenant_id, is_active, sort_order])
}

/// One row per planned OR logged CRM touch. `status` separates the two — a
/// PLANNED row is a task, a DONE row is history. Replaces LeadConversation,
/// CustomerInteraction and CrmFollowUp, which survive read-only through R2 and
/// are dropped in R3. See docs/superpowers/specs/2026-08-12-crm-activity-unification-design.md
model CrmActivity {
  id           String    @id @default(uuid())
  tenant_id    String
  store_id     String?

  /// Exactly one of lead_id / customer_id is set — enforced in the service, the
  /// same rule CrmFollowUp.validateFollowUpTarget already applies.
  lead_id      String?
  customer_id  String?

  purpose_id   String?
  /// Nullable while PLANNED: a rep scheduling "chase the invoice" often does not
  /// yet know whether it will be a call or a WhatsApp. Required on completion.
  channel_id   String?
  /// The channel's `code`, denormalised — exactly as LeadConversation.type is.
  /// Every filter and groupBy reads it and the composite index serves those.
  channel_code String?

  /// The planned title. Null on an activity logged directly with no prior plan,
  /// which genuinely has no separate title — the UI renders `subject ?? summary`.
  subject      String?
  status       String    @default("PLANNED")
  due_at       DateTime?
  completed_at DateTime?

  /// What happened. Null while PLANNED, required on completion.
  summary      String?
  outcome      String?
  /// Written before the activity; `summary` is written after.
  notes        String?
  direction    String    @default("OUTBOUND")

  assigned_to  String?
  created_by   String?
  origin       String    @default("MANUAL")

  /// Backfill provenance. Both are null on user-created rows, and Postgres
  /// treats NULLs as distinct, so the unique index below constrains only
  /// backfilled rows — which is what makes sync-crm-activities re-runnable.
  /// Dropped in R3.
  legacy_source String?
  legacy_id     String?

  created_at   DateTime  @default(now())
  updated_at   DateTime  @updatedAt

  tenant   Tenant               @relation(fields: [tenant_id], references: [id], onDelete: Cascade)
  lead     Lead?                @relation(fields: [lead_id], references: [id], onDelete: Cascade)
  customer Customer?            @relation(fields: [customer_id], references: [id], onDelete: Cascade)
  purpose  CrmActivityPurpose?  @relation(fields: [purpose_id], references: [id], onDelete: Restrict)
  channel  ConversationChannel? @relation(fields: [channel_id], references: [id], onDelete: Restrict)
  assignee User?                @relation("CrmActivityAssignee", fields: [assigned_to], references: [id])
  creator  User?                @relation("CrmActivityCreator", fields: [created_by], references: [id])

  @@unique([tenant_id, legacy_source, legacy_id])
  @@index([tenant_id, status, due_at])
  @@index([tenant_id, assigned_to, status, due_at])
  @@index([tenant_id, lead_id, status, due_at])
  @@index([tenant_id, customer_id, status, due_at])
  @@index([tenant_id, status, completed_at])
  @@index([tenant_id, channel_id])
  @@index([tenant_id, purpose_id])
}
```

- [ ] **Step 2: Add the rollup columns and back-relations**

In `model Lead`, after `next_step_assigned_to` (line 2000), add:

```prisma
  /// Read-only rollup of the earliest PLANNED CrmActivity. Written ONLY by
  /// CrmActivitiesService.recalculateRollup(). next_step / next_step_date /
  /// next_step_assigned_to above are the same rollup and are equally read-only
  /// from R1 onward — they keep their names so the leads list, sort allowlist,
  /// myActionsToday filter, CSV importer, lead scoring and ai/chat-data.service
  /// need no changes.
  next_activity_id      String?
```

In `model Customer`, after `last_contacted_at` (line 1838), add:

```prisma
  /// Read-only rollup, as Lead.next_activity_id. `last_contacted_at` above is
  /// the customer-side last-touched column and is reused rather than paired
  /// with a new one.
  next_activity_id     String?
  next_activity_date   DateTime?
```

Add back-relations — `Lead`: `crmActivities CrmActivity[]`; `Customer`: `crmActivities CrmActivity[]`; `Tenant`: `crmActivities CrmActivity[]` and `crmActivityPurposes CrmActivityPurpose[]`; `ConversationChannel`: `activities CrmActivity[]`; `User`: `crmActivitiesAssigned CrmActivity[] @relation("CrmActivityAssignee")` and `crmActivitiesCreated CrmActivity[] @relation("CrmActivityCreator")`.

`next_activity_id` is deliberately a plain column, not a relation — a FK back to `CrmActivity` while `CrmActivity` has a FK to `Lead` creates a cycle Prisma requires extra annotation to resolve, and the rollup only ever needs the id.

- [ ] **Step 3: Validate and generate**

```bash
cd packages/database && npx prisma validate && npx prisma generate
```

Expected: `The schema at prisma/schema.prisma is valid` then a successful client generation.

- [ ] **Step 4: Prove the change is additive — this is the gate for the whole release**

```bash
cd packages/database
git stash push -- prisma/schema.prisma
npx prisma migrate diff --from-schema-datamodel prisma/schema.prisma \
  --to-schema-datamodel /dev/stdin --script < /dev/null > /tmp/before.sql 2>/dev/null || true
git stash pop
npx prisma migrate diff \
  --from-schema-datasource prisma/schema.prisma \
  --to-schema-datamodel prisma/schema.prisma --script > /tmp/additive-check.sql
grep -iE '^\s*(DROP|ALTER TABLE .* ALTER COLUMN)' /tmp/additive-check.sql
```

Expected: `grep` exits 1 with **no output**. Any `DROP` or `ALTER COLUMN` line means the change is not additive — stop and fix before continuing, because `db push` will execute it against production on the next container restart.

If no database is reachable for `--from-schema-datasource`, diff against the `main` schema instead:

```bash
git show main:packages/database/prisma/schema.prisma > /tmp/main-schema.prisma
npx prisma migrate diff --from-schema-datamodel /tmp/main-schema.prisma \
  --to-schema-datamodel prisma/schema.prisma --script > /tmp/additive-check.sql
grep -icE '^\s*CREATE TABLE' /tmp/additive-check.sql   # expect 2
grep -icE '^\s*ALTER TABLE .* ADD COLUMN' /tmp/additive-check.sql  # expect 3
grep -iE '^\s*(DROP|ALTER TABLE .* ALTER COLUMN)' /tmp/additive-check.sql  # expect no output
```

- [ ] **Step 5: Commit**

```bash
git add packages/database/prisma/schema.prisma
git commit -m "feat(crm): add CrmActivity and CrmActivityPurpose models

Additive only: two CREATE TABLE, three ADD COLUMN, no DROP and no ALTER COLUMN,
verified with prisma migrate diff against main. Production applies this via
db push on container start, where a non-additive diff would destroy data."
```

---

## Task 2: `PURPOSE` joins the taxonomy machinery

**Files:**
- Modify: `apps/backend/src/crm-lead-taxonomy/lead-taxonomy.dto.ts:20-24`
- Modify: `apps/backend/src/crm-lead-taxonomy/crm-lead-taxonomy.service.ts:33-54, 68-73`
- Modify: `packages/database/prisma/lead-taxonomy.seed.ts` **and** `packages/database/prisma/lead-taxonomy.seed.js`
- Modify: `packages/database/prisma/sync-lead-taxonomy.ts`
- Test: `apps/backend/src/crm-lead-taxonomy/lead-taxonomy-catalogue.spec.ts` (seed mirrors)
- Test: `apps/backend/src/crm-lead-taxonomy/crm-lead-taxonomy.service.spec.ts` (in-use delete guard; add `crmActivityPurpose` and `crmActivity` to its `db` mock)

**Interfaces:**
- Consumes: `db.crmActivityPurpose` from Task 1.
- Produces: `LeadTaxonomyKind.PURPOSE`. Task 3 resolves purposes via the existing `CrmLeadTaxonomyService.resolveByIdOrCode(tenantId, LeadTaxonomyKind.PURPOSE, value)`, which returns `TaxonomyOption | null`. Task 10 relies on the four seeded codes existing.

- [ ] **Step 1: Write the failing test**

Add to `apps/backend/src/crm-lead-taxonomy/lead-taxonomy-catalogue.spec.ts`:

```typescript
import { DEFAULT_ACTIVITY_PURPOSES } from '../../../../packages/database/prisma/lead-taxonomy.seed';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const seedJs = require('../../../../packages/database/prisma/lead-taxonomy.seed.js');

describe('activity purpose catalogue', () => {
    it('seeds the four codes CrmFollowUp.type carries today', () => {
        expect(DEFAULT_ACTIVITY_PURPOSES.map((p) => p.code).sort()).toEqual([
            'BIRTHDAY',
            'COLLECTION',
            'GENERAL',
            'REORDER_REMINDER',
        ]);
    });

    // The .ts is typechecked and the .js is what actually loads at runtime —
    // a .ts-only edit compiles clean and is undefined in production.
    it('keeps the .ts and .js mirrors in step', () => {
        expect(seedJs.DEFAULT_ACTIVITY_PURPOSES).toEqual(DEFAULT_ACTIVITY_PURPOSES);
    });
});
```

And in `apps/backend/src/crm-lead-taxonomy/crm-lead-taxonomy.service.spec.ts`, covering the `onDelete: Restrict` guard the spec calls for:

```typescript
    it('refuses to delete an activity purpose that is in use without a reassign target', async () => {
        // is_active false so assertNotLastActiveChannel short-circuits — this
        // test is about the in-use guard, not the last-active-row guard.
        db.crmActivityPurpose.findFirst.mockResolvedValue({
            id: 'p1', tenant_id: 't1', code: 'COLLECTION', name: 'Collection',
            is_system: false, is_active: false,
        });
        db.crmActivity.count.mockResolvedValue(4);

        // remove(tenantId, kind, id, reassignTo?) — a bare string, not an object.
        await expect(
            service.remove('t1', LeadTaxonomyKind.PURPOSE, 'p1'),
        ).rejects.toThrow(ConflictException);
    });
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npm test --workspace=apps/backend -- lead-taxonomy-catalogue`
Expected: FAIL — `DEFAULT_ACTIVITY_PURPOSES` is not exported from either file.

- [ ] **Step 3: Add the catalogue to both seed mirrors**

In `packages/database/prisma/lead-taxonomy.seed.ts`, after `DEFAULT_CONVERSATION_CHANNELS`:

```typescript
// Why an activity exists, as opposed to how it is delivered (that is
// ConversationChannel). The four codes mirror the members of CrmFollowUp.type,
// so backfilled follow-ups resolve to a purpose by `code`.
export const DEFAULT_ACTIVITY_PURPOSES = [
    { code: 'GENERAL', name: 'General', icon: '📌', sort_order: 1 },
    { code: 'COLLECTION', name: 'Collection', icon: '💰', sort_order: 2 },
    { code: 'BIRTHDAY', name: 'Birthday', icon: '🎂', sort_order: 3 },
    { code: 'REORDER_REMINDER', name: 'Reorder Reminder', icon: '🔁', sort_order: 4 },
];
```

Inside `seedDefaultLeadTaxonomy(tx, tenantId)`, add:

```typescript
    await tx.crmActivityPurpose.createMany({
        data: DEFAULT_ACTIVITY_PURPOSES.map((p) => ({
            tenant_id: tenantId,
            code: p.code,
            name: p.name,
            icon: p.icon,
            sort_order: p.sort_order,
            is_system: true,
        })),
        skipDuplicates: true,
    });
```

Make the byte-identical change in `lead-taxonomy.seed.js`, exporting through its `module.exports` block alongside `DEFAULT_CONVERSATION_CHANNELS`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test --workspace=apps/backend -- lead-taxonomy-catalogue`
Expected: PASS.

- [ ] **Step 5: Register the kind**

`lead-taxonomy.dto.ts`:

```typescript
export enum LeadTaxonomyKind {
    SOURCE = 'sources',
    CATEGORY = 'categories',
    CHANNEL = 'channels',
    PURPOSE = 'purposes',
}
```

`crm-lead-taxonomy.service.ts` — extend `Consumer.table` to `'lead' | 'leadConversation' | 'crmActivity'`, `Consumer.fk` to include `'purpose_id'`, then:

```typescript
const CONSUMERS: Record<LeadTaxonomyKind, Consumer> = {
    [LeadTaxonomyKind.SOURCE]: { table: 'lead', fk: 'source_id', noun: 'lead' },
    [LeadTaxonomyKind.CATEGORY]: { table: 'lead', fk: 'category_id', noun: 'lead' },
    // Repointed from leadConversation to crmActivity in R1. sync-crm-activities
    // runs ahead of the API in the container start chain and mirrors every
    // conversation into an activity, so crmActivity is a superset — counting it
    // alone is complete. Counting the old table instead would let a channel used
    // only by new activities be deleted, and onDelete: Restrict would surface
    // that as a raw Prisma error rather than the friendly reassign flow.
    [LeadTaxonomyKind.CHANNEL]: { table: 'crmActivity', fk: 'channel_id', noun: 'activity' },
    [LeadTaxonomyKind.PURPOSE]: { table: 'crmActivity', fk: 'purpose_id', noun: 'activity' },
};

const LABELS: Record<LeadTaxonomyKind, string> = {
    [LeadTaxonomyKind.SOURCE]: 'Lead source',
    [LeadTaxonomyKind.CATEGORY]: 'Lead category',
    [LeadTaxonomyKind.CHANNEL]: 'Conversation channel',
    [LeadTaxonomyKind.PURPOSE]: 'Activity purpose',
};
```

In `model(kind)` add: `if (kind === LeadTaxonomyKind.PURPOSE) return this.db.crmActivityPurpose as any;`

In `create()`, extend the icon spread so purposes get one too: `...(kind === LeadTaxonomyKind.CHANNEL || kind === LeadTaxonomyKind.PURPOSE ? { icon: dto.icon || null } : {})`.

- [ ] **Step 6: Seed purposes for existing tenants**

In `packages/database/prisma/sync-lead-taxonomy.ts`, the per-tenant loop already calls `seedDefaultLeadTaxonomy`. Confirm it does — if it inlines its own seeding instead, add the same `crmActivityPurpose.createMany` block there. Run the script's own smoke path:

```bash
npm run sync:lead-taxonomy --workspace=@erp71/database
```

Expected: completes without error. (Against the local drifted DB it may report unbackfilled rows — that is the pre-existing state, not a regression.)

- [ ] **Step 7: Run the taxonomy suite and commit**

Run: `npm test --workspace=apps/backend -- crm-lead-taxonomy lead-taxonomy`
Expected: PASS, including the pre-existing taxonomy service tests.

```bash
git add apps/backend/src/crm-lead-taxonomy packages/database/prisma/lead-taxonomy.seed.ts packages/database/prisma/lead-taxonomy.seed.js packages/database/prisma/sync-lead-taxonomy.ts
git commit -m "feat(crm): add activity purposes as a fourth lead-taxonomy kind

Repoints the CHANNEL consumer at crmActivity: the backfill mirrors every
conversation into an activity ahead of the API starting, so it is a superset,
and counting the old table would let an in-use channel be deleted."
```

---

## Task 3: `CrmActivityService` — create, findAll, findOne

**Files:**
- Create: `apps/backend/src/crm-activities/crm-activities.dto.ts`
- Create: `apps/backend/src/crm-activities/crm-activities.service.ts`
- Create: `apps/backend/src/crm-activities/crm-activities.module.ts`
- Create: `apps/backend/src/crm-activities/crm-activities.controller.ts`
- Create: `apps/backend/src/crm-activities/crm-activities.service.spec.ts`
- Modify: `apps/backend/src/app.module.ts`

**Interfaces:**
- Consumes: `db.crmActivity`, `LeadTaxonomyKind.PURPOSE`, `CrmLeadTaxonomyService.resolveByIdOrCode`.
- Produces:
  - `CrmActivitiesService.create(tenantId: string, userId: string, dto: CreateCrmActivityDto): Promise<CrmActivity>`
  - `CrmActivitiesService.findAll(tenantId: string, opts: ListActivityOpts): Promise<PaginatedResult<CrmActivity>>`
  - `CrmActivitiesService.findOne(tenantId: string, id: string): Promise<CrmActivity>`
  - `private resolveTarget(tenantId, leadId?, customerId?): Promise<{ lead_id?: string; customer_id?: string }>`
  - `ACTIVITY_INCLUDES` — the shared `include` object every read returns.

- [ ] **Step 1: Write the failing tests**

Create `apps/backend/src/crm-activities/crm-activities.service.spec.ts`:

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { CrmActivitiesService } from './crm-activities.service';
import { CrmLeadTaxonomyService } from '../crm-lead-taxonomy/crm-lead-taxonomy.service';
import { DatabaseService } from '../database/database.service';
import { AppLogger } from '../common/app-logger.service';
import { JobTrackerService } from '../system-health/jobs/job-tracker.service';
import { NotificationsService } from '../notifications/notifications.service';

describe('CrmActivitiesService', () => {
    let service: CrmActivitiesService;
    let db: any;
    let taxonomy: any;

    beforeEach(async () => {
        db = {
            lead: { findFirst: jest.fn(), update: jest.fn(), findMany: jest.fn() },
            customer: { findFirst: jest.fn(), update: jest.fn(), findMany: jest.fn() },
            crmActivity: {
                create: jest.fn(),
                findFirst: jest.fn(),
                findMany: jest.fn(),
                update: jest.fn(),
                updateMany: jest.fn(),
                delete: jest.fn(),
                count: jest.fn(),
            },
            $queryRaw: jest.fn(),
            $transaction: jest.fn(async (fn: any) => fn(db)),
        };
        taxonomy = { resolveByIdOrCode: jest.fn() };

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                CrmActivitiesService,
                { provide: DatabaseService, useValue: db },
                { provide: CrmLeadTaxonomyService, useValue: taxonomy },
                { provide: AppLogger, useValue: { debug: jest.fn(), error: jest.fn(), warn: jest.fn(), log: jest.fn() } },
                { provide: JobTrackerService, useValue: { track: (_n: string, fn: () => Promise<unknown>) => fn() } },
                { provide: NotificationsService, useValue: { create: jest.fn().mockResolvedValue(undefined) } },
            ],
        }).compile();

        service = module.get(CrmActivitiesService);
    });

    describe('create()', () => {
        it('rejects both lead_id and customer_id', async () => {
            await expect(
                service.create('t1', 'u1', { lead_id: 'l1', customer_id: 'c1', subject: 'x' } as any),
            ).rejects.toThrow(BadRequestException);
        });

        it('rejects neither lead_id nor customer_id', async () => {
            await expect(service.create('t1', 'u1', { subject: 'x' } as any)).rejects.toThrow(
                BadRequestException,
            );
        });

        it('404s an unknown lead', async () => {
            db.lead.findFirst.mockResolvedValue(null);
            await expect(
                service.create('t1', 'u1', { lead_id: 'nope', subject: 'x' } as any),
            ).rejects.toThrow(NotFoundException);
        });

        it('requires a subject when planning', async () => {
            db.lead.findFirst.mockResolvedValue({ id: 'l1', status: 'NEW' });
            await expect(
                service.create('t1', 'u1', { lead_id: 'l1', status: 'PLANNED' } as any),
            ).rejects.toThrow(BadRequestException);
        });

        it('requires summary and channel when logging directly', async () => {
            db.lead.findFirst.mockResolvedValue({ id: 'l1', status: 'NEW' });
            await expect(
                service.create('t1', 'u1', { lead_id: 'l1', status: 'DONE', subject: 'x' } as any),
            ).rejects.toThrow(BadRequestException);
        });

        it('creates a planned activity and recalculates the rollup', async () => {
            db.lead.findFirst.mockResolvedValue({ id: 'l1', status: 'NEW' });
            db.crmActivity.create.mockResolvedValue({ id: 'a1', lead_id: 'l1' });
            db.crmActivity.findFirst.mockResolvedValue({
                id: 'a1', subject: 'Call Karim', due_at: new Date('2026-08-20'), assigned_to: 'u2',
            });

            await service.create('t1', 'u1', {
                lead_id: 'l1', subject: 'Call Karim', due_at: '2026-08-20T10:00:00Z', assigned_to: 'u2',
            } as any);

            expect(db.crmActivity.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({
                        tenant_id: 't1', lead_id: 'l1', status: 'PLANNED', origin: 'MANUAL',
                    }),
                }),
            );
            expect(db.lead.update).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: { id: 'l1' },
                    data: expect.objectContaining({
                        next_step: 'Call Karim', next_activity_id: 'a1', next_step_assigned_to: 'u2',
                    }),
                }),
            );
        });
    });

    describe('findAll()', () => {
        it('scopes to the tenant and paginates', async () => {
            db.crmActivity.findMany.mockResolvedValue([]);
            db.crmActivity.count.mockResolvedValue(0);
            const res = await service.findAll('t1', { leadId: 'l1', page: 2, limit: 10 });
            expect(db.crmActivity.findMany).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: expect.objectContaining({ tenant_id: 't1', lead_id: 'l1' }),
                    skip: 10,
                    take: 10,
                }),
            );
            expect(res).toEqual({ items: [], total: 0, page: 2, limit: 10, pages: 0 });
        });

        it('overdue means PLANNED and past due', async () => {
            db.crmActivity.findMany.mockResolvedValue([]);
            db.crmActivity.count.mockResolvedValue(0);
            await service.findAll('t1', { overdue: true });
            const where = db.crmActivity.findMany.mock.calls[0][0].where;
            expect(where.status).toBe('PLANNED');
            expect(where.due_at.lt).toBeInstanceOf(Date);
        });
    });

    describe('findOne()', () => {
        it('404s a cross-tenant id', async () => {
            db.crmActivity.findFirst.mockResolvedValue(null);
            await expect(service.findOne('t1', 'other')).rejects.toThrow(NotFoundException);
        });
    });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test --workspace=apps/backend -- crm-activities`
Expected: FAIL — `Cannot find module './crm-activities.service'`.

- [ ] **Step 3: Write the DTOs**

Create `apps/backend/src/crm-activities/crm-activities.dto.ts`:

```typescript
import { Transform, Type } from 'class-transformer';
import {
    IsDateString, IsIn, IsOptional, IsString, IsUUID, Length, ValidateNested,
} from 'class-validator';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const emptyToUndefined = ({ value }: { value: unknown }) =>
    value === '' || value === null ? undefined : value;

export const ACTIVITY_STATUSES = ['PLANNED', 'DONE', 'CANCELLED'] as const;
export type ActivityStatus = (typeof ACTIVITY_STATUSES)[number];

export const ACTIVITY_ORIGINS = ['MANUAL', 'BIRTHDAY_CRON', 'REORDER_CRON', 'IMPORT'] as const;
export type ActivityOrigin = (typeof ACTIVITY_ORIGINS)[number];

export class CreateCrmActivityDto {
    @IsOptional() @IsUUID() lead_id?: string;
    @IsOptional() @IsUUID() customer_id?: string;

    /** Required when status is PLANNED. */
    @IsOptional() @Transform(trim) @IsString() @Length(1, 300) subject?: string;

    @IsOptional() @IsIn(['PLANNED', 'DONE']) status?: 'PLANNED' | 'DONE';

    @IsOptional() @Transform(emptyToUndefined) @IsDateString() due_at?: string;

    /** A CrmActivityPurpose id or code. */
    @IsOptional() @Transform(emptyToUndefined) @IsString() purpose?: string;
    /** A ConversationChannel id or code. Required when status is DONE. */
    @IsOptional() @Transform(emptyToUndefined) @IsString() channel?: string;

    /** Required when status is DONE. */
    @IsOptional() @Transform(trim) @IsString() summary?: string;
    @IsOptional() @Transform(trim) @IsString() outcome?: string;
    @IsOptional() @Transform(trim) @IsString() notes?: string;
    @IsOptional() @IsIn(['INBOUND', 'OUTBOUND']) direction?: string;

    @IsOptional() @Transform(emptyToUndefined) @IsUUID() assigned_to?: string;
    @IsOptional() @IsString() store_id?: string;
}

export class UpdateCrmActivityDto {
    @IsOptional() @Transform(trim) @IsString() @Length(1, 300) subject?: string;
    @IsOptional() @Transform(emptyToUndefined) @IsDateString() due_at?: string;
    @IsOptional() @Transform(emptyToUndefined) @IsString() purpose?: string;
    @IsOptional() @Transform(trim) @IsString() notes?: string;
    @IsOptional() @Transform(emptyToUndefined) @IsUUID() assigned_to?: string;
}

export class CreateNextActivityDto {
    @Transform(trim) @IsString() @Length(1, 300) subject: string;
    @IsDateString() due_at: string;
    @IsOptional() @Transform(emptyToUndefined) @IsString() purpose?: string;
    @IsOptional() @Transform(emptyToUndefined) @IsUUID() assigned_to?: string;
}

export class CompleteCrmActivityDto {
    /** A ConversationChannel id or code. Required. */
    @Transform(trim) @IsString() @Length(1, 60) channel: string;
    @Transform(trim) @IsString() @Length(1, 5000) summary: string;
    @IsOptional() @Transform(trim) @IsString() outcome?: string;
    @IsOptional() @IsIn(['INBOUND', 'OUTBOUND']) direction?: string;

    /**
     * Optional next activity — the closed loop. @ValidateNested + @Type are
     * load-bearing: without them class-validator treats the nested object as an
     * opaque blob and an empty `next: {}` would reach the service unvalidated.
     */
    @IsOptional()
    @ValidateNested()
    @Type(() => CreateNextActivityDto)
    next?: CreateNextActivityDto;
}

/** Mirrors ACTIVITY_SORTABLE in the service — keep the two in step. */
export const CRM_ACTIVITY_SORT_KEYS = ['due_at', 'completed_at', 'created_at', 'status', 'subject'];
```

- [ ] **Step 4: Write the service**

Create `apps/backend/src/crm-activities/crm-activities.service.ts`:

```typescript
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { AppLogger } from '../common/app-logger.service';
import { NotificationsService } from '../notifications/notifications.service';
import { CrmLeadTaxonomyService } from '../crm-lead-taxonomy/crm-lead-taxonomy.service';
import { LeadTaxonomyKind } from '../crm-lead-taxonomy/lead-taxonomy.dto';
import { paginate } from '../common/pagination.dto';
import { resolveOrderBy, type SortableMap } from '../common/sort.util';
import { CreateCrmActivityDto } from './crm-activities.dto';

export const ACTIVITY_INCLUDES = {
    lead: { select: { id: true, name: true, mobile: true } },
    customer: { select: { id: true, name: true, phone: true } },
    purpose: { select: { id: true, code: true, name: true, icon: true } },
    channel: { select: { id: true, code: true, name: true, icon: true } },
    assignee: { select: { id: true, name: true, email: true } },
    creator: { select: { id: true, name: true, email: true } },
};

const ACTIVITY_SORTABLE: SortableMap = {
    due_at: (dir) => ({ due_at: dir }),
    completed_at: (dir) => ({ completed_at: dir }),
    created_at: (dir) => ({ created_at: dir }),
    status: (dir) => ({ status: dir }),
    subject: (dir) => ({ subject: dir }),
};

const ACTIVITY_DEFAULT_ORDER = [{ due_at: 'asc' as const }, { created_at: 'desc' as const }];

export type ListActivityOpts = {
    leadId?: string;
    customerId?: string;
    target?: 'lead' | 'customer';
    status?: string;
    assignedTo?: string;
    purposeId?: string;
    channelId?: string;
    dueToday?: boolean;
    overdue?: boolean;
    page?: number;
    limit?: number;
    sortBy?: string;
    sortDir?: string;
};

function startOfToday(): Date {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
}

@Injectable()
export class CrmActivitiesService {
    constructor(
        private readonly db: DatabaseService,
        private readonly taxonomy: CrmLeadTaxonomyService,
        private readonly logger: AppLogger,
        private readonly notifications: NotificationsService,
    ) {}

    /**
     * Exactly one of lead_id / customer_id, and it must exist in this tenant.
     * Lifted verbatim from CrmFollowUpsService.validateFollowUpTarget so the
     * rule does not fork.
     */
    private async resolveTarget(tenantId: string, leadId?: string, customerId?: string) {
        const hasLead = Boolean(leadId);
        const hasCustomer = Boolean(customerId);
        if (hasLead === hasCustomer) {
            throw new BadRequestException('Provide exactly one of lead_id or customer_id.');
        }

        if (leadId) {
            const lead = await this.db.lead.findFirst({
                where: { id: leadId, tenant_id: tenantId },
                select: { id: true, status: true },
            });
            if (!lead) throw new NotFoundException('Lead not found');
            if (lead.status === 'LOST' || lead.status === 'CONVERTED') {
                throw new BadRequestException(
                    'Activities cannot be created for lost or converted leads.',
                );
            }
            return { lead_id: leadId };
        }

        const customer = await this.db.customer.findFirst({
            where: { id: customerId, tenant_id: tenantId, deleted_at: null },
            select: { id: true },
        });
        if (!customer) throw new NotFoundException('Customer not found');
        return { customer_id: customerId };
    }

    private async resolveChannel(tenantId: string, value: string) {
        const channel = await this.taxonomy.resolveByIdOrCode(
            tenantId,
            LeadTaxonomyKind.CHANNEL,
            value,
        );
        if (!channel) throw new BadRequestException(`Unknown conversation channel "${value}".`);
        if (!channel.is_active) {
            throw new BadRequestException(`Conversation channel "${channel.name}" is retired.`);
        }
        return channel;
    }

    private async resolvePurpose(tenantId: string, value?: string) {
        if (!value) return null;
        const purpose = await this.taxonomy.resolveByIdOrCode(
            tenantId,
            LeadTaxonomyKind.PURPOSE,
            value,
        );
        if (!purpose) throw new BadRequestException(`Unknown activity purpose "${value}".`);
        return purpose;
    }

    async create(tenantId: string, userId: string, dto: CreateCrmActivityDto) {
        const target = await this.resolveTarget(tenantId, dto.lead_id, dto.customer_id);
        const status = dto.status ?? 'PLANNED';

        if (status === 'PLANNED' && !dto.subject) {
            throw new BadRequestException('subject is required when planning an activity.');
        }
        if (status === 'DONE' && (!dto.summary || !dto.channel)) {
            throw new BadRequestException(
                'summary and channel are required when logging a completed activity.',
            );
        }

        const purpose = await this.resolvePurpose(tenantId, dto.purpose);
        const channel = dto.channel ? await this.resolveChannel(tenantId, dto.channel) : null;
        const now = new Date();

        const activity = await this.db.crmActivity.create({
            data: {
                tenant_id: tenantId,
                ...target,
                subject: dto.subject ?? null,
                status,
                due_at: dto.due_at ? new Date(dto.due_at) : null,
                completed_at: status === 'DONE' ? now : null,
                purpose_id: purpose?.id ?? null,
                channel_id: channel?.id ?? null,
                channel_code: channel?.code ?? null,
                summary: dto.summary ?? null,
                outcome: dto.outcome ?? null,
                notes: dto.notes ?? null,
                direction: dto.direction ?? 'OUTBOUND',
                assigned_to: dto.assigned_to ?? null,
                store_id: dto.store_id ?? null,
                created_by: userId,
                origin: 'MANUAL',
            },
            include: ACTIVITY_INCLUDES,
        });

        await this.recalculateRollup(this.db, tenantId, target);
        await this.notifyAssignee(tenantId, userId, activity);
        return activity;
    }

    async findAll(tenantId: string, opts: ListActivityOpts) {
        const page = opts.page ?? 1;
        const limit = Math.min(opts.limit ?? 20, 100);
        const skip = (page - 1) * limit;

        const where: any = { tenant_id: tenantId };
        if (opts.leadId) where.lead_id = opts.leadId;
        if (opts.customerId) where.customer_id = opts.customerId;
        if (opts.target === 'lead') where.lead_id = { not: null };
        if (opts.target === 'customer') where.customer_id = { not: null };
        if (opts.status) where.status = opts.status;
        if (opts.assignedTo) where.assigned_to = opts.assignedTo;
        if (opts.purposeId) where.purpose_id = opts.purposeId;
        if (opts.channelId) where.channel_id = opts.channelId;

        if (opts.dueToday) {
            const today = startOfToday();
            const tomorrow = new Date(today);
            tomorrow.setDate(tomorrow.getDate() + 1);
            where.status = 'PLANNED';
            where.due_at = { gte: today, lt: tomorrow };
        }
        if (opts.overdue) {
            where.status = 'PLANNED';
            where.due_at = { lt: startOfToday() };
        }

        const [items, total] = await Promise.all([
            this.db.crmActivity.findMany({
                where,
                include: ACTIVITY_INCLUDES,
                orderBy: resolveOrderBy(
                    opts.sortBy,
                    opts.sortDir,
                    ACTIVITY_SORTABLE,
                    ACTIVITY_DEFAULT_ORDER,
                ) as any,
                skip,
                take: limit,
            }),
            this.db.crmActivity.count({ where }),
        ]);

        return paginate(items, total, page, limit);
    }

    async findOne(tenantId: string, id: string) {
        const activity = await this.db.crmActivity.findFirst({
            where: { id, tenant_id: tenantId },
            include: ACTIVITY_INCLUDES,
        });
        if (!activity) throw new NotFoundException('Activity not found');
        return activity;
    }
}
```

`recalculateRollup` and `notifyAssignee` are Task 4. To keep this task's tests green, add these two temporary stubs at the bottom of the class now and replace them in Task 4:

```typescript
    private async recalculateRollup(_tx: any, _tenantId: string, _target: any) {}
    private async notifyAssignee(_tenantId: string, _userId: string, _activity: any) {}
```

The `create()` rollup assertion in Step 1 will still fail — that is expected and Task 4 closes it. Mark that one test `it.skip` here with the comment `// unskipped in Task 4` and unskip it there.

- [ ] **Step 5: Write the controller and module**

Create `apps/backend/src/crm-activities/crm-activities.controller.ts`:

```typescript
import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards, UseInterceptors } from '@nestjs/common';
import { StorePermission } from '@erp71/shared-types';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { StorePermissionGuard } from '../auth/store-permission.guard';
import { RequireStorePermission } from '../auth/store-permission.decorator';
import { SubscriptionAccessGuard } from '../auth/subscription-access.guard';
import { RequiresFeature } from '../auth/subscription-access.decorator';
import { TenantInterceptor } from '../database/tenant.interceptor';
import { Tenant, TenantContext } from '../database/tenant.decorator';
import { CrmActivitiesService } from './crm-activities.service';
import { CreateCrmActivityDto, UpdateCrmActivityDto, CompleteCrmActivityDto } from './crm-activities.dto';

@Controller('crm/activities')
@UseGuards(JwtAuthGuard, StorePermissionGuard, SubscriptionAccessGuard)
@RequiresFeature('premiumCrm')
@UseInterceptors(TenantInterceptor)
export class CrmActivitiesController {
    constructor(private readonly service: CrmActivitiesService) {}

    @Get('summary')
    @RequireStorePermission(StorePermission.VIEW_CRM_INTERACTIONS)
    summary(@Tenant() tenant: TenantContext) {
        return this.service.summary(tenant.tenantId);
    }

    @Post()
    @RequireStorePermission(StorePermission.MANAGE_CRM_TASKS)
    create(@Tenant() tenant: TenantContext, @Body() dto: CreateCrmActivityDto) {
        return this.service.create(tenant.tenantId, tenant.userId, dto);
    }

    @Get()
    @RequireStorePermission(StorePermission.VIEW_CRM_INTERACTIONS)
    findAll(
        @Tenant() tenant: TenantContext,
        @Query('leadId') leadId?: string,
        @Query('customerId') customerId?: string,
        @Query('target') target?: 'lead' | 'customer',
        @Query('status') status?: string,
        @Query('assignedTo') assignedTo?: string,
        @Query('purposeId') purposeId?: string,
        @Query('channelId') channelId?: string,
        @Query('dueToday') dueToday?: string,
        @Query('overdue') overdue?: string,
        @Query('page') page?: string,
        @Query('limit') limit?: string,
        @Query('sortBy') sortBy?: string,
        @Query('sortDir') sortDir?: string,
    ) {
        return this.service.findAll(tenant.tenantId, {
            leadId, customerId, target, status, assignedTo, purposeId, channelId,
            dueToday: dueToday === 'true',
            overdue: overdue === 'true',
            page: page ? parseInt(page, 10) : undefined,
            limit: limit ? parseInt(limit, 10) : undefined,
            sortBy, sortDir,
        });
    }

    @Get(':id')
    @RequireStorePermission(StorePermission.VIEW_CRM_INTERACTIONS)
    findOne(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.service.findOne(tenant.tenantId, id);
    }

    @Patch(':id')
    @RequireStorePermission(StorePermission.MANAGE_CRM_TASKS)
    update(@Tenant() tenant: TenantContext, @Param('id') id: string, @Body() dto: UpdateCrmActivityDto) {
        return this.service.update(tenant.tenantId, id, dto);
    }

    @Post(':id/complete')
    @RequireStorePermission(StorePermission.CREATE_CRM_INTERACTIONS)
    complete(@Tenant() tenant: TenantContext, @Param('id') id: string, @Body() dto: CompleteCrmActivityDto) {
        return this.service.complete(tenant.tenantId, tenant.userId, id, dto);
    }

    @Post(':id/cancel')
    @RequireStorePermission(StorePermission.MANAGE_CRM_TASKS)
    cancel(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.service.cancel(tenant.tenantId, id);
    }

    @Delete(':id')
    @RequireStorePermission(StorePermission.MANAGE_CRM_TASKS)
    remove(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.service.remove(tenant.tenantId, id);
    }
}
```

`update`, `complete`, `cancel`, `remove` and `summary` land in Tasks 4–6. Add throwaway one-line stubs on the service returning `Promise.reject(new Error('not implemented'))` so this compiles now; each is replaced by its real task.

Create `apps/backend/src/crm-activities/crm-activities.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { CrmActivitiesController } from './crm-activities.controller';
import { CrmActivitiesService } from './crm-activities.service';
import { DatabaseModule } from '../database/database.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { CrmLeadTaxonomyModule } from '../crm-lead-taxonomy/crm-lead-taxonomy.module';
import { StorePermissionGuard } from '../auth/store-permission.guard';

@Module({
    imports: [DatabaseModule, NotificationsModule, CrmLeadTaxonomyModule],
    controllers: [CrmActivitiesController],
    providers: [CrmActivitiesService, StorePermissionGuard],
    exports: [CrmActivitiesService],
})
export class CrmActivitiesModule {}
```

Register `CrmActivitiesModule` in `apps/backend/src/app.module.ts` alongside `CrmFollowUpsModule`.

- [ ] **Step 6: Run the tests**

Run: `npm test --workspace=apps/backend -- crm-activities`
Expected: PASS (with the one rollup test skipped).

- [ ] **Step 7: Verify it builds and commit**

Run: `npm run build --workspace=apps/backend`
Expected: clean.

```bash
git add apps/backend/src/crm-activities apps/backend/src/app.module.ts
git commit -m "feat(crm): add CrmActivity module with create, list and read"
```

---

## Task 4: `recalculateRollup` + assignee notification

**Files:**
- Modify: `apps/backend/src/crm-activities/crm-activities.service.ts`
- Test: `apps/backend/src/crm-activities/crm-activities.service.spec.ts`

**Interfaces:**
- Consumes: `resolveTarget` from Task 3.
- Produces: `private recalculateRollup(tx: any, tenantId: string, target: { lead_id?: string | null; customer_id?: string | null }): Promise<void>` — every later mutation calls it with the transaction client. `private notifyAssignee(tenantId, actingUserId, activity): Promise<void>`.

- [ ] **Step 1: Unskip the Task 3 rollup test and add the rollup cases**

Unskip `creates a planned activity and recalculates the rollup`, then append:

```typescript
    describe('recalculateRollup()', () => {
        it('nulls every rollup column when no planned activity remains', async () => {
            db.crmActivity.findFirst.mockResolvedValue(null);
            db.crmActivity.findFirst.mockResolvedValueOnce({ id: 'a1', lead_id: 'l1', status: 'PLANNED' });
            db.crmActivity.update.mockResolvedValue({ id: 'a1', lead_id: 'l1' });
            db.crmActivity.findFirst.mockResolvedValue(null);

            await service.cancel('t1', 'a1');

            expect(db.lead.update).toHaveBeenCalledWith({
                where: { id: 'l1' },
                data: {
                    next_step: null,
                    next_step_date: null,
                    next_step_assigned_to: null,
                    next_activity_id: null,
                },
            });
        });

        it('picks the earliest planned activity, nulls last', async () => {
            db.lead.findFirst.mockResolvedValue({ id: 'l1', status: 'NEW' });
            db.crmActivity.create.mockResolvedValue({ id: 'a2' });
            db.crmActivity.findFirst.mockResolvedValue({
                id: 'a2', subject: 'Earliest', due_at: new Date('2026-08-14'), assigned_to: null,
            });

            await service.create('t1', 'u1', { lead_id: 'l1', subject: 'Earliest' } as any);

            expect(db.crmActivity.findFirst).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: { tenant_id: 't1', lead_id: 'l1', status: 'PLANNED' },
                    orderBy: [{ due_at: 'asc' }, { created_at: 'asc' }],
                }),
            );
        });

        it('writes the customer rollup for a customer activity', async () => {
            db.customer.findFirst.mockResolvedValue({ id: 'c1' });
            db.crmActivity.create.mockResolvedValue({ id: 'a3' });
            db.crmActivity.findFirst.mockResolvedValue({
                id: 'a3', subject: 'Reorder call', due_at: new Date('2026-09-01'), assigned_to: null,
            });

            await service.create('t1', 'u1', { customer_id: 'c1', subject: 'Reorder call' } as any);

            expect(db.customer.update).toHaveBeenCalledWith({
                where: { id: 'c1' },
                data: { next_activity_id: 'a3', next_activity_date: new Date('2026-09-01') },
            });
            expect(db.lead.update).not.toHaveBeenCalled();
        });
    });

    describe('notifyAssignee()', () => {
        it('notifies an assignee who is not the acting user', async () => {
            db.lead.findFirst.mockResolvedValue({ id: 'l1', status: 'NEW' });
            db.crmActivity.create.mockResolvedValue({ id: 'a1', assigned_to: 'u2', subject: 'Call' });
            db.crmActivity.findFirst.mockResolvedValue(null);

            await service.create('t1', 'u1', { lead_id: 'l1', subject: 'Call', assigned_to: 'u2' } as any);

            const notifications = (service as any).notifications;
            expect(notifications.create).toHaveBeenCalled();
        });

        it('does not notify the person who just filled in the form', async () => {
            db.lead.findFirst.mockResolvedValue({ id: 'l1', status: 'NEW' });
            db.crmActivity.create.mockResolvedValue({ id: 'a1', assigned_to: 'u1', subject: 'Call' });
            db.crmActivity.findFirst.mockResolvedValue(null);

            await service.create('t1', 'u1', { lead_id: 'l1', subject: 'Call', assigned_to: 'u1' } as any);

            const notifications = (service as any).notifications;
            expect(notifications.create).not.toHaveBeenCalled();
        });
    });
```

- [ ] **Step 2: Run to verify the new cases fail**

Run: `npm test --workspace=apps/backend -- crm-activities`
Expected: FAIL — the stubs write nothing.

- [ ] **Step 3: Replace the two stubs with real implementations**

```typescript
    /**
     * The parent's next_* columns are a cache of its earliest PLANNED activity.
     * This is the ONLY writer of those five columns — nothing else may set them,
     * or they drift back into the hand-maintained field this design replaced.
     *
     * `tx` is the transaction client when called inside one, so the rollup and
     * the mutation that caused it commit together.
     */
    private async recalculateRollup(
        tx: any,
        tenantId: string,
        target: { lead_id?: string | null; customer_id?: string | null },
    ) {
        const where = target.lead_id
            ? { tenant_id: tenantId, lead_id: target.lead_id, status: 'PLANNED' }
            : { tenant_id: tenantId, customer_id: target.customer_id, status: 'PLANNED' };

        // NULLS LAST is not expressible in a Prisma orderBy shorthand, but an
        // undated activity sorting first would make it the "next step" ahead of
        // a dated one. Fetch dated rows first; fall back to any planned row.
        const next =
            (await tx.crmActivity.findFirst({
                where: { ...where, due_at: { not: null } },
                orderBy: [{ due_at: 'asc' }, { created_at: 'asc' }],
                select: { id: true, subject: true, due_at: true, assigned_to: true },
            })) ??
            (await tx.crmActivity.findFirst({
                where,
                orderBy: [{ due_at: 'asc' }, { created_at: 'asc' }],
                select: { id: true, subject: true, due_at: true, assigned_to: true },
            }));

        if (target.lead_id) {
            await tx.lead.update({
                where: { id: target.lead_id },
                data: {
                    next_step: next?.subject ?? null,
                    next_step_date: next?.due_at ?? null,
                    next_step_assigned_to: next?.assigned_to ?? null,
                    next_activity_id: next?.id ?? null,
                },
            });
            return;
        }

        await tx.customer.update({
            where: { id: target.customer_id },
            data: {
                next_activity_id: next?.id ?? null,
                next_activity_date: next?.due_at ?? null,
            },
        });
    }

    /**
     * In-app notification for the assignee. Skipped when they are the person who
     * just created the row — they are already looking at it — matching the guard
     * CrmFollowUpsService.notifyOwner already applies to cron-created rows.
     * Failure is logged, never thrown: a notification outage must not fail the
     * write it describes.
     */
    private async notifyAssignee(tenantId: string, actingUserId: string, activity: any) {
        if (!activity.assigned_to || activity.assigned_to === actingUserId) return;
        try {
            await this.notifications.create({
                tenant_id: tenantId,
                user_id: activity.assigned_to,
                type: 'CRM_ACTIVITY_ASSIGNED',
                title: activity.subject ?? 'CRM activity assigned',
                body: activity.subject ?? '',
                link: `/crm/activities?highlight=${activity.id}`,
            } as any);
        } catch (err) {
            this.logger.error(`Failed to notify assignee of activity ${activity.id}: ${err}`);
        }
    }
```

Check `NotificationsService.create`'s real signature in `apps/backend/src/notifications/notifications.service.ts` and match it — mirror how `CrmFollowUpsService.notifyOwner` (around line 322) calls it rather than inventing fields.

- [ ] **Step 4: Run to verify they pass**

Run: `npm test --workspace=apps/backend -- crm-activities`
Expected: PASS, all cases including the previously skipped one.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/crm-activities
git commit -m "feat(crm): make CrmActivity the sole writer of the next-step rollup"
```

---

## Task 5: `complete()` — the closed loop

**Files:**
- Modify: `apps/backend/src/crm-activities/crm-activities.service.ts`
- Test: `apps/backend/src/crm-activities/crm-activities.service.spec.ts`

**Interfaces:**
- Consumes: `recalculateRollup`, `resolveChannel`, `resolvePurpose`.
- Produces: `complete(tenantId: string, userId: string, id: string, dto: CompleteCrmActivityDto): Promise<{ completed: CrmActivity; next: CrmActivity | null }>`.

- [ ] **Step 1: Write the failing tests**

```typescript
    describe('complete()', () => {
        const planned = {
            id: 'a1', tenant_id: 't1', lead_id: 'l1', customer_id: null,
            status: 'PLANNED', purpose_id: 'p1',
        };

        beforeEach(() => {
            taxonomy.resolveByIdOrCode.mockResolvedValue({
                id: 'ch1', code: 'CALL', name: 'Call', is_active: true,
            });
        });

        it('400s an already-completed activity', async () => {
            db.crmActivity.findFirst.mockResolvedValue({ ...planned, status: 'DONE' });
            await expect(
                service.complete('t1', 'u1', 'a1', { channel: 'CALL', summary: 's' } as any),
            ).rejects.toThrow(BadRequestException);
        });

        it('400s a cancelled activity', async () => {
            db.crmActivity.findFirst.mockResolvedValue({ ...planned, status: 'CANCELLED' });
            await expect(
                service.complete('t1', 'u1', 'a1', { channel: 'CALL', summary: 's' } as any),
            ).rejects.toThrow(BadRequestException);
        });

        it('marks DONE, stamps the lead last_contacted_at and returns no next', async () => {
            db.crmActivity.findFirst.mockResolvedValueOnce(planned).mockResolvedValue(null);
            db.crmActivity.update.mockResolvedValue({ ...planned, status: 'DONE' });

            const res = await service.complete('t1', 'u1', 'a1', {
                channel: 'CALL', summary: 'Spoke to Karim', outcome: 'Promised Thursday',
            } as any);

            expect(db.crmActivity.update).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: { id: 'a1' },
                    data: expect.objectContaining({
                        status: 'DONE',
                        summary: 'Spoke to Karim',
                        outcome: 'Promised Thursday',
                        channel_id: 'ch1',
                        channel_code: 'CALL',
                    }),
                }),
            );
            expect(db.lead.update).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: { id: 'l1' },
                    data: expect.objectContaining({ last_contacted_at: expect.any(Date) }),
                }),
            );
            expect(res.next).toBeNull();
        });

        it('creates the next activity in the same call, inheriting the purpose', async () => {
            db.crmActivity.findFirst.mockResolvedValueOnce(planned).mockResolvedValue(null);
            db.crmActivity.update.mockResolvedValue({ ...planned, status: 'DONE' });
            db.crmActivity.create.mockResolvedValue({ id: 'a2', subject: 'Confirm payment' });

            const res = await service.complete('t1', 'u1', 'a1', {
                channel: 'CALL',
                summary: 'Spoke to Karim',
                next: { subject: 'Confirm payment', due_at: '2026-08-15T10:00:00Z' },
            } as any);

            expect(db.crmActivity.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({
                        subject: 'Confirm payment',
                        status: 'PLANNED',
                        lead_id: 'l1',
                        purpose_id: 'p1',
                    }),
                }),
            );
            expect(res.next).toEqual({ id: 'a2', subject: 'Confirm payment' });
        });

        it('stamps last_contacted_at on a customer activity too', async () => {
            db.crmActivity.findFirst
                .mockResolvedValueOnce({ ...planned, lead_id: null, customer_id: 'c1' })
                .mockResolvedValue(null);
            db.crmActivity.update.mockResolvedValue({ status: 'DONE' });

            await service.complete('t1', 'u1', 'a1', { channel: 'CALL', summary: 's' } as any);

            expect(db.customer.update).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({ last_contacted_at: expect.any(Date) }),
                }),
            );
        });
    });
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test --workspace=apps/backend -- crm-activities -t complete`
Expected: FAIL — `complete` is the reject stub.

- [ ] **Step 3: Implement `complete()`**

```typescript
    /**
     * Mark done, record what happened, and optionally schedule the next one —
     * in a single transaction. This endpoint is why the merge exists: before it,
     * completing a follow-up and logging the call it produced were two writes to
     * two tables with nothing linking them.
     */
    async complete(tenantId: string, userId: string, id: string, dto: CompleteCrmActivityDto) {
        const existing = await this.db.crmActivity.findFirst({
            where: { id, tenant_id: tenantId },
        });
        if (!existing) throw new NotFoundException('Activity not found');
        if (existing.status !== 'PLANNED') {
            // Not a no-op: a double-submitted form would otherwise create a
            // second "next" activity for one completion.
            throw new BadRequestException(`Activity is already ${existing.status.toLowerCase()}.`);
        }

        const channel = await this.resolveChannel(tenantId, dto.channel);
        const nextPurpose = dto.next?.purpose
            ? await this.resolvePurpose(tenantId, dto.next.purpose)
            : null;

        // Typed as both-optional rather than a union: rescoreLead and
        // recalculateRollup both read `.lead_id` off it, which a
        // `{lead_id} | {customer_id}` union rejects at compile time.
        const target: { lead_id?: string | null; customer_id?: string | null } = existing.lead_id
            ? { lead_id: existing.lead_id }
            : { customer_id: existing.customer_id };
        const now = new Date();

        return this.db.$transaction(async (tx: any) => {
            const completed = await tx.crmActivity.update({
                where: { id },
                data: {
                    status: 'DONE',
                    completed_at: now,
                    channel_id: channel.id,
                    channel_code: channel.code,
                    summary: dto.summary,
                    outcome: dto.outcome ?? null,
                    direction: dto.direction ?? existing.direction,
                },
                include: ACTIVITY_INCLUDES,
            });

            let next = null;
            if (dto.next) {
                next = await tx.crmActivity.create({
                    data: {
                        tenant_id: tenantId,
                        ...target,
                        subject: dto.next.subject,
                        status: 'PLANNED',
                        due_at: new Date(dto.next.due_at),
                        // Inherit the purpose and assignee of the activity being
                        // closed unless the caller overrode them — chasing the
                        // same invoice is still a COLLECTION.
                        purpose_id: nextPurpose?.id ?? existing.purpose_id,
                        assigned_to: dto.next.assigned_to ?? existing.assigned_to,
                        store_id: existing.store_id,
                        created_by: userId,
                        origin: 'MANUAL',
                    },
                    include: ACTIVITY_INCLUDES,
                });
            }

            await this.stampLastContacted(tx, target, now);
            await this.recalculateRollup(tx, tenantId, target);
            await this.rescoreLead(tx, tenantId, target.lead_id);

            return { completed, next };
        });
    }

    /**
     * Completion now counts as contact. Before the merge only logging a
     * conversation did, so the reorder cron re-fired at customers the team had
     * called and marked done.
     */
    private async stampLastContacted(tx: any, target: any, at: Date) {
        if (target.lead_id) {
            await tx.lead.update({ where: { id: target.lead_id }, data: { last_contacted_at: at } });
            return;
        }
        await tx.customer.update({
            where: { id: target.customer_id },
            data: { last_contacted_at: at },
        });
    }
```

`rescoreLead` is Task 6 — add `private async rescoreLead(_tx: any, _tenantId: string, _leadId?: string | null) {}` as a stub now.

Note the ordering: `stampLastContacted` writes `last_contacted_at` and `recalculateRollup` writes the `next_*` columns, both via `lead.update`. They are separate updates on purpose — merging them would couple the rollup writer to the contact stamp and break the "one writer per concern" rule that keeps the rollup auditable.

- [ ] **Step 4: Run to verify it passes**

Run: `npm test --workspace=apps/backend -- crm-activities -t complete`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/crm-activities
git commit -m "feat(crm): add complete() closing the plan -> log -> schedule loop"
```

---

## Task 6: `update`, `cancel`, `remove`, `summary`, and lead rescoring

**Files:**
- Modify: `apps/backend/src/crm-activities/crm-activities.service.ts`
- Test: `apps/backend/src/crm-activities/crm-activities.service.spec.ts`

**Interfaces:**
- Produces: `update(tenantId, id, dto)`, `cancel(tenantId, id)`, `remove(tenantId, id)`, `summary(tenantId): Promise<{ dueToday: number; overdue: number; total: number }>`, `private rescoreLead(tx, tenantId, leadId)`.

- [ ] **Step 1: Write the failing tests**

```typescript
    describe('update()', () => {
        it('recalculates the rollup after a reschedule', async () => {
            db.crmActivity.findFirst
                .mockResolvedValueOnce({ id: 'a1', tenant_id: 't1', lead_id: 'l1', status: 'PLANNED' })
                .mockResolvedValue(null);
            db.crmActivity.update.mockResolvedValue({ id: 'a1', lead_id: 'l1' });

            await service.update('t1', 'a1', { due_at: '2026-09-01T00:00:00Z' } as any);

            expect(db.crmActivity.update).toHaveBeenCalledWith(
                expect.objectContaining({ data: expect.objectContaining({ due_at: new Date('2026-09-01T00:00:00Z') }) }),
            );
            expect(db.lead.update).toHaveBeenCalled();
        });

        it('refuses to edit a completed activity', async () => {
            db.crmActivity.findFirst.mockResolvedValue({ id: 'a1', tenant_id: 't1', status: 'DONE' });
            await expect(service.update('t1', 'a1', { subject: 'x' } as any)).rejects.toThrow(
                BadRequestException,
            );
        });
    });

    describe('summary()', () => {
        it('counts due today, overdue and total planned', async () => {
            db.crmActivity.count
                .mockResolvedValueOnce(3)
                .mockResolvedValueOnce(5)
                .mockResolvedValueOnce(11);
            const res = await service.summary('t1');
            expect(res).toEqual({ dueToday: 3, overdue: 5, total: 11 });
        });
    });

    describe('rescoreLead()', () => {
        it('counts DONE activities as the conversation count', async () => {
            db.crmActivity.findFirst.mockResolvedValueOnce({
                id: 'a1', tenant_id: 't1', lead_id: 'l1', status: 'PLANNED', purpose_id: null,
            }).mockResolvedValue(null);
            db.crmActivity.update.mockResolvedValue({ status: 'DONE' });
            db.crmActivity.count.mockResolvedValue(4);
            db.lead.findFirst.mockResolvedValue({
                id: 'l1', status: 'CONTACTED', priority: 'MEDIUM',
                last_contacted_at: null, next_step_date: null,
                sourceOption: { score_weight: 20 },
            });
            taxonomy.resolveByIdOrCode.mockResolvedValue({ id: 'ch1', code: 'CALL', name: 'Call', is_active: true });

            await service.complete('t1', 'u1', 'a1', { channel: 'CALL', summary: 's' } as any);

            expect(db.crmActivity.count).toHaveBeenCalledWith({
                where: { tenant_id: 't1', lead_id: 'l1', status: 'DONE' },
            });
            expect(db.lead.update).toHaveBeenCalledWith(
                expect.objectContaining({ data: expect.objectContaining({ score: expect.any(Number) }) }),
            );
        });
    });
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test --workspace=apps/backend -- crm-activities`
Expected: FAIL — the four methods are stubs.

- [ ] **Step 3: Implement them**

```typescript
    async update(tenantId: string, id: string, dto: UpdateCrmActivityDto) {
        const existing = await this.db.crmActivity.findFirst({ where: { id, tenant_id: tenantId } });
        if (!existing) throw new NotFoundException('Activity not found');
        if (existing.status !== 'PLANNED') {
            throw new BadRequestException('Only a planned activity can be edited.');
        }

        const purpose = await this.resolvePurpose(tenantId, dto.purpose);
        const data: any = {};
        if (dto.subject !== undefined) data.subject = dto.subject;
        if (dto.due_at !== undefined) data.due_at = dto.due_at ? new Date(dto.due_at) : null;
        if (dto.notes !== undefined) data.notes = dto.notes;
        if (dto.assigned_to !== undefined) data.assigned_to = dto.assigned_to;
        if (purpose) data.purpose_id = purpose.id;

        const updated = await this.db.crmActivity.update({
            where: { id },
            data,
            include: ACTIVITY_INCLUDES,
        });

        const target = existing.lead_id
            ? { lead_id: existing.lead_id }
            : { customer_id: existing.customer_id };
        await this.recalculateRollup(this.db, tenantId, target);
        return updated;
    }

    /** Cancels rather than deletes: the fact that it was planned is history. */
    async cancel(tenantId: string, id: string) {
        const existing = await this.db.crmActivity.findFirst({ where: { id, tenant_id: tenantId } });
        if (!existing) throw new NotFoundException('Activity not found');

        const updated = await this.db.crmActivity.update({
            where: { id },
            data: { status: 'CANCELLED' },
            include: ACTIVITY_INCLUDES,
        });

        const target = existing.lead_id
            ? { lead_id: existing.lead_id }
            : { customer_id: existing.customer_id };
        await this.recalculateRollup(this.db, tenantId, target);
        return updated;
    }

    async remove(tenantId: string, id: string) {
        const existing = await this.db.crmActivity.findFirst({ where: { id, tenant_id: tenantId } });
        if (!existing) throw new NotFoundException('Activity not found');

        await this.db.crmActivity.delete({ where: { id } });

        const target = existing.lead_id
            ? { lead_id: existing.lead_id }
            : { customer_id: existing.customer_id };
        await this.recalculateRollup(this.db, tenantId, target);
        return { success: true };
    }

    async summary(tenantId: string) {
        const today = startOfToday();
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);

        const [dueToday, overdue, total] = await Promise.all([
            this.db.crmActivity.count({
                where: { tenant_id: tenantId, status: 'PLANNED', due_at: { gte: today, lt: tomorrow } },
            }),
            this.db.crmActivity.count({
                where: { tenant_id: tenantId, status: 'PLANNED', due_at: { lt: today } },
            }),
            this.db.crmActivity.count({ where: { tenant_id: tenantId, status: 'PLANNED' } }),
        ]);

        return { dueToday, overdue, total };
    }

    /**
     * Completion rescores the lead. computeLeadScore is unchanged — only the
     * source of its conversationCount moves, from LeadConversation rows to DONE
     * activities. After the backfill those counts are identical, so no lead is
     * rescored on migration day.
     */
    private async rescoreLead(tx: any, tenantId: string, leadId?: string | null) {
        if (!leadId) return;

        const lead = await tx.lead.findFirst({
            where: { id: leadId, tenant_id: tenantId },
            include: { sourceOption: { select: { score_weight: true } } },
        });
        if (!lead) return;

        const doneCount = await tx.crmActivity.count({
            where: { tenant_id: tenantId, lead_id: leadId, status: 'DONE' },
        });

        const score = computeLeadScore(
            {
                status: lead.status,
                sourceWeight: lead.sourceOption?.score_weight ?? DEFAULT_SOURCE_WEIGHT,
                priority: lead.priority,
                last_contacted_at: lead.last_contacted_at,
                next_step_date: lead.next_step_date,
            },
            doneCount,
        );

        await tx.lead.update({ where: { id: leadId }, data: { score } });
    }
```

Import at the top: `import { computeLeadScore, DEFAULT_SOURCE_WEIGHT } from '../crm-leads/lead-scoring.util';` — check the exact export names in that file first and match them.

- [ ] **Step 4: Run the full activities suite**

Run: `npm test --workspace=apps/backend -- crm-activities`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/crm-activities
git commit -m "feat(crm): add activity update, cancel, delete, summary and rescoring"
```

---

## Task 7: Move the two crons onto `CrmActivity`

**Files:**
- Modify: `apps/backend/src/crm-activities/crm-activities.service.ts`
- Modify: `apps/backend/src/crm-follow-ups/crm-follow-ups.service.ts` (remove the two `@Cron` methods and their impls)
- Test: `apps/backend/src/crm-activities/crm-activities.service.spec.ts`
- Test: `apps/backend/src/crm-follow-ups/crm-follow-ups.service.spec.ts` (delete the cron cases moved over)

**Interfaces:**
- Consumes: `recalculateRollup`, `notifyAssignee`.
- Produces: `autoCreateBirthdayActivities()`, `autoCreateReorderActivities()` — both `@Cron(CronExpression.EVERY_DAY_AT_8AM)` wrapped in `jobTracker.track` with the existing `JOB_NAMES.CRM_BIRTHDAY_FOLLOWUPS` / `JOB_NAMES.CRM_REORDER_REMINDERS`.

- [ ] **Step 1: Write the failing tests**

```typescript
    describe('crons', () => {
        it('creates a birthday activity with the BIRTHDAY purpose and cron origin', async () => {
            db.$queryRaw.mockResolvedValue([{ id: 'c1', tenant_id: 't1', name: 'Karim' }]);
            db.crmActivity.findFirst.mockResolvedValue(null);
            db.crmActivity.create.mockResolvedValue({ id: 'a1', customer_id: 'c1' });
            taxonomy.resolveByIdOrCode.mockResolvedValue({ id: 'p-bday', code: 'BIRTHDAY', name: 'Birthday', is_active: true });

            await service.autoCreateBirthdayActivities();

            expect(db.crmActivity.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({
                        customer_id: 'c1',
                        status: 'PLANNED',
                        origin: 'BIRTHDAY_CRON',
                        purpose_id: 'p-bday',
                    }),
                }),
            );
        });

        it('does not duplicate an existing planned birthday activity', async () => {
            db.$queryRaw.mockResolvedValue([{ id: 'c1', tenant_id: 't1', name: 'Karim' }]);
            db.crmActivity.findFirst.mockResolvedValue({ id: 'existing' });
            taxonomy.resolveByIdOrCode.mockResolvedValue({ id: 'p-bday', code: 'BIRTHDAY', name: 'Birthday', is_active: true });

            await service.autoCreateBirthdayActivities();

            expect(db.crmActivity.create).not.toHaveBeenCalled();
        });

        it('treats a null last_contacted_at as dormant', async () => {
            db.customer.findMany.mockResolvedValue([]);
            await service.autoCreateReorderActivities();
            const where = db.customer.findMany.mock.calls[0][0].where;
            expect(where.OR).toEqual([
                { last_contacted_at: { lt: expect.any(Date) } },
                { last_contacted_at: null, created_at: { lt: expect.any(Date) } },
            ]);
        });
    });
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test --workspace=apps/backend -- crm-activities -t crons`
Expected: FAIL — methods don't exist.

- [ ] **Step 3: Port both crons**

Copy `autoCreateBirthdayFollowUpsImpl` and `autoCreateReorderRemindersImpl` from `crm-follow-ups.service.ts:214-310` into the activities service, renaming to `autoCreateBirthdayActivitiesImpl` / `autoCreateReorderActivitiesImpl`, and change four things in each:

1. `this.db.crmFollowUp.create` → `this.db.crmActivity.create`, with `title` → `subject`, `type` → resolved `purpose_id`, and added `status: 'PLANNED'` + `origin: 'BIRTHDAY_CRON'` / `'REORDER_CRON'`.
2. The duplicate guard's `findFirst` filters `{ tenant_id, customer_id, purpose_id, status: 'PLANNED' }` instead of `{ type, status: 'PENDING' }`.
3. Resolve the purpose once per tenant before the loop via `this.resolvePurpose(tenantId, 'BIRTHDAY')` — not once per customer, which would be one taxonomy round-trip per row.
4. After each create, call `await this.recalculateRollup(this.db, tenantId, { customer_id })` and `await this.notifyAssignee(...)`.

Keep the `$queryRaw` birthday query, `REORDER_DORMANT_DAYS = 60`, the `EXTRACT`-based date matching and the existing `JOB_NAMES` constants exactly as they are — they carry hard-won reasoning documented in their comments.

Delete the two `@Cron` wrappers, their impls and `notifyOwner` from `crm-follow-ups.service.ts`, along with the now-unused `Cron`/`CronExpression`/`JobTrackerService` imports. Leave every read method intact — legacy endpoints still serve through R2.

- [ ] **Step 4: Run both suites**

Run: `npm test --workspace=apps/backend -- crm-activities crm-follow-ups`
Expected: PASS. Delete any follow-up cron test that now covers deleted code.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/crm-activities apps/backend/src/crm-follow-ups
git commit -m "feat(crm): move birthday and reorder crons onto CrmActivity"
```

---

## Task 8: Lifecycle — converting or losing a lead cancels its planned activities

**Files:**
- Modify: `apps/backend/src/crm-leads/crm-leads.service.ts` (`convert()` at 622-656; the status-change path in `update()` around 370-390)
- Test: `apps/backend/src/crm-leads/crm-leads.service.spec.ts`

**Interfaces:**
- Consumes: nothing from `CrmActivitiesService` — this writes `crmActivity.updateMany` directly to avoid a circular module import (`CrmActivitiesModule` would otherwise import `CrmLeadsModule` and vice versa).
- Produces: no new public API.

- [ ] **Step 1: Write the failing tests**

```typescript
    describe('convert() lifecycle', () => {
        it('cancels planned activities and clears the rollup', async () => {
            db.lead.findFirst.mockResolvedValue({ id: 'l1', status: 'QUALIFIED', mobile: '01700000000' });
            db.customer.findFirst.mockResolvedValue(null);
            customersService.create.mockResolvedValue({ id: 'c1' });
            db.lead.update.mockResolvedValue({ id: 'l1', status: 'CONVERTED' });

            await service.convert('t1', 'l1');

            expect(db.crmActivity.updateMany).toHaveBeenCalledWith({
                where: { tenant_id: 't1', lead_id: 'l1', status: 'PLANNED' },
                data: { status: 'CANCELLED' },
            });
            expect(db.lead.update).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({
                        status: 'CONVERTED',
                        next_step: null,
                        next_step_date: null,
                        next_step_assigned_to: null,
                        next_activity_id: null,
                    }),
                }),
            );
        });
    });
```

Add the mirror case for a lead transitioning to `LOST` through `update()`.

- [ ] **Step 2: Run to verify it fails**

Run: `npm test --workspace=apps/backend -- crm-leads -t lifecycle`
Expected: FAIL — `updateMany` never called.

- [ ] **Step 3: Implement**

In `convert()`, before the `lead.update`, add:

```typescript
        // A converted lead is done being worked. Leaving its planned activities
        // open kept them in the overdue count forever, while the create path
        // refused to add new ones — the two halves disagreed.
        await this.db.crmActivity.updateMany({
            where: { tenant_id: tenantId, lead_id: id, status: 'PLANNED' },
            data: { status: 'CANCELLED' },
        });
```

and extend the existing `data` object with the four null rollup fields shown in the test.

Apply the same two changes on the `LOST` transition in `update()`. Add `crmActivity: { updateMany: jest.fn() }` to the spec's `db` mock.

- [ ] **Step 4: Run to verify it passes**

Run: `npm test --workspace=apps/backend -- crm-leads`
Expected: PASS, including the pre-existing lead tests.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/crm-leads
git commit -m "fix(crm): cancel planned activities when a lead converts or is lost"
```

---

## Task 9: Close the old `next_step` write paths

**Files:**
- Modify: `apps/backend/src/crm-lead-conversations/crm-lead-conversations.dto.ts:44-55`
- Modify: `apps/backend/src/crm-lead-conversations/crm-lead-conversations.service.ts:125-147`
- Modify: `apps/backend/src/crm-leads/crm-leads.dto.ts` (drop `next_step*` from the update DTO; keep them on create — see below)
- Modify: `apps/backend/src/crm-leads/crm-leads.service.ts:78-82, 370-390, 505-520, 560-615`
- Test: both service specs

**Interfaces:**
- Consumes: `CrmActivitiesService.create` is **not** used here — to avoid the circular import, the CSV importer writes `crmActivity.create` directly with `origin: 'IMPORT'` and then nulls nothing (the rollup is recalculated by a direct `lead.update` in the same loop).
- Produces: no new API. After this task the only writers of `next_step*` are `CrmActivitiesService.recalculateRollup` and the CSV importer's inline equivalent.

- [ ] **Step 1: Write the failing tests**

```typescript
    it('ignores next_step on lead update', async () => {
        db.lead.findFirst.mockResolvedValue({ id: 'l1', status: 'NEW', next_step_date: null });
        db.lead.update.mockResolvedValue({ id: 'l1' });

        await service.update('t1', 'l1', { name: 'Karim', next_step: 'hand-typed' } as any);

        const data = db.lead.update.mock.calls[0][0].data;
        expect(data.next_step).toBeUndefined();
    });

    it('creates an activity rather than writing next_step on CSV import', async () => {
        // ...import a row carrying next_step / next_step_date...
        expect(db.crmActivity.create).toHaveBeenCalledWith(
            expect.objectContaining({ data: expect.objectContaining({ origin: 'IMPORT', status: 'PLANNED' }) }),
        );
    });
```

And in the conversations spec:

```typescript
    it('no longer writes next_step when logging a conversation', async () => {
        // ...existing create setup...
        await service.create('t1', 'u1', { lead_id: 'l1', type: 'CALL', summary: 's' } as any);
        const leadUpdate = db.lead.update.mock.calls[0][0].data;
        expect(leadUpdate.next_step).toBeUndefined();
        expect(leadUpdate.next_step_date).toBeUndefined();
        expect(leadUpdate.last_contacted_at).toBeInstanceOf(Date);
    });
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm test --workspace=apps/backend -- crm-leads crm-lead-conversations`
Expected: FAIL.

- [ ] **Step 3: Remove the write paths**

- Delete `next_step`, `next_step_date`, `next_step_assigned_to` from `CreateLeadConversationDto` and every reference in the conversations service's `leadUpdate` object. Keep `last_contacted_at` and the rescoring — those stay correct.
- Delete `next_step*` from the lead **update** DTO and from the `buildLeadData` branch at `crm-leads.service.ts:78-82`.
- **Keep them on lead create.** A lead filed with an opening next step is the common path, and there is no activity to attach to yet. Instead of writing the columns, `create()` creates a `PLANNED` activity after the lead insert and derives the rollup from it. Implement inline rather than by injecting `CrmActivitiesService` — that module imports nothing from `CrmLeadsModule` today and injecting it the other way would close a cycle:

```typescript
    /**
     * Inline rather than via CrmActivitiesService: injecting it here would close
     * an import cycle (CrmActivitiesModule -> CrmLeadsModule -> CrmActivitiesModule).
     * The rollup rule is duplicated in exactly these two places and nowhere else;
     * both are covered by tests that assert the same four columns.
     */
    private async seedOpeningActivity(
        tenantId: string,
        leadId: string,
        userId: string,
        opening: { next_step?: string; next_step_date?: Date | null; next_step_assigned_to?: string },
        origin: 'MANUAL' | 'IMPORT',
    ) {
        if (!opening.next_step) return;

        const activity = await this.db.crmActivity.create({
            data: {
                tenant_id: tenantId,
                lead_id: leadId,
                subject: opening.next_step,
                status: 'PLANNED',
                due_at: opening.next_step_date ?? null,
                assigned_to: opening.next_step_assigned_to ?? null,
                created_by: userId,
                origin,
            },
            select: { id: true },
        });

        await this.db.lead.update({
            where: { id: leadId },
            data: {
                next_step: opening.next_step,
                next_step_date: opening.next_step_date ?? null,
                next_step_assigned_to: opening.next_step_assigned_to ?? null,
                next_activity_id: activity.id,
            },
        });
    }
```

  Call it from `create()` with `origin: 'MANUAL'` after the `lead.create`, and drop the three `next_step*` keys from that `data` object.

- In the CSV importer (`crm-leads.service.ts:505-615`), replace the three `next_step*` column writes with a `seedOpeningActivity(..., 'IMPORT')` call per imported row.

- [ ] **Step 4: Run to verify they pass**

Run: `npm test --workspace=apps/backend -- crm-leads crm-lead-conversations`
Expected: PASS.

- [ ] **Step 5: Grep to prove the rollup has exactly one writer class**

```bash
grep -rn "next_step_date:\|next_step:" apps/backend/src --include="*.ts" | grep -v "\.spec\.ts" | grep -v "next_step_date: (dir)"
```

Expected: hits only in `crm-activities.service.ts` (the rollup), `crm-leads.service.ts` (create + CSV inline rollup, and the read-side sort map), and the lead-scoring input. No other file may assign them.

- [ ] **Step 6: Commit**

```bash
git add apps/backend/src/crm-leads apps/backend/src/crm-lead-conversations
git commit -m "refactor(crm): make next_step a rollup by closing its hand-written paths"
```

---

## Task 10: The backfill — `sync-crm-activities.ts`

**Files:**
- Create: `packages/database/prisma/sync-crm-activities.ts`
- Modify: `packages/database/package.json` (add the script)
- Modify: `apps/backend/Dockerfile:105` (add to the start chain)
- Test: `apps/backend/src/crm-activities/backfill.spec.ts`

**Interfaces:**
- Consumes: `CrmActivity.legacy_source` / `legacy_id` and the four seeded purpose codes.
- Produces: an idempotent `npm run sync:crm-activities --workspace=@erp71/database`.

- [ ] **Step 1: Write the failing tests**

Create `apps/backend/src/crm-activities/backfill.spec.ts` testing the pure mapping function the script exports, so the logic is covered without a live database:

```typescript
import { mapLegacyRow } from '../../../../packages/database/prisma/sync-crm-activities';

describe('mapLegacyRow()', () => {
    const purposes = { GENERAL: 'p-gen', COLLECTION: 'p-col', BIRTHDAY: 'p-bday', REORDER_REMINDER: 'p-reorder' };

    it('maps a lead conversation to a DONE activity', () => {
        const row = mapLegacyRow('LEAD_CONVERSATION', {
            id: 'lc1', tenant_id: 't1', lead_id: 'l1', channel_id: 'ch1', type: 'CALL',
            summary: 'Spoke to Karim', outcome: 'ok', direction: 'OUTBOUND',
            created_by: 'u1', created_at: new Date('2026-01-02'),
        }, purposes);

        expect(row).toMatchObject({
            legacy_source: 'LEAD_CONVERSATION', legacy_id: 'lc1',
            status: 'DONE', subject: null, summary: 'Spoke to Karim',
            completed_at: new Date('2026-01-02'), due_at: null,
            channel_id: 'ch1', channel_code: 'CALL', purpose_id: null,
        });
    });

    it('maps a pending follow-up to a PLANNED activity with its purpose', () => {
        const row = mapLegacyRow('CRM_FOLLOW_UP', {
            id: 'f1', tenant_id: 't1', customer_id: 'c1', type: 'COLLECTION',
            title: 'Chase invoice', due_at: new Date('2026-03-01'), status: 'PENDING',
            completed_at: null, notes: 'ring twice', assigned_to: 'u2', created_by: 'u1',
        }, purposes);

        expect(row).toMatchObject({
            status: 'PLANNED', subject: 'Chase invoice', purpose_id: 'p-col',
            due_at: new Date('2026-03-01'), completed_at: null, notes: 'ring twice',
        });
    });

    it('maps a completed follow-up to DONE', () => {
        const row = mapLegacyRow('CRM_FOLLOW_UP', {
            id: 'f2', tenant_id: 't1', customer_id: 'c1', type: 'GENERAL',
            title: 'Done thing', due_at: new Date('2026-03-01'), status: 'DONE',
            completed_at: new Date('2026-03-02'), assigned_to: null, created_by: 'u1',
        }, purposes);

        expect(row.status).toBe('DONE');
        expect(row.completed_at).toEqual(new Date('2026-03-02'));
    });

    it('maps a customer interaction by channel code', () => {
        const row = mapLegacyRow('CUSTOMER_INTERACTION', {
            id: 'ci1', tenant_id: 't1', customer_id: 'c1', type: 'WHATSAPP',
            summary: 'Sent catalogue', direction: 'OUTBOUND',
            created_by: 'u1', created_at: new Date('2026-02-02'),
        }, purposes, { WHATSAPP: 'ch-wa' });

        expect(row).toMatchObject({ channel_id: 'ch-wa', channel_code: 'WHATSAPP', status: 'DONE' });
    });

    it('leaves channel_id null when a legacy type matches no channel', () => {
        const row = mapLegacyRow('CUSTOMER_INTERACTION', {
            id: 'ci2', tenant_id: 't1', customer_id: 'c1', type: 'CARRIER_PIGEON',
            summary: 'x', created_by: 'u1', created_at: new Date(),
        }, purposes, {});

        expect(row.channel_id).toBeNull();
        expect(row.channel_code).toBe('CARRIER_PIGEON');
    });
});

describe('scoring is unchanged by the backfill', () => {
    // The spec's promise that no lead is rescored on migration day rests on one
    // arithmetic fact: every LeadConversation becomes exactly one DONE activity,
    // so the count feeding computeLeadScore is identical. Assert the mapping
    // preserves that 1:1 rather than trusting it.
    it('maps N conversations to exactly N DONE activities', () => {
        const purposes = { GENERAL: 'p-gen', COLLECTION: 'p-col', BIRTHDAY: 'p-b', REORDER_REMINDER: 'p-r' };
        const conversations = [
            { id: 'lc1', tenant_id: 't1', lead_id: 'l1', type: 'CALL', summary: 'a', created_at: new Date() },
            { id: 'lc2', tenant_id: 't1', lead_id: 'l1', type: 'CALL', summary: 'b', created_at: new Date() },
            { id: 'lc3', tenant_id: 't1', lead_id: 'l1', type: 'SMS', summary: 'c', created_at: new Date() },
        ];

        const mapped = conversations.map((c) => mapLegacyRow('LEAD_CONVERSATION', c, purposes));

        expect(mapped).toHaveLength(3);
        expect(mapped.every((m) => m.status === 'DONE')).toBe(true);
        expect(new Set(mapped.map((m) => m.legacy_id)).size).toBe(3);
    });
});

describe('shouldMaterialiseNextStep()', () => {
    const { shouldMaterialiseNextStep } = require('../../../../packages/database/prisma/sync-crm-activities');

    it('skips a lead with a planned activity already due that day', () => {
        expect(shouldMaterialiseNextStep(
            { status: 'NEW', next_step: 'Call', next_step_date: new Date('2026-04-01T09:00:00Z') },
            [{ due_at: new Date('2026-04-01T15:00:00Z') }],
        )).toBe(false);
    });

    it('materialises when the existing planned activity is a different day', () => {
        expect(shouldMaterialiseNextStep(
            { status: 'NEW', next_step: 'Call', next_step_date: new Date('2026-04-01T09:00:00Z') },
            [{ due_at: new Date('2026-04-05T09:00:00Z') }],
        )).toBe(true);
    });

    it('never materialises for a converted or lost lead', () => {
        expect(shouldMaterialiseNextStep(
            { status: 'CONVERTED', next_step: 'Call', next_step_date: new Date('2026-04-01') }, [],
        )).toBe(false);
        expect(shouldMaterialiseNextStep(
            { status: 'LOST', next_step: 'Call', next_step_date: new Date('2026-04-01') }, [],
        )).toBe(false);
    });

    it('skips a lead with no next_step text', () => {
        expect(shouldMaterialiseNextStep({ status: 'NEW', next_step: null, next_step_date: null }, [])).toBe(false);
    });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test --workspace=apps/backend -- backfill`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the two pure functions**

Create `packages/database/prisma/sync-crm-activities.ts` starting with the mapping logic — pure and exported so the test above covers it without a database:

```typescript
export type LegacySource =
    | 'LEAD_CONVERSATION'
    | 'CUSTOMER_INTERACTION'
    | 'CRM_FOLLOW_UP'
    | 'LEAD_NEXT_STEP';

/** Maps one legacy row to a CrmActivity create payload. See the mapping table in the spec. */
export function mapLegacyRow(
    source: LegacySource,
    row: any,
    purposes: Record<string, string>,
    channels: Record<string, string> = {},
) {
    const base = {
        tenant_id: row.tenant_id,
        store_id: row.store_id ?? null,
        lead_id: row.lead_id ?? null,
        customer_id: row.customer_id ?? null,
        created_by: row.created_by ?? null,
        assigned_to: row.assigned_to ?? null,
        origin: 'IMPORT',
        legacy_source: source,
        legacy_id: row.id,
    };

    if (source === 'LEAD_CONVERSATION' || source === 'CUSTOMER_INTERACTION') {
        // A logged touch has no separate title — subject stays null and the UI
        // renders `subject ?? summary`.
        return {
            ...base,
            subject: null,
            status: 'DONE',
            due_at: null,
            completed_at: row.created_at,
            summary: row.summary ?? null,
            outcome: row.outcome ?? null,
            notes: null,
            direction: row.direction ?? 'OUTBOUND',
            purpose_id: null,
            // LeadConversation already carries a resolved channel_id; the
            // customer side only has a type string, matched against the tenant's
            // channel codes. Unmatched leaves the FK null but keeps the code, so
            // nothing is silently lost and the residual is reportable.
            channel_id: row.channel_id ?? channels[row.type] ?? null,
            channel_code: row.type ?? null,
        };
    }

    if (source === 'CRM_FOLLOW_UP') {
        const done = row.status === 'DONE';
        return {
            ...base,
            subject: row.title,
            status: done ? 'DONE' : 'PLANNED',
            due_at: row.due_at,
            completed_at: done ? row.completed_at : null,
            summary: null,
            outcome: null,
            notes: row.notes ?? null,
            direction: 'OUTBOUND',
            purpose_id: purposes[row.type] ?? purposes.GENERAL ?? null,
            channel_id: null,
            channel_code: null,
        };
    }

    return {
        ...base,
        lead_id: row.id,
        customer_id: null,
        assigned_to: row.next_step_assigned_to ?? null,
        subject: row.next_step,
        status: 'PLANNED',
        due_at: row.next_step_date ?? null,
        completed_at: null,
        summary: null,
        outcome: null,
        notes: null,
        direction: 'OUTBOUND',
        purpose_id: purposes.GENERAL ?? null,
        channel_id: null,
        channel_code: null,
    };
}

const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

/**
 * `Lead.next_step` is very often a duplicate of a follow-up that already exists —
 * that duplication is the whole reason for this migration. Materialising it
 * anyway would manufacture a second copy of one task on day one.
 */
export function shouldMaterialiseNextStep(
    lead: { status: string; next_step: string | null; next_step_date: Date | null },
    plannedActivities: { due_at: Date | null }[],
) {
    if (!lead.next_step) return false;
    // A closed lead's next step is stale by definition; importing it would
    // recreate the stale-overdue bug this migration exists to fix.
    if (lead.status === 'CONVERTED' || lead.status === 'LOST') return false;
    if (!lead.next_step_date) return plannedActivities.length === 0;
    return !plannedActivities.some((a) => a.due_at && sameDay(a.due_at, lead.next_step_date!));
}
```

- [ ] **Step 4: Write the `main()` driver**

Below those, a `main()` that per tenant:

1. Loads the tenant's purpose codes → ids and channel codes → ids into two `Map`s. One query each, not one per row — the importer handles up to five figures of rows.
2. Streams `LeadConversation`, `CustomerInteraction` and `CrmFollowUp` in batches of 500, maps each through `mapLegacyRow`, and writes with `createMany({ data, skipDuplicates: true })`. `skipDuplicates` plus `@@unique([tenant_id, legacy_source, legacy_id])` is what makes re-running a no-op.
3. For each open lead with a non-null `next_step`, applies `shouldMaterialiseNextStep` against that lead's already-backfilled `PLANNED` activities and creates one with `legacy_source: 'LEAD_NEXT_STEP'`, `legacy_id: lead.id`.
4. Recalculates every touched parent's rollup with the same earliest-planned rule the service uses.
5. Logs a summary line per tenant: rows created per source, `next_step` rows skipped as same-day duplicates, and any row whose channel code did not resolve.

Two rules the script must follow, both carried from `sync-lead-taxonomy.ts`:

```typescript
// Guard on information_schema rather than assuming the legacy tables exist, so
// this degrades to a no-op after R3 drops them instead of erroring.
const hasLegacy = await prisma.$queryRaw<{ count: bigint }[]>`
    SELECT count(*) FROM information_schema.tables
    WHERE table_name IN ('LeadConversation', 'CustomerInteraction', 'CrmFollowUp')`;
if (Number(hasLegacy[0].count) === 0) { console.log('legacy CRM tables absent — nothing to backfill'); return; }
```

```typescript
// Warn, never exit non-zero. This runs in an && chain ahead of `node main.js`
// in the container CMD, where a non-zero exit is a full outage rather than a
// failed script.
process.exitCode = 0;
```

- [ ] **Step 5: Run to verify the tests pass**

Run: `npm test --workspace=apps/backend -- backfill`
Expected: PASS.

- [ ] **Step 6: Wire it into the start chain**

`packages/database/package.json`:

```json
"sync:crm-activities": "tsx prisma/sync-crm-activities.ts"
```

Match the runner (`tsx` / `ts-node`) used by the neighbouring `sync:lead-taxonomy` script rather than assuming.

`apps/backend/Dockerfile:105` — insert **after** `sync:lead-taxonomy` (it needs the purposes seeded) and before `sync:role-permissions`:

```sh
&& npm run sync:crm-activities --workspace=@erp71/database
```

- [ ] **Step 7: Verify idempotency for real**

Against a local database with CRM data:

```bash
npm run sync:crm-activities --workspace=@erp71/database
psql "$DATABASE_URL" -c 'SELECT count(*) FROM "CrmActivity";'
npm run sync:crm-activities --workspace=@erp71/database
psql "$DATABASE_URL" -c 'SELECT count(*) FROM "CrmActivity";'
```

Expected: identical counts. If the local database is the known-drifted one on port 5434, note that in the commit message and treat this as unverified rather than claiming it passed.

- [ ] **Step 8: Full suite, build, and commit**

```bash
npm test --workspace=apps/backend
npm run build --workspace=apps/backend
```

Expected: all suites green except the 4 known `test/*.spec.ts` integration suites that need a live Postgres; build clean.

```bash
git add packages/database/prisma/sync-crm-activities.ts packages/database/package.json apps/backend/Dockerfile apps/backend/src/crm-activities/backfill.spec.ts
git commit -m "feat(crm): backfill legacy CRM rows into CrmActivity on container start

Idempotent via @@unique([tenant_id, legacy_source, legacy_id]) + skipDuplicates.
Skips next_step rows that duplicate a same-day planned activity, and never
materialises one for a converted or lost lead."
```

---

## Verification before calling R1 done

- [ ] `npm test --workspace=apps/backend` — green except the 4 known integration suites
- [ ] `npm run build --workspace=apps/backend` — clean
- [ ] `npx prisma validate` in `packages/database` — clean
- [ ] The additive-only diff check from Task 1 Step 4 re-run against final `main` — zero `DROP`, zero `ALTER COLUMN`
- [ ] The grep from Task 9 Step 5 — no unexpected `next_step` writer
- [ ] Backfill run twice against a real dump — identical row counts

**Explicitly not done in R1, and not a defect:** no frontend change (R2), no legacy table or endpoint removed (R3), and the backfill has not run against production data. A restore-a-prod-dump rehearsal is the honest gate before this deploys — the schema edit and the sync script are the load-bearing halves and both are exercised only by tests until then.

---

## Follow-on plans

- **R2 — cutover:** `CrmActivityPanel`, `/crm/activities` page + redirect, dashboard cards onto the new summary endpoint, CRM Settings purposes tab, en/bn/ms copy.
- **R3 — contract:** gated on legacy counts matching and seven days of no legacy writes. Drops `LeadConversation`, `CustomerInteraction`, `CrmFollowUp`, the `legacy_*` columns and the three legacy modules.
