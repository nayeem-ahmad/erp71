# Story 31.2: Sales and Sales-Return Automatic Voucher Posting

Status: in-progress

## Story

As a Shop Owner,
I want completed sales and approved sales returns to post vouchers automatically,
so that accounting records are always synchronized with POS and return activity.

## Acceptance Criteria

1. Completing a sale triggers voucher creation using posting rules configured for sale events. [x]
2. Creating or approving a sales return triggers voucher creation using posting rules configured for return events. [x]
3. Voucher creation is atomic with sales or return finalization (no partial commit where one succeeds and the other fails). [x]
4. Auto-created vouchers store source trace metadata (`source_module`, `source_type`, `source_id`) and are discoverable from sales and returns details. [x]
5. Duplicate voucher prevention exists for retries and idempotent request replay. [x]
6. Tests cover cash and credit sale paths, sales-return paths, mapping-missing errors, and idempotent retries. [ ]

## Tasks / Subtasks

- [x] Task 1: Sales posting integration
  - [x] Extend sale finalization flow to resolve posting rule and call accounting posting helper.
  - [x] Support payment-context-aware rule selection where required (cash vs bank vs receivable).
  - [x] Persist source trace linkage from sale to voucher.
  - [ ] Likely file targets: `apps/backend/src/sales/sales.service.ts`, `apps/backend/src/sales/sales.dto.ts`, `apps/backend/src/accounting/accounting.service.ts`

- [x] Task 2: Sales-return posting integration
  - [x] Add return posting path that reverses or creates return-specific voucher entries based on configured rules.
  - [x] Ensure refund mode aligns with mapped account sides.
  - [x] Persist source trace linkage from return to voucher.
  - [ ] Likely file targets: `apps/backend/src/sales-returns/sales-returns.service.ts`, `apps/backend/src/sales-returns/sales-return.dto.ts`, `apps/backend/src/accounting/accounting.service.ts`

- [ ] Task 3: API and UI visibility
  - [ ] Expose voucher references in sales and sales-return list/detail responses.
  - [ ] Show linked voucher badge/action in relevant frontend screens.
  - [ ] Likely file targets: `packages/shared-types/index.ts`, `apps/frontend/src/app/dashboard/sales/page.tsx`, `apps/frontend/src/app/dashboard/returns/page.tsx`, `apps/frontend/src/lib/api.ts`

- [ ] Task 4: Tests
  - [x] Add unit and integration tests for auto-posting and rollback behavior.
  - [x] Add API-level tests for linked voucher visibility in responses.
  - [ ] Likely file targets: `apps/backend/src/sales/sales.service.spec.ts`, `apps/backend/src/sales-returns/sales-returns.service.spec.ts`, `apps/backend/test/integration.spec.ts`

## Dev Notes

- Use a reusable posting adapter instead of direct voucher writes in sales services to keep cross-module behavior consistent.
- Prefer deterministic idempotency keys based on source transaction identity.

## Executable Contract

### Posting Contract

- Source events:
  - Sale finalized event from sales transaction path.
  - Sales return approved/posted event from returns path.
- Rule resolution priority:
  1. Exact `event_type + condition` match (payment/refund mode).
  2. Fallback `event_type` default mapping.
- Idempotency key format: `tenantId:eventType:sourceId`.

### Exact Event Mapping

- Sale posting events: `sale_finalized + payment_mode=cash`, `sale_finalized + payment_mode=bank`, `sale_finalized + payment_mode=credit`.
- Sales-return posting events: `sale_return_posted + refund_mode=cash`, `sale_return_posted + refund_mode=bank`, `sale_return_posted + refund_mode=store_credit`.

Rule fallback:

- Event + condition exact match.
- Event default rule (`condition_key=none`).
- Fail with business error `POSTING_RULE_NOT_CONFIGURED`.

### Data Link Contract

- Add source trace attributes on vouchers (or voucher metadata):
  - `source_module = sales`
  - `source_type in (sale, sale_return)`
  - `source_id = sale.id or salesReturn.id`
- Add outward references in sale/return responses:
  - `voucher_id`
  - `voucher_number`

Suggested voucher metadata payload:

```json
{
  "source_module": "sales",
  "source_type": "sale",
  "source_id": "sale_01HY...",
  "idempotency_key": "tenant_01:sale:sale_01HY..."
}
```

### API/Response Contract

- `GET /sales` and `GET /sales/:id` include voucher reference fields.
- `GET /sales-returns` and `GET /sales-returns/:id` include voucher reference fields.
- Repeated finalize/retry request returns same linked voucher identity.

Response shape extension (sale/sales-return detail):

```json
{
  "id": "sale_01HY...",
  "serial_number": "S-000123",
  "posting_status": "posted",
  "voucher": {
    "id": "vch_01HY...",
    "voucher_number": "CR-00045",
    "voucher_type": "cash_receive"
  }
}
```

Error contract:

- `POSTING_RULE_NOT_CONFIGURED` -> 422.
- `AUTO_POSTING_IDEMPOTENCY_CONFLICT` -> 409.
- `AUTO_POSTING_ACCOUNT_INVALID` -> 422.
- `AUTO_POSTING_ATOMICITY_FAILURE` -> 500 with rollback guarantee.

### Validation Rules

- Sale must be persisted and not already cancelled before posting.
- Sales-return quantity/value validations must pass before posting.
- Rule-resolved accounts must be tenant-owned and active at posting time.
- A source transaction can own at most one successful voucher link.

### Execution Order

1. Add source-trace and idempotency support in accounting posting helper.
2. Integrate sales finalize flow with posting helper.
3. Integrate sales-return finalize flow with posting helper.
4. Expose voucher references in API DTOs and frontend table/detail views.
5. Add rollback and duplicate-prevention tests.

### Test Plan

- Backend focused: `cd apps/backend && npm test -- --runTestsByPath src/sales/sales.service.spec.ts src/sales-returns/sales-returns.service.spec.ts test/integration.spec.ts`
- Frontend focused: `cd apps/frontend && npm test -- --runTestsByPath src/app/dashboard/sales/page.test.tsx src/app/dashboard/returns/page.test.tsx`

### Definition of Done

1. Sales and sales returns auto-create vouchers from configured mappings.
2. Posting and source transaction are atomic.
3. Duplicate requests do not create duplicate vouchers.
4. Voucher references are visible in sales and returns APIs/UI.

### Seed Mapping Baseline for This Story

- `sale + cash` => Dr Cash in Hand / Cr Sales Revenue.
- `sale + bank` => Dr Main Bank Account / Cr Sales Revenue.
- `sale_return + cash` => Dr Sales Revenue / Cr Cash in Hand.
- `sale_return + bank` => Dr Sales Revenue / Cr Main Bank Account.

Follow-up note:

- Credit-sale and store-credit return mappings depend on receivable/liability account maturity and can ship as disabled defaults initially.


## Dependencies

- Depends on Story 31.1 and Story 10.3.
- Supports Story 34.x KPI/report accuracy.

### References

- [Source: docs/prd/epic-31-automated-accounting-integration-posting-rules.md]
- [Source: docs/prd/epic-10-core-sales-pos.md]
- [Source: docs/prd/epic-11-sales-returns-management.md]
