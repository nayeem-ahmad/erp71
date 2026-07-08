# Story 11.1: Implement Sales Return API

Status: done

## Story

As a Backend System,
I want to provide secure transactional endpoints for processing a customer's product return,
so that inventory can be accurately re-incremented and the financial logs remain balanced.

## Acceptance Criteria

1.  A `SalesReturn` and `SalesReturnItem` model exist in Prisma, linked to the original `Sale`. [x]
2.  `POST /sales-returns` accepts an original `sale_id`, a list of items being returned, and the quantities. [x]
3.  The API validates that the quantity returned does not exceed the quantity originally purchased. [x]
4.  The system uses a Prisma `$transaction` to insert the return record and automatically atomatically increment the `ProductStock`. [x]
5.  `GET /sales-returns` list view and `GET /sales-returns/:id` endpoints available. [x]
6.  `PATCH /sales-returns/:id` and `DELETE /sales-returns/:id` support return maintenance and cleanup while keeping stock and totals consistent. [x]

## Tasks / Subtasks

- [x] Task 1: Database Schema
  - [x] Add `SalesReturn` and `SalesReturnItem` models to Prisma. They should tie to `Tenant`, `Store`, `Sale`, and `Product`.
  - [x] Run Prisma push and generated client locally.
- [x] Task 2: Validation Logic & DTO
  - [x] Create `ReturnSaleDto` enforcing non-zero quantities.
  - [x] Add update DTO support for editable return lines.
- [x] Task 3: The `sales-returns.service.ts`
  - [x] Query the original sale to verify purchased quantities.
  - [x] Ensure previous partial returns haven't exhausted the item quantity.
  - [x] Create new return record, and execute `increment` on `ProductStock`.
  - [x] Support return updates and delete rollback logic that rebalances stock correctly.
  
## Dev Notes

- **Data Integrity:** It is strictly impossible to refund an item if the cashier provides an ID for an item that wasn't on the original receipt.
- **Store Credit integration:** While Epic 80 introduced customers, true store-credit 'Wallets' are Epic 82, so for v0.1 we can just record the return and assume the cashier handed back digital cash or marked it as standard refund. We will record the `refund_amount_paid`.

### References

- [Source: docs/prd/epic-11-sales-returns-management.md]

## Dev Agent Record

### Agent Model Used

Antigravity (simulating Amelia Dev Agent)

### Completion Notes List

- ✅ Implemented transactional create/list/detail/update/delete support for Sales Returns in NestJS.
- ✅ Enforced quantity validation against the original sale and prior partial returns.
- ✅ Re-incremented stock on create and correctly reversed/reapplied stock during update and delete flows.
- ✅ Added the return delete fix using `return_id` cleanup semantics so removing returns no longer leaves orphaned line items.
