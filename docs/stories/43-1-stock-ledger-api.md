# Story 43.1: Universal Stock Ledger API

Status: drafted

## Story

As a Shop Owner or Manager,
I want a universal stock ledger endpoint,
so that every stock movement can be reviewed as in, out, and balance history by product and warehouse.

## Acceptance Criteria

1. A tenant-scoped stock ledger endpoint exists for date-range, product, warehouse, movement-type, and reference filters. [ ]
2. Ledger rows include timestamp, product, warehouse, movement type, reference document, quantity delta, and running balance within the filtered scope. [ ]
3. The ledger reads from persisted `InventoryMovement` records and does not reconstruct movement history from current stock alone. [ ]
4. Transfer, shrinkage, sales, purchase receipts, purchase returns, and stock-take adjustments can all appear in the same ledger contract when implemented. [ ]
5. Query performance remains suitable for larger tenants through indexing and pagination. [ ]
6. Tests cover cross-movement aggregation, filters, and running-balance correctness. [ ]

## Tasks / Subtasks

- [ ] Task 1: Ledger contract and indexing
  - [ ] Define list query DTOs and response types for stock ledger rows and summary totals.
  - [ ] Add indexes on movement timestamp, tenant, warehouse, product, and movement type.
  - [ ] Likely file targets: `packages/database/prisma/schema.prisma`, `packages/shared-types/index.ts`, `apps/backend/src/inventory-reports/inventory-reports.dto.ts`

- [ ] Task 2: Backend ledger query
  - [ ] Implement stock ledger list endpoint under an inventory reporting module.
  - [ ] Include joins for product and warehouse display context plus reference document metadata.
  - [ ] Likely file targets: `apps/backend/src/inventory-reports/*`, `apps/backend/src/app.module.ts`

- [ ] Task 3: Frontend ledger shell
  - [ ] Add stock ledger page using the shared report/table design language.
  - [ ] Provide filters for date, warehouse, product, and movement type with URL-persisted state if practical.
  - [ ] Likely file targets: `apps/frontend/src/app/dashboard/inventory/ledger/page.tsx`, `apps/frontend/src/lib/api.ts`, `apps/frontend/src/components/Sidebar.tsx`

- [ ] Task 4: Tests
  - [ ] Add backend aggregation tests and frontend filter rendering tests.
  - [ ] Likely file targets: `apps/backend/src/inventory-reports/inventory-reports.service.spec.ts`, `apps/frontend/src/app/dashboard/inventory/ledger/page.test.tsx`

## Dev Notes

- Treat `InventoryMovement` as the single reporting source of truth going forward.
- If older sales or purchase flows are not yet writing movement rows, update them as part of this story rather than introducing report-only special cases.

## Dependencies

- Depends on Story 40.1 and benefits from Stories 41.1 and 42.3.
- Blocks Story 43.3.

### References

- [Source: docs/prd/epic-43-inventory-analytics-reporting.md]
- [Source: packages/database/prisma/schema.prisma]
