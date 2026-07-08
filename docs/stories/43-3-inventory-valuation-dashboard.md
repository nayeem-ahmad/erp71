# Story 43.3: Inventory Valuation Dashboard

Status: drafted

## Story

As a Shop Owner or Manager,
I want to see inventory value by warehouse and product,
so that I can understand how much capital is tied up in stock.

## Acceptance Criteria

1. A valuation endpoint returns total stock value and quantity for a selected date window and warehouse scope. [ ]
2. The first release supports a clearly labeled valuation method, preferably weighted average cost, using purchase and adjustment history. [ ]
3. The response includes per-product and per-warehouse breakdowns. [ ]
4. Products with missing cost basis are surfaced explicitly with fallback handling. [ ]
5. A dashboard UI shows total value, top-value items, and warehouse-level splits. [ ]
6. Tests cover valuation math, missing-cost behavior, and filter handling. [ ]

## Tasks / Subtasks

- [ ] Task 1: Valuation method and contract
  - [ ] Document the supported costing method for v1 and define payload fields for total value, unit cost basis, and breakdown rows.
  - [ ] Likely file targets: `apps/backend/src/inventory-reports/inventory-reports.dto.ts`, `packages/shared-types/index.ts`

- [ ] Task 2: Backend valuation implementation
  - [ ] Build valuation queries from purchase cost history plus movement-adjusted stock balances.
  - [ ] Support warehouse and product filters.
  - [ ] Likely file targets: `apps/backend/src/inventory-reports/inventory-reports.service.ts`

- [ ] Task 3: Frontend valuation dashboard
  - [ ] Add a valuation page or section in inventory reports with summary tiles and breakdown tables.
  - [ ] Keep the UI additive to the existing dashboard/reporting patterns.
  - [ ] Likely file targets: `apps/frontend/src/app/dashboard/inventory/reports/valuation/page.tsx`, `apps/frontend/src/lib/api.ts`

- [ ] Task 4: Tests
  - [ ] Add backend valuation math tests and frontend coverage for loaded and empty states.
  - [ ] Likely file targets: `apps/backend/src/inventory-reports/inventory-reports.service.spec.ts`, `apps/frontend/src/app/dashboard/inventory/reports/valuation/page.test.tsx`

## Dev Notes

- Do not promise FIFO unless the underlying cost layers are persisted. Weighted average cost is the safer first implementation given the current schema.
- Keep valuation read-only. Purchase recommendation and reorder workflows belong to Story 43.2.

## Dependencies

- Depends on Story 43.1 and purchase cost history from Epic 20.
- Can be enriched by Story 45.4 category filters.

### References

- [Source: docs/prd/epic-43-inventory-analytics-reporting.md]
- [Source: apps/backend/src/purchases/purchases.service.ts]
