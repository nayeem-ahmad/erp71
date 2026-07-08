# Story 40.2: Transfer Receive and Reconciliation Flow

Status: drafted

## Story

As a Store Manager at the destination warehouse,
I want to receive an incoming transfer,
so that stock only becomes available at the destination after physical arrival is confirmed.

## Acceptance Criteria

1. Transfer detail supports `SENT`, `PARTIALLY_RECEIVED`, and `RECEIVED` states. [ ]
2. `POST /warehouse-transfers/:id/receive` or equivalent receive action accepts per-line received quantities and notes. [ ]
3. Receiving a transfer atomically increments destination stock and writes inbound `InventoryMovement` rows tied to the transfer. [ ]
4. The API blocks over-receipt, duplicate receipt of a fully received transfer, and receipt against a transfer outside the tenant. [ ]
5. A dashboard UI exists to review transfer detail and trigger receive actions from the destination context. [ ]
6. Partial receipts leave the remaining quantity visible as in transit until fully received. [ ]
7. Tests cover full receive, partial receive, and invalid double-receive behavior. [ ]

## Tasks / Subtasks

- [ ] Task 1: Backend receive contract
  - [ ] Add receive DTOs with line-level quantity validation.
  - [ ] Persist received totals and status transitions on transfer and transfer items.
  - [ ] Write destination-side inventory movements for each accepted quantity.
  - [ ] Likely file targets: `apps/backend/src/warehouse-transfers/warehouse-transfer.dto.ts`, `apps/backend/src/warehouse-transfers/warehouse-transfers.service.ts`

- [ ] Task 2: Transfer detail and receive UX
  - [ ] Add transfers list page with source, destination, status, item count, and created date.
  - [ ] Add transfer detail screen with send/receive timeline and receive form or modal.
  - [ ] Surface partial-receipt state clearly so operators know what is still outstanding.
  - [ ] Likely file targets: `apps/frontend/src/app/dashboard/inventory/transfers/page.tsx`, `apps/frontend/src/app/dashboard/inventory/transfers/[id]/page.tsx`, `apps/frontend/src/lib/api.ts`

- [ ] Task 3: Shared navigation and state updates
  - [ ] Add Inventory transfer navigation entry without breaking the existing top-level inventory access path.
  - [ ] Refresh list/detail views after receive completion and preserve row-level filtering by status.
  - [ ] Likely file targets: `apps/frontend/src/components/Sidebar.tsx`, `apps/frontend/src/components/data-table/DataTable.tsx`

- [ ] Task 4: Test coverage
  - [ ] Add backend tests for partial and full receipt transitions.
  - [ ] Add frontend tests for receive form validation and success flow.
  - [ ] Likely file targets: `apps/backend/src/warehouse-transfers/warehouse-transfers.service.spec.ts`, `apps/frontend/src/app/dashboard/inventory/transfers/[id]/page.test.tsx`

## Dev Notes

- Do not make stock available at the destination when the transfer is merely sent.
- Keep the receive endpoint idempotent against repeated submissions from flaky operator workflows.
- Any future transit documents or delivery proof can attach to the same transfer entity without changing the movement math.

## Dependencies

- Depends on Story 40.1.
- Blocks Story 40.3 and strengthens inputs for Story 43.1.

### References

- [Source: docs/prd/epic-40-warehouse-transfers.md]
- [Source: apps/frontend/src/app/dashboard/purchase-returns/page.tsx]
- [Source: apps/frontend/src/components/Sidebar.tsx]
