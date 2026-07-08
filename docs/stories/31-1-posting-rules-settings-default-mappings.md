# Story 31.1: Posting Rules Settings and Default Mapping Seed

Status: in-progress

## Story

As a Shop Owner or Accountant,
I want tenant-scoped posting rules with sensible defaults,
so that operational transactions can generate vouchers automatically without manual account selection.

## Acceptance Criteria

1. A tenant-scoped posting rule model exists for supported event types: sale, sale return, purchase, purchase return, inventory adjustment, and fund movement. [x]
2. Each posting rule supports required debit and credit account mapping fields and optional conditional dimensions such as payment mode or adjustment reason type. [x]
3. Seed/bootstrap logic initializes default posting rules for new tenants using accounts created by the accounting bootstrap template. [x]
4. A settings API exists to list and update posting rules under an accounting settings namespace. [x]
5. Posting-rule updates are restricted to authorized roles (for example OWNER and ACCOUNTANT). [x]
6. Tests cover seed defaults, RBAC enforcement, and invalid mapping validation (cross-tenant account, inactive account, missing side). [ ]

## Tasks / Subtasks

- [x] Task 1: Data model and bootstrap
  - [x] Add a posting rules model with event type, debit account, credit account, optional condition metadata, and active flag.
  - [x] Add indexes and uniqueness that prevent duplicate active rules for the same tenant/event/condition combination.
  - [x] Extend tenant provisioning/bootstrap flow to seed default posting rules from default accounting accounts.
  - [ ] Likely file targets: `packages/database/prisma/schema.prisma`, `packages/database/prisma/bootstrap-accounting.ts`, `packages/database/prisma/seed.ts`

- [x] Task 2: Backend settings API
  - [x] Add list and update endpoints for posting rules under accounting settings routes.
  - [x] Validate mapped accounts belong to tenant and remain active.
  - [x] Apply role guard enforcement for configuration changes.
  - [ ] Likely file targets: `apps/backend/src/accounting/accounting.controller.ts`, `apps/backend/src/accounting/accounting.service.ts`, `apps/backend/src/accounting/accounting.dto.ts`, `apps/backend/src/auth/tenant-role.guard.ts`

- [ ] Task 3: Settings UI foundation
  - [ ] Add an accounting settings page section to view and edit posting-rule mappings.
  - [ ] Load account options from COA endpoints and block save on invalid combinations.
  - [ ] Likely file targets: `apps/frontend/src/app/dashboard/accounting/settings/page.tsx`, `apps/frontend/src/lib/api.ts`

- [ ] Task 4: Tests
  - [x] Add backend tests for seed behavior, validation, and RBAC.
  - [ ] Add frontend tests for loading/editing/saving posting rules.
  - [ ] Likely file targets: `apps/backend/src/accounting/accounting.service.spec.ts`, `apps/backend/src/accounting/accounting.controller.spec.ts`, `apps/frontend/src/app/dashboard/accounting/settings/page.test.tsx`

## Dev Notes

- Prefer explicit, event-oriented mapping keys over account-name matching so tenant custom COA naming remains safe.
- Keep posting rules version-friendly; future stories may require effective-date or branch/store-level overrides.

## Executable Contract

### Data Contract

- Introduce `PostingRuleEventType` enum with values: `sale`, `sale_return`, `purchase`, `purchase_return`, `inventory_adjustment`, `fund_movement`.
- Add posting-rules table/model with at minimum:
  - `id`, `tenant_id`, `event_type`, `condition_key`, `condition_value`, `debit_account_id`, `credit_account_id`, `is_active`, `created_at`, `updated_at`.
- Enforce uniqueness for active mappings per tenant/event/condition combination.

### Exact Schema Definition

```prisma
enum PostingRuleEventType {
  sale
  sale_return
  purchase
  purchase_return
  inventory_adjustment
  fund_movement
}

enum PostingRuleConditionKey {
  payment_mode
  reason_type
  transfer_scope
  none
}

model PostingRule {
  id               String                  @id @default(cuid())
  tenant_id        String
  event_type       PostingRuleEventType
  condition_key    PostingRuleConditionKey @default(none)
  condition_value  String?                 // e.g. cash|bank|credit or DAMAGE|THEFT
  debit_account_id String
  credit_account_id String
  priority         Int                     @default(100)
  is_active        Boolean                 @default(true)
  created_at       DateTime                @default(now())
  updated_at       DateTime                @updatedAt

  tenant        Tenant  @relation(fields: [tenant_id], references: [id], onDelete: Cascade)
  debitAccount  Account @relation("PostingRuleDebitAccount", fields: [debit_account_id], references: [id], onDelete: Restrict)
  creditAccount Account @relation("PostingRuleCreditAccount", fields: [credit_account_id], references: [id], onDelete: Restrict)

  @@index([tenant_id, event_type, is_active])
  @@index([tenant_id, condition_key, condition_value])
  @@index([tenant_id, debit_account_id])
  @@index([tenant_id, credit_account_id])
  @@map("posting_rules")
}
```

Implementation note for uniqueness:

- Use a partial unique index in SQL migration for active records:
  - `UNIQUE (tenant_id, event_type, condition_key, coalesce(condition_value, '')) WHERE is_active = true`
- Prisma cannot express partial unique indexes directly; keep this constraint in migration SQL.

### Validation Rules

1. `debit_account_id` and `credit_account_id` must be different.
2. Both mapped accounts must belong to the same `tenant_id` as the rule.
3. Both mapped accounts must be active/non-archived.
4. `condition_value` is required when `condition_key != none`.
5. `condition_value` must be null when `condition_key = none`.
6. If multiple candidate rules match during posting, lowest `priority` wins; ties resolve by latest `updated_at`.

### API Contract

- `GET /accounting/settings/posting-rules`
  - Query filters: `eventType`, `isActive`.
  - Response: grouped by `eventType` with account references and condition metadata.
- `PATCH /accounting/settings/posting-rules/:id`
  - Body: `debitAccountId`, `creditAccountId`, `isActive`, optional condition fields.
  - Validation: accounts must belong to tenant and be active.
- Authorization: list for `OWNER|MANAGER|ACCOUNTANT`, update for `OWNER|ACCOUNTANT`.

### DTO Contracts and Payload Examples

Request DTOs:

```ts
export class ListPostingRulesQueryDto {
  @IsOptional()
  @IsIn(["sale", "sale_return", "purchase", "purchase_return", "inventory_adjustment", "fund_movement"])
  eventType?: string;

  @IsOptional()
  @Transform(({ value }) => value === "true")
  @IsBoolean()
  isActive?: boolean;
}

export class UpdatePostingRuleDto {
  @IsUUID()
  debitAccountId!: string;

  @IsUUID()
  creditAccountId!: string;

  @IsIn(["payment_mode", "reason_type", "transfer_scope", "none"])
  conditionKey!: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  conditionValue?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1000)
  priority?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
```

`GET /accounting/settings/posting-rules?eventType=sale&isActive=true` example response:

```json
{
  "data": [
    {
      "id": "pr_01hzyz6r2d8d4m7pt5m6f8wq7x",
      "eventType": "sale",
      "conditionKey": "payment_mode",
      "conditionValue": "cash",
      "priority": 10,
      "isActive": true,
      "debitAccount": { "id": "acc_cash", "name": "Cash in Hand", "code": "1010" },
      "creditAccount": { "id": "acc_sales", "name": "Sales Revenue", "code": "4010" },
      "updatedAt": "2026-03-22T10:30:00.000Z"
    }
  ]
}
```

`PATCH /accounting/settings/posting-rules/:id` example request:

```json
{
  "debitAccountId": "acc_bank",
  "creditAccountId": "acc_sales",
  "conditionKey": "payment_mode",
  "conditionValue": "bank",
  "priority": 20,
  "isActive": true
}
```

`PATCH /accounting/settings/posting-rules/:id` example response:

```json
{
  "id": "pr_01hzyz6r2d8d4m7pt5m6f8wq7x",
  "eventType": "sale",
  "conditionKey": "payment_mode",
  "conditionValue": "bank",
  "priority": 20,
  "isActive": true,
  "debitAccountId": "acc_bank",
  "creditAccountId": "acc_sales",
  "updatedAt": "2026-03-22T11:15:00.000Z"
}
```

### Default Seed Mapping Matrix

Map using accounts from bootstrap template in `bootstrap-accounting.ts`:

1. `sale` + `payment_mode=cash` => Dr `Cash in Hand` / Cr `Sales Revenue`
2. `sale` + `payment_mode=bank` => Dr `Main Bank Account` / Cr `Sales Revenue`
3. `purchase` + `payment_mode=credit` => Dr `General Operating Expense` (temporary until inventory-cost account exists) / Cr `Purchase Payable`
4. `purchase` + `payment_mode=cash` => Dr `General Operating Expense` (temporary) / Cr `Cash in Hand`
5. `purchase_return` + `none` => Dr `Purchase Payable` / Cr `General Operating Expense` (temporary)
6. `sale_return` + `payment_mode=cash` => Dr `Sales Revenue` / Cr `Cash in Hand`

Follow-up note:

- Story 31.3 should replace temporary purchase-side debit/credit defaults with inventory/cogs-specific accounts when those accounts are introduced.

### Execution Order

1. Add schema and migration.
2. Implement bootstrap seed mapping from default accounts.
3. Add DTO + controller + service for list/update APIs.
4. Add role guards and validation.
5. Add frontend settings screen wiring.
6. Add unit and integration tests.

### Test Plan

- Backend focused: `cd apps/backend && npm test -- --runTestsByPath src/accounting/accounting.service.spec.ts src/accounting/accounting.controller.spec.ts test/integration.spec.ts`
- Frontend focused: `cd apps/frontend && npm test -- --runTestsByPath src/app/dashboard/accounting/settings/page.test.tsx`

### Definition of Done

1. New tenants receive seeded posting rules without manual action.
2. Posting-rule settings can be viewed and updated by authorized roles.
3. Cross-tenant and inactive-account mappings are rejected.
4. Focused tests pass for backend and frontend contracts.

## Dependencies

- Depends on Stories 30.2 and 30.4.
- Blocks Stories 31.2, 31.3, and 31.4.

### References

- [Source: docs/prd/epic-31-automated-accounting-integration-posting-rules.md]
- [Source: docs/prd/epic-30-financial-ledgers-accounting.md]
