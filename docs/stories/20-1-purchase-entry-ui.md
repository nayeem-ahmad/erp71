# Story 20.1: Purchase Entry UI

Status: review

## Story

As a Shop Owner,
I want a purchase entry workflow for recording incoming stock,
so that I can replenish inventory with accurate cost details.

## Acceptance Criteria

1. A purchase entry screen exists and is accessible from the Purchase navigation. [x]
2. Users can select one or more inventory products, enter received quantity, and capture unit cost. [x]
3. Users can launch an Add Stock flow directly from the inventory screen. [x]
4. Purchase totals include optional freight, tax, and discount adjustments in the UI before submission. [x]

## Tasks / Subtasks

- [x] Task 1: Purchase entry workspace
  - [x] Add a Purchase page in the frontend dashboard.
  - [x] Build a modal form for selecting products, quantities, and unit cost.
- [x] Task 2: Inventory Add Stock shortcut
  - [x] Add an Add Stock action from the inventory experience.
  - [x] Prefill the purchase flow with the selected product.
- [x] Task 3: Purchase totals UX
  - [x] Capture freight, tax, discount, and notes inputs.
  - [x] Show computed subtotal and total before save.

## Dev Notes

- Frontend follows the existing client-rendered dashboard pattern in `apps/frontend`.
- API calls must go through `apps/frontend/src/lib/api.ts`.
- Purchase UI should align with the DataTable-heavy list experiences used across Sales and Returns.

### Project Structure Notes

- New purchase screens live under `apps/frontend/src/app/dashboard/purchases`.
- Inventory integration stays within `apps/frontend/src/app/dashboard/inventory`.

### References

- [Source: docs/prd/epic-20-core-purchase-transactions.md]
- [Source: apps/frontend/src/app/dashboard/orders/CreateOrderModal.tsx]

## Dev Agent Record

### Agent Model Used

GPT-5.4

### Debug Log References

### Completion Notes List

- ✅ Added a dedicated purchases dashboard page and modal workflow for direct stock entry.
- ✅ Added a direct Add Stock action from inventory to open the same purchase workflow with product context.
- ✅ Added purchase total calculation support for freight, tax, and discount inputs.

### File List

- apps/frontend/src/app/dashboard/purchases/page.tsx
- apps/frontend/src/app/dashboard/purchases/CreatePurchaseModal.tsx
- apps/frontend/src/app/dashboard/inventory/page.tsx
- apps/frontend/src/lib/api.ts
- apps/frontend/src/components/Sidebar.tsx
- apps/frontend/src/app/dashboard/purchases/page.test.tsx

### Change Log

- 2026-03-20: Created and implemented Story 20.1.
