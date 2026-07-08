# Story 21.3: Purchase Returns List & Creation UI

Status: review

## Story

As a Shop Owner or Procurement Manager,
I want a purchase returns dashboard and guided creation workflow,
so that I can initiate supplier returns from original purchases without leaving the procurement module.

## Acceptance Criteria

1. A `Purchase Returns` module exists in the dashboard sidebar and opens a dedicated list page. [x]
2. Users can search for existing purchases or supplier-linked transactions to start a return. [x]
3. The creation workflow displays original purchase lines with remaining returnable quantities. [x]
4. The form prevents users from entering quantities above the allowed returnable amount before submission. [x]
5. Submitting successfully calls `/purchase-returns` and refreshes the list with the new return record. [x]
6. The list uses the shared table pattern with search, sorting, and row-level add/view actions. [x]

## Tasks / Subtasks

- [x] Task 1: Dashboard entry points
  - [x] Add sidebar navigation and a dedicated list page.
  - [x] Reuse the shared DataTable experience already used by Sales, Orders, and Purchases.
  - [x] Add page-level search and summary columns for return number, supplier, purchase reference, total, and created date.
  - [ ] Likely file targets: `apps/frontend/src/components/Sidebar.tsx`, `apps/frontend/src/app/dashboard/purchase-returns/page.tsx`
- [x] Task 2: Create return workflow
  - [x] Build a modal or page flow to look up an original purchase.
  - [x] Show supplier context, eligible items, returnable quantities, and running totals.
  - [x] Pre-populate source purchase metadata so users can verify they are returning against the correct supplier transaction.
  - [ ] Likely file targets: `apps/frontend/src/app/dashboard/purchase-returns/CreatePurchaseReturnModal.tsx`, `apps/frontend/src/app/dashboard/purchases/page.tsx`
- [x] Task 3: Frontend API integration
  - [x] Extend `apps/frontend/src/lib/api.ts` with purchase-return create, list, detail, update, and delete calls needed by the UI flow.
  - [x] Surface backend validation errors clearly in the creation form.
  - [x] Refresh the table after successful create and preserve UX consistency with purchases and sales returns.
  - [ ] Likely file targets: `apps/frontend/src/lib/api.ts`, `apps/frontend/src/app/dashboard/purchase-returns/page.tsx`, `apps/frontend/src/app/dashboard/purchase-returns/CreatePurchaseReturnModal.tsx`

## Dev Notes

- **Dependencies:** Depends on Stories 21.1 and 21.2.
- **UX Pattern:** Follow the purchase and sales return list experiences instead of inventing a new workflow style.
- **Validation Boundary:** Client-side caps should improve usability, but the backend remains the source of truth.

### Project Structure Notes

- New screens should live under `apps/frontend/src/app/dashboard/purchase-returns`.
- Purchase lookup integration will likely touch `apps/frontend/src/app/dashboard/purchases` and shared purchase components.
- Shared table column logic should stay aligned with existing DataTable-based dashboards rather than introducing custom list rendering.

### References

- [Source: docs/prd/epic-21-purchase-returns-management.md]
- [Source: apps/frontend/src/app/dashboard/returns/page.tsx]
- [Source: apps/frontend/src/app/dashboard/purchases/page.tsx]

## Dev Agent Record

### Agent Model Used

GPT-5.4

### Completion Notes List

- Added a new `Purchase Returns` dashboard module with sidebar navigation, a shared `DataTable`-based list page, and row actions for create-from-purchase and view.
- Implemented a guided create modal that searches original purchases, shows supplier context and remaining returnable quantities, applies client-side quantity caps, and posts `/purchase-returns` successfully.
- Extended the frontend API layer with purchase-return endpoints and better backend error extraction, and added a lightweight purchase return detail route plus UI test coverage.

### File List

- apps/backend/src/purchases/purchases.service.ts
- apps/backend/src/purchases/purchases.service.spec.ts
- apps/frontend/src/lib/api.ts
- apps/frontend/src/components/Sidebar.tsx
- apps/frontend/src/app/dashboard/purchase-returns/CreatePurchaseReturnModal.tsx
- apps/frontend/src/app/dashboard/purchase-returns/page.tsx
- apps/frontend/src/app/dashboard/purchase-returns/[id]/page.tsx
- apps/frontend/src/app/dashboard/purchase-returns/page.test.tsx

### Change Log

- 2026-03-20: Implemented Story 21.3 purchase returns list, create workflow, and frontend integration.
