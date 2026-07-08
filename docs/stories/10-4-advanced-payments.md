# Story 10.4: Advanced Payments (Split/Cards)

Status: done

## Story

As a Cashier,
I want to accept multiple forms of payment for a single sale (e.g., partial cash, partial bKash),
so that I can accommodate customer preferences.

## Acceptance Criteria

1.  The checkout modal allows specifying amounts for Cash, Card, and Mobile Money. [x]
2.  The sale record accurately reflects the split payment methods. [x]
3.  Change due is calculated correctly. [x]
4.  Sales list and detail views expose payment breakdowns, amount paid, and print-friendly receipt output. [x]

## Tasks / Subtasks

- [x] Task 1: Checkout Modal UI
  - [x] Update POS to open a modal on checkout.
  - [x] Add inputs for different payment methods (Cash, bKash, etc.) that sum to the total.
- [x] Task 2: Change Calculation
  - [x] Implement reactive logic to display "Amount Tendered", "Remaining Balance", and "Change Due".
- [x] Task 3: Backend Schema Updates
  - [x] Ensure `sales` or a new `payment_records` table can store multiple payment types for one sale.
  - [x] Update the `processSale` action to handle the expanded payment payload.

## Dev Notes

- **UX:** The modal must be foolproof. Prevent submission if Amount Tendered < Total (unless it's a credit sale, which we might skip for MVP).
- **bKash:** Mobile money is huge in Bangladesh, ensure it's explicitly supported in the UI.

### Project Structure Notes

- Payment methods should be extensible, ideally driven by an enum or config.

### References

- [Source: docs/architecture/core-workflows.md]

## Dev Agent Record

### Agent Model Used
Antigravity (simulating Amelia Dev Agent)

### Completion Notes List

- ✅ Added `PaymentRecord` to database schema via Prisma.
- ✅ Updated `CreateSaleDto` and backend service route handlers for payment processing.
- ✅ Built out `POSPage` UI Checkout modal to support multi-payment allocations (Cash/bKash/Card).
- ✅ Exposed payment mix and amount-paid summaries in the Sales dashboard and sale detail screen with browser print support.
- ✅ Tests: `apps/backend/src/sales/sales.service.spec.ts` — split payment tests; `apps/frontend/src/app/dashboard/pos/page.test.tsx` — modal, change calculation, and api.createSale call tests (all passing).
