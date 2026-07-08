# Story 11.2: Develop Sales Returns Management UI

Status: done

## Story

As a Cashier or Manager,
I want an intuitive interface to look up past sales receipts and issue partial or full returns,
so that I can quickly satisfy customer refund requests efficiently at the register.

## Acceptance Criteria

1.  A "Returns" module exists in the dashboard sidebar. [x]
2.  Users can search for a past transaction by `serial_number`. [x]
3.  The UI displays a loaded Receipt with checkboxes/number spinners allowing the user to select which items they are returning. [x]
4.  The form blocks users from typing a return quantity higher than the originally purchased quantity (less previously returned items). [x]
5.  Submitting successfully routes the POST request to `/sales-returns` and marks the receipt with a 'Refunded' or 'Returned' visual badge. [x]
6.  The returns list uses the shared table UI and provides add, view, print, edit, and delete actions. [x]
7.  The return detail screen supports edit mode with constrained quantity updates and print preview output. [x]

## Tasks / Subtasks

- [x] Task 1: Returns Dashboard Page
  - [x] Implement `apps/frontend/src/app/dashboard/returns/page.tsx`.
  - [x] Display a unified table of past `SalesReturns` similar to the sales log.
- [x] Task 2: Return Issue Interface (Modal or Page)
  - [x] Build a "Process Return" drawer or modal.
  - [x] Implement search field specifically hitting the `GET /sales?serial_number=...` endpoint.
- [x] Task 3: API Integration
  - [x] Wire up `api.ts` with the new returns endpoints.
  - [x] Connect the dynamic quantity selection UI to calculate the dynamic `totalRefundDue` based on `price_at_sale`.
- [x] Task 4: Return Maintenance UX
  - [x] Add list-level actions for view, print, edit, and delete.
  - [x] Add detail-page edit mode with quantity caps derived from the underlying sale and other returns.

## Dev Notes

- **Integration with Epic 80:** If the cashier goes to `customers/[id]` and sees past receipts, we should eventually add a quick "Issue Return" button right next to the transaction there as well!

### References

- [Source: docs/prd/epic-11-sales-returns-management.md]

## Dev Agent Record

### Agent Model Used

Antigravity (simulating Amelia Dev Agent)

### Completion Notes List

- ✅ Implemented a shared DataTable-based Sales Returns list with search, filters, and row actions.
- ✅ Added a process-return modal for receipt lookup and return creation.
- ✅ Built return detail and edit flows with print preview support.
- ✅ Added delete support in the UI, aligned with the corrected backend delete behavior.
