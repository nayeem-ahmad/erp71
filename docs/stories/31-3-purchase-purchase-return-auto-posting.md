# Story 31.3: Purchase and Purchase-Return Automatic Voucher Posting

Status: in-progress

## Story

As a Shop Owner,
I want posted purchases and purchase returns to create vouchers automatically,
so that payables, cash/bank movement, and inventory-related financial records stay synchronized.

## Acceptance Criteria

1. Creating a purchase posts a voucher using configured purchase posting rules (for example cash purchase vs payable purchase). [x]
2. Creating or approving a purchase return posts a voucher using configured purchase-return posting rules. [x]
3. Purchase and purchase-return posting is atomic with transaction persistence and inventory movement updates. [x]
4. Auto-created vouchers include source trace metadata linking to purchase or purchase-return records. [x]
5. Duplicate posting is prevented for retries and concurrent duplicate requests. [x]
6. Tests cover cash purchase, payable purchase, return scenarios, rule misconfiguration, and rollback on voucher failure. [ ]

## Tasks / Subtasks

- [x] Task 1: Purchase posting integration
  - [x] Wire purchase service finalization to posting-rule resolution and accounting posting helper.
  - [x] Support conditional mapping based on settlement mode (cash/bank/payable).
  - [x] Save source linkage fields for downstream reconciliation.
  - [ ] Likely file targets: `apps/backend/src/purchases/purchases.service.ts`, `apps/backend/src/purchases/purchase.dto.ts`, `apps/backend/src/accounting/accounting.service.ts`

- [x] Task 2: Purchase-return posting integration
  - [x] Integrate purchase return workflow with return posting rules.
  - [x] Ensure accounting direction aligns with supplier credit/debit semantics.
  - [x] Save source linkage fields for downstream reconciliation.
  - [ ] Likely file targets: `apps/backend/src/purchase-returns/purchase-returns.service.ts`, `apps/backend/src/purchase-returns/purchase-return.dto.ts`, `apps/backend/src/accounting/accounting.service.ts`

- [ ] Task 3: Response contract and UI linkage
  - [ ] Add voucher reference fields to purchase and purchase-return payloads.
  - [ ] Surface voucher links from purchase and return detail screens.
  - [ ] Likely file targets: `packages/shared-types/index.ts`, `apps/frontend/src/app/dashboard/purchases/page.tsx`, `apps/frontend/src/app/dashboard/purchase-returns/page.tsx`

- [ ] Task 4: Tests
  - [x] Add unit/integration tests for posting behavior, idempotency, and rollback.
  - [x] Add API contract checks for voucher references.
  - [ ] Likely file targets: `apps/backend/src/purchases/purchases.service.spec.ts`, `apps/backend/src/purchase-returns/purchase-returns.service.spec.ts`, `apps/backend/test/integration.spec.ts`

## Dev Notes

- Keep posting logic centralized in accounting integration helpers to avoid drift between sales and purchase modules.
- Ensure supplier-centric entries can be extended later for multi-currency or due-date aging reports.

## Executable Contract

### Posting Contract

- Source events:
  - Purchase posted/created event.
  - Purchase return posted/approved event.
- Conditional mapping dimension: settlement mode (`cash`, `bank`, `payable`, `supplier_credit`).
- Idempotency key format: `tenantId:eventType:sourceId`.

### Exact Event Mapping

- Purchase posting events: `purchase_posted + payment_mode=cash`, `purchase_posted + payment_mode=bank`, `purchase_posted + payment_mode=credit`.
- Purchase-return posting events: `purchase_return_posted + settlement_mode=cash`, `purchase_return_posted + settlement_mode=bank`, `purchase_return_posted + settlement_mode=supplier_credit`.
- Rule fallback order: exact condition match, then event default rule, then fail with `POSTING_RULE_NOT_CONFIGURED`.

### Data Link Contract

- Voucher source trace values:
  - `source_module = purchases`
  - `source_type in (purchase, purchase_return)`
  - `source_id = purchase.id or purchaseReturn.id`
- Purchase and return payloads expose `voucher_id` and `voucher_number`.

Suggested voucher metadata payload:

```json
{
  "source_module": "purchases",
  "source_type": "purchase",
  "source_id": "pur_01HY...",
  "idempotency_key": "tenant_01:purchase:pur_01HY..."
}
```

### API/Response Contract

- `GET /purchases`, `GET /purchases/:id` include voucher reference data.
- `GET /purchase-returns`, `GET /purchase-returns/:id` include voucher reference data.
- Duplicate/replayed submit returns existing voucher linkage and no duplicate posting.

Response shape extension (purchase/purchase-return detail):

```json
{
  "id": "pur_01HY...",
  "reference_number": "P-000321",
  "posting_status": "posted",
  "voucher": {
    "id": "vch_01HY...",
    "voucher_number": "BP-00072",
    "voucher_type": "bank_payment"
  }
}
```

Error contract:

- `POSTING_RULE_NOT_CONFIGURED` -> 422.
- `AUTO_POSTING_IDEMPOTENCY_CONFLICT` -> 409.
- `AUTO_POSTING_ACCOUNT_INVALID` -> 422.
- `AUTO_POSTING_ATOMICITY_FAILURE` -> 500 with rollback guarantee.

### Validation Rules

- Purchase or return transaction must be in postable state before voucher creation.
- Rule-resolved accounts must be tenant-owned and active at posting time.
- A source transaction can own at most one successful voucher link.
- Rule condition must align with request settlement mode.

### Execution Order

1. Extend accounting posting helper for purchase and purchase-return event types.
2. Integrate purchase transaction workflow with posting helper.
3. Integrate purchase-return workflow with posting helper.
4. Add response contract fields and frontend linkage.
5. Add rollback, misconfiguration, and idempotency tests.

### Test Plan

- Backend focused: `cd apps/backend && npm test -- --runTestsByPath src/purchases/purchases.service.spec.ts src/purchase-returns/purchase-returns.service.spec.ts test/integration.spec.ts`
- Frontend focused: `cd apps/frontend && npm test -- --runTestsByPath src/app/dashboard/purchases/page.test.tsx src/app/dashboard/purchase-returns/page.test.tsx`

### Definition of Done

1. Purchases and purchase returns auto-create vouchers from configured mappings.
2. Posting is atomic with purchase-side persistence and inventory effects.
3. Duplicate requests do not produce duplicate vouchers.
4. Voucher references are visible in purchase and purchase-return APIs/UI.

### Seed Mapping Baseline for This Story

- `purchase + cash` => Dr General Operating Expense (temporary) / Cr Cash in Hand.
- `purchase + bank` => Dr General Operating Expense (temporary) / Cr Main Bank Account.
- `purchase + credit` => Dr General Operating Expense (temporary) / Cr Purchase Payable.
- `purchase_return + supplier_credit` => Dr Purchase Payable / Cr General Operating Expense (temporary).

Follow-up note:

- Replace temporary purchase-side expense mappings with dedicated inventory/cogs accounts when those accounts are introduced.

## Dependencies

- Depends on Story 31.1, Story 20.3, and Story 21.x foundation.
- Supports payable accuracy for Story 34.2 metrics.

### References

- [Source: docs/prd/epic-31-automated-accounting-integration-posting-rules.md]
- [Source: docs/prd/epic-20-core-purchase-transactions.md]
- [Source: docs/prd/epic-21-purchase-returns-management.md]
