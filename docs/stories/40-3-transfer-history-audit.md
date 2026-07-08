# Story 40.3: Transfer History and Audit Trail

Status: drafted

## Story

As a Shop Owner or Auditor,
I want to review historical transfer activity for a product or warehouse,
so that I can understand where stock moved and who confirmed each stage.

## Acceptance Criteria

1. Transfer list supports filtering by source warehouse, destination warehouse, status, product, and date range. [ ]
2. Transfer detail shows a status timeline with created, sent, partially received, and received events plus actor metadata when available. [ ]
3. Product detail or inventory drill-down can show transfer history affecting that product. [ ]
4. Historical transfer data is sourced from persisted transfer and movement records, not reconstructed heuristically from stock balances. [ ]
5. Export-friendly list payloads exist for audit review. [ ]
6. Tests cover filter behavior and audit payload completeness. [ ]

## Tasks / Subtasks

- [ ] Task 1: Audit query layer
  - [ ] Add query DTOs for transfer history filters and pagination.
  - [ ] Extend transfer list/detail queries with actor and status-event metadata.
  - [ ] Expose a product-scoped transfer-history endpoint or filter mode reused by inventory detail flows.
  - [ ] Likely file targets: `apps/backend/src/warehouse-transfers/warehouse-transfer.dto.ts`, `apps/backend/src/warehouse-transfers/warehouse-transfers.controller.ts`, `apps/backend/src/warehouse-transfers/warehouse-transfers.service.ts`

- [ ] Task 2: UI history experience
  - [ ] Add filter controls to the transfer list using the shared DataTable interaction model.
  - [ ] Render a transfer timeline on the detail page.
  - [ ] Add a product-level history panel or deep link from the inventory list into transfer history.
  - [ ] Likely file targets: `apps/frontend/src/app/dashboard/inventory/transfers/page.tsx`, `apps/frontend/src/app/dashboard/inventory/page.tsx`

- [ ] Task 3: Export and test support
  - [ ] Ensure list payloads include stable fields needed for CSV/PDF export later.
  - [ ] Add backend tests for warehouse/product/date filters.
  - [ ] Likely file targets: `apps/backend/src/warehouse-transfers/warehouse-transfers.service.spec.ts`, `apps/frontend/src/app/dashboard/inventory/transfers/page.test.tsx`

## Dev Notes

- Story 43.1 will introduce a universal stock ledger across all movement types. This story should stay transfer-specific and avoid duplicating the broader reporting surface.
- If actor stamping is not yet standardized, store user id and expose best-effort display fields now.

## Dependencies

- Depends on Stories 40.1 and 40.2.
- Complements Story 43.1 but does not block it.

### References

- [Source: docs/prd/epic-40-warehouse-transfers.md]
- [Source: apps/frontend/src/components/data-table/DataTable.tsx]
