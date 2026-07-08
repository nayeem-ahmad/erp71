# Story 21.2: Purchase Return Validation & Inventory Reversal

Status: review

## Story

As an Inventory Control System,
I want purchase return rules to validate supplier return quantities and reverse stock safely,
so that inventory and procurement history remain accurate after every create, update, or delete action.

## Acceptance Criteria

1. Return quantities cannot exceed originally purchased quantities minus prior returns for the same purchase lines. [x]
2. The system verifies sufficient on-hand quantity before decreasing stock for any returned product. [x]
3. Create and update flows use a Prisma `$transaction` to persist return items and atomically decrement `ProductStock`. [x]
4. Delete and update flows correctly restore or recalculate stock so edits do not leave drift. [x]
5. Automated tests cover quantity caps, stock guards, update recalculation, and delete rollback behavior. [x]

## Tasks / Subtasks

- [x] Task 1: Quantity eligibility rules
  - [x] Validate item references against the original purchase lines.
  - [x] Calculate remaining returnable quantity after prior returns.
  - [x] Reject payloads where the same purchase line is duplicated in a way that could bypass quantity caps.
  - [ ] Likely file targets: `apps/backend/src/purchase-returns/purchase-returns.service.ts`, `apps/backend/src/purchase-returns/purchase-return.dto.ts`
- [x] Task 2: Stock reversal rules
  - [x] Prevent stock from going negative when purchase returns are posted.
  - [x] Apply stock decrement logic inside the same transaction as return persistence.
  - [x] Reuse the existing `ProductStock` uniqueness assumptions from purchases and sales where possible.
  - [ ] Likely file targets: `apps/backend/src/purchase-returns/purchase-returns.service.ts`, `packages/database/prisma/schema.prisma`
- [x] Task 3: Maintenance behavior
  - [x] Recompute stock correctly during return edits.
  - [x] Restore stock completely when a purchase return is deleted.
  - [x] Ensure deleted or edited items do not leave orphaned return rows or stale totals.
  - [ ] Likely file targets: `apps/backend/src/purchase-returns/purchase-returns.service.ts`, `apps/backend/src/purchase-returns/purchase-returns.controller.ts`
- [x] Task 4: Test coverage
  - [x] Add service-level tests for validation and stock behavior.
  - [ ] Extend integration tests for create, update, and delete flows.
  - [x] Include coverage for insufficient stock, over-return attempts, and partial-return edits.
  - [ ] Likely file targets: `apps/backend/src/purchase-returns/purchase-returns.service.spec.ts`, `apps/backend/test/integration.spec.ts`

## Dev Notes

- **Dependencies:** Builds directly on Story 21.1.
- **Data Integrity:** A purchase return line must only reference products present on the original purchase.
- **Accounting Scope:** Persist return totals and reference data for future supplier credit memo and accounts-payable integration, but do not implement ledger posting yet.

### Project Structure Notes

- Integration coverage should stay in `apps/backend/test/integration.spec.ts` unless the suite is already split further.
- Validation and stock-balancing logic should stay centralized in the purchase-return service rather than leaking into the controller.

### References

- [Source: docs/prd/requirements.md]
- [Source: docs/prd/epic-21-purchase-returns-management.md]
- [Source: apps/backend/src/sales-returns/sales-returns.service.ts]

## Dev Agent Record

### Agent Model Used

GPT-5.4

### Completion Notes List

- Added transactional purchase return validation that enforces original-purchase membership, remaining returnable quantity, and duplicate-line rejection before writing any item rows.
- Implemented stock decrement on create and update, plus stock restoration on update and delete, so purchase-return edits cannot leave inventory drift.
- Expanded the purchase-return unit suite with over-return, insufficient-stock, update recalculation, and delete rollback cases, and added integration coverage for successful create and over-return rejection.

### File List

- apps/backend/src/purchase-returns/purchase-returns.service.ts
- apps/backend/src/purchase-returns/purchase-returns.service.spec.ts
- apps/backend/test/integration.spec.ts

### Change Log

- 2026-03-20: Implemented Story 21.2 purchase return validation and inventory reversal rules.
