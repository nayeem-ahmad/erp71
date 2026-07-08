# Story 12.3: Order UI and Partial Payment Handling

Status: done

## Story

As a Cashier handling large orders,
I want to record partial cash/card deposits against a Sales Order in the dashboard,
so that I can track precisely how much the customer still owes securely.

## Acceptance Criteria

1.  Implement `apps/frontend/src/app/dashboard/orders/page.tsx` displaying the dashboard. [x]
2.  Create `[id]/page.tsx` letting users view exact quantities and issue new `OrderDeposits`. [x]
3.  The backend `/sales-orders/:id/deposits` natively calculates the new `payment_status` (`PARTIAL` or `PAID`). [x]
4.  The orders list uses the shared table UI and provides add, view, print, edit, and delete actions consistent with Sales. [x]
5.  The order detail screen supports edit mode, status actions, deposit tracking, amount-due summaries, and print preview output. [x]

## Dev Agent Record

### Agent Model Used

Antigravity

### Completion Notes List

- Built UI allowing users to manually construct sales orders natively and record deposits.
- Wired complex state changes evaluating paid deposits instantly to accurately render `amount_due`.
- Added `CreateOrderModal`, list-level CRUD actions, order detail edit mode, fulfillment status buttons, and print-friendly order output.
