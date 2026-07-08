# Story 43.2: Reorder Suggestion Engine

Status: drafted

## Story

As a Shop Owner or Purchasing Manager,
I want suggested reorder quantities based on stock policy,
so that I know what to buy before shelves run short.

## Acceptance Criteria

1. A reorder suggestion endpoint returns products that are below or approaching reorder thresholds. [ ]
2. Suggested quantity considers current on-hand stock, inbound transfer quantities, reorder level, safety stock, and lead time where configured. [ ]
3. Results can be filtered by warehouse, supplier, category, and product status when those fields are available. [ ]
4. The UI presents an actionable reorder list with shortage reason and suggested quantity. [ ]
5. Products with missing alert-rule configuration are handled explicitly rather than silently skipped. [ ]
6. Tests cover threshold math, inbound-transfer treatment, and empty-state behavior. [ ]

## Tasks / Subtasks

- [ ] Task 1: Rule inputs and contract
  - [ ] Define reorder suggestion DTOs and summary fields such as on-hand, in-transit, target stock, and suggested quantity.
  - [ ] Read global defaults and product overrides from inventory settings.
  - [ ] Likely file targets: `apps/backend/src/inventory-reports/inventory-reports.dto.ts`, `packages/shared-types/index.ts`

- [ ] Task 2: Backend suggestion algorithm
  - [ ] Implement calculation logic using warehouse-aware stock plus in-transit transfer quantities.
  - [ ] Support optional supplier/category joins for purchase planning.
  - [ ] Likely file targets: `apps/backend/src/inventory-reports/inventory-reports.service.ts`

- [ ] Task 3: Frontend reorder report
  - [ ] Add reorder suggestion page with filters and shared DataTable rendering.
  - [ ] Provide a clear explanation for each suggestion row so operators trust the output.
  - [ ] Likely file targets: `apps/frontend/src/app/dashboard/inventory/reports/reorder/page.tsx`, `apps/frontend/src/lib/api.ts`

- [ ] Task 4: Tests
  - [ ] Add backend calculation tests and frontend list rendering tests.
  - [ ] Likely file targets: `apps/backend/src/inventory-reports/inventory-reports.service.spec.ts`, `apps/frontend/src/app/dashboard/inventory/reports/reorder/page.test.tsx`

## Dev Notes

- Story 44.3 defines the settings surface for alert rules. This story should consume that contract, with safe defaults if UI management is not merged first.
- Keep the first algorithm deterministic and explainable. Do not hide business rules behind opaque scoring.

## Dependencies

- Depends on Story 44.3 and benefits from Story 45.4 for category filtering.
- Complements Story 20.1 purchase entry workflows.

### References

- [Source: docs/prd/epic-43-inventory-analytics-reporting.md]
- [Source: docs/prd/epic-44-inventory-settings.md]
