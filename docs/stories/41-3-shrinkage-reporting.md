# Story 41.3: Shrinkage Reporting and Summary Metrics

Status: drafted

## Story

As a Shop Owner or Manager,
I want shrinkage summaries by reason, warehouse, and value,
so that I can identify problem areas and reduce avoidable inventory loss.

## Acceptance Criteria

1. A shrinkage reporting endpoint returns quantity and estimated value grouped by reason and warehouse for a selected date range. [ ]
2. The response can be filtered by product, category, warehouse, and reason. [ ]
3. The UI shows total shrinkage quantity, total value, and top reasons for the selected window. [ ]
4. Shrinkage value uses the currently supported inventory costing method and labels the method in the response. [ ]
5. The report reuses persisted shrinkage and movement records rather than scanning unrelated sales or purchase data. [ ]
6. Tests cover grouped totals, filters, and empty-result states. [ ]

## Tasks / Subtasks

- [ ] Task 1: Reporting query design
  - [ ] Define summary and breakdown payloads for shrinkage KPIs and grouped rows.
  - [ ] Choose and document the cost basis used for shrinkage valuation in the first release.
  - [ ] Likely file targets: `apps/backend/src/inventory-reports/inventory-reports.dto.ts`, `packages/shared-types/index.ts`

- [ ] Task 2: Backend report implementation
  - [ ] Add shrinkage summary endpoint under an inventory reporting module or existing inventory-report route surface.
  - [ ] Support tenant-scoped filters for date, warehouse, reason, product, and category when available.
  - [ ] Likely file targets: `apps/backend/src/inventory-reports/*`, `apps/backend/src/app.module.ts`

- [ ] Task 3: Frontend reporting UI
  - [ ] Add a shrinkage reporting page or section under inventory reports.
  - [ ] Render KPI cards plus grouped breakdown table using shared dashboard/report styling.
  - [ ] Likely file targets: `apps/frontend/src/app/dashboard/inventory/reports/shrinkage/page.tsx`, `apps/frontend/src/lib/api.ts`

- [ ] Task 4: Tests
  - [ ] Add backend aggregation tests and frontend rendering tests.
  - [ ] Likely file targets: `apps/backend/src/inventory-reports/inventory-reports.service.spec.ts`, `apps/frontend/src/app/dashboard/inventory/reports/shrinkage/page.test.tsx`

## Dev Notes

- Keep this report focused on shrinkage. The broader inventory analytics experience is handled in Epic 43.
- If category filtering is not available yet, make it optional in the contract and wire it in once Epic 45 lands.

## Dependencies

- Depends on Stories 41.1 and 41.2.
- Can be enriched by Story 45.4 but should not block on it.

### References

- [Source: docs/prd/epic-41-lost-stolen-products.md]
- [Source: docs/prd/epic-43-inventory-analytics-reporting.md]
