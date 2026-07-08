# Story 31.4: Inventory and Transfer Accounting Event Posting

Status: in-progress

## Story

As a Shop Owner or Manager,
I want configured inventory and transfer events to post accounting vouchers automatically,
so that stock corrections and internal movements remain financially auditable.

## Acceptance Criteria

1. Approved stock adjustments (shrinkage/discrepancy) can generate accounting vouchers when posting rules are enabled for the event. [x]
2. Warehouse transfer financial events generate accounting entries when configured (including inter-store transfer contexts where applicable). [x]
3. Inventory posting respects reason/type-specific mapping when configured (for example damage vs loss). [x]
4. Inventory posting remains atomic with stock movement finalization and inventory movement records. [x]
5. Auto-created vouchers include source trace metadata linking back to stock-take, shrinkage, or transfer records. [x]
6. Tests cover enabled/disabled rule behavior, reason-aware mapping, and rollback on accounting failure. [ ]

## Tasks / Subtasks

- [x] Task 1: Inventory adjustment posting integration
  - [x] Integrate shrinkage/discrepancy posting flow with rule resolution and voucher creation helper.
  - [x] Support optional reason-type condition matching for account mapping.
  - [x] Persist source linkage for reporting and reconciliation.
  - [ ] Likely file targets: `apps/backend/src/inventory-shrinkage/inventory-shrinkage.service.ts`, `apps/backend/src/stock-takes/stock-takes.service.ts`, `apps/backend/src/accounting/accounting.service.ts`

- [x] Task 2: Transfer posting integration
  - [x] Integrate transfer completion flow with configured accounting event posting.
  - [x] Preserve traceability across source and destination contexts for transfer accounting.
  - [ ] Likely file targets: `apps/backend/src/warehouse-transfers/warehouse-transfers.service.ts`, `apps/backend/src/accounting/accounting.service.ts`

- [ ] Task 3: API/UI linkage
  - [ ] Expose voucher references in inventory and transfer detail payloads.
  - [ ] Show accounting status and linked voucher actions in inventory/transfer detail pages.
  - [ ] Likely file targets: `packages/shared-types/index.ts`, `apps/frontend/src/app/dashboard/inventory/**`, `apps/frontend/src/app/dashboard/transfers/**`

- [ ] Task 4: Tests
  - [x] Add focused tests for adjustment and transfer posting paths with and without active mappings.
  - [x] Add regression tests for atomic behavior and no-duplicate posting.
  - [ ] Likely file targets: `apps/backend/src/stock-takes/stock-takes.service.spec.ts`, `apps/backend/src/inventory-shrinkage/inventory-shrinkage.service.spec.ts`, `apps/backend/src/warehouse-transfers/warehouse-transfers.service.spec.ts`

## Dev Notes

- Keep inventory accounting optional by event type so operational posting can roll out incrementally.
- Reuse the same source-trace schema used in Stories 31.2 and 31.3.

## Executable Contract

### Posting Contract

- Source events:
  - Stock-take discrepancy approval/posting.
  - Shrinkage posting.
  - Warehouse transfer completion (where financial impact is enabled).
- Condition matching:
  - `event_type` default rule.
  - Optional reason-type rule override for inventory adjustments.
- Idempotency key format: `tenantId:eventType:sourceId`.

### Exact Event Mapping

- Inventory adjustment events: `shrinkage_posted`, `stock_take_adjustment_posted`.
- Transfer events: `warehouse_transfer_completed`, `inter_store_transfer_completed`.
- Optional condition examples: `reason_type=DAMAGE|THEFT|EXPIRATION`, `transfer_scope=intra_store|inter_store`.
- Rule fallback order: exact condition match, then event default rule, then `posting_status=skipped` when no active rule exists.

### Data Link Contract

- Voucher trace fields:
  - `source_module in (inventory, warehouse_transfers)`
  - `source_type in (stock_take_adjustment, shrinkage, transfer)`
  - `source_id = originating transaction id`
- Inventory/transfer detail responses expose `voucher_id` and `voucher_number` where posting exists.

Suggested voucher metadata payload:

```json
{
  "source_module": "inventory",
  "source_type": "stock_take_adjustment",
  "source_id": "stk_01HY...",
  "idempotency_key": "tenant_01:inventory_adjustment:stk_01HY..."
}
```

### API/Response Contract

- Inventory posting endpoints return posting status and voucher references.
- Transfer detail endpoint includes accounting-link status and voucher references.
- Disabled rule behavior returns success for operational flow with explicit `posting_status = skipped`.

Response shape extension (inventory/transfer detail):

```json
{
  "id": "stk_01HY...",
  "status": "posted",
  "posting_status": "posted",
  "voucher": {
    "id": "vch_01HY...",
    "voucher_number": "JV-00102",
    "voucher_type": "journal"
  }
}
```

Error contract:

- `AUTO_POSTING_ACCOUNT_INVALID` -> 422.
- `AUTO_POSTING_IDEMPOTENCY_CONFLICT` -> 409.
- `AUTO_POSTING_ATOMICITY_FAILURE` -> 500 with rollback guarantee.

### Validation Rules

- Posting trigger must run only after source inventory validation passes.
- Rule-resolved accounts must be tenant-owned and active at posting time.
- A source transaction can own at most one successful voucher link.
- For skipped posting, operational transaction success must still be returned with explicit status.

### Execution Order

1. Extend posting helper for inventory and transfer event families.
2. Integrate stock-take and shrinkage posting hooks.
3. Integrate transfer completion posting hook.
4. Add API response fields and frontend status badges/actions.
5. Add enabled/disabled mapping tests and rollback tests.

### Test Plan

- Backend focused: `cd apps/backend && npm test -- --runTestsByPath src/stock-takes/stock-takes.service.spec.ts src/inventory-shrinkage/inventory-shrinkage.service.spec.ts src/warehouse-transfers/warehouse-transfers.service.spec.ts test/integration.spec.ts`
- Frontend focused: `cd apps/frontend && npm test -- --runTestsByPath src/app/dashboard/inventory/stock-takes/[id]/page.test.tsx`

### Definition of Done

1. Configured inventory and transfer events post vouchers automatically.
2. Posting is atomic with stock/inventory movement finalization.
3. Disabled rules do not block operational completion.
4. Voucher references and posting status are visible in detail responses.

### Seed Mapping Baseline for This Story

- `inventory_adjustment + reason_type=DAMAGE` => Dr General Operating Expense / Cr Inventory-side account (temporary mapping until dedicated inventory adjustment account exists).
- `inventory_adjustment + reason_type=THEFT` => Dr General Operating Expense / Cr Inventory-side account (temporary).
- `fund_movement + transfer_scope=intra_store` => Dr destination cash/bank account / Cr source cash/bank account.

Follow-up note:

- Final inventory-account mappings should be refined once dedicated stock valuation and adjustment accounts are introduced.

## Dependencies

- Depends on Story 31.1, Story 40.x foundation, and Story 42.3 posting workflow.
- Supports inventory valuation and discrepancy accountability in Story 43.x.

### References

- [Source: docs/prd/epic-31-automated-accounting-integration-posting-rules.md]
- [Source: docs/prd/epic-40-warehouse-transfers.md]
- [Source: docs/prd/epic-41-lost-stolen-products.md]
- [Source: docs/prd/epic-42-inventory-discrepancy-entry.md]
