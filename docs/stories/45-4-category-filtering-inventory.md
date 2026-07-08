# Story 45.4: Category-Based Filtering in Inventory and Reports

Status: drafted

## Story

As a Shop Owner or Manager,
I want to filter inventory views by group and subgroup,
so that I can review focused slices of the catalog quickly.

## Acceptance Criteria

1. The main inventory list supports group and subgroup filters. [ ]
2. Subgroup filter options narrow based on the selected group. [ ]
3. Filter state is reflected in API queries and preserved across pagination, sorting, and refresh where practical. [ ]
4. Inventory reports can accept category filters once category assignment data exists. [ ]
5. Uncategorized products can still be isolated or included explicitly. [ ]
6. Tests cover filter interactions and uncategorized-product behavior. [ ]

## Tasks / Subtasks

- [ ] Task 1: Backend filter support
  - [ ] Extend product list and relevant inventory report endpoints with `groupId`, `subgroupId`, and uncategorized filter modes.
  - [ ] Likely file targets: `apps/backend/src/products/products.service.ts`, `apps/backend/src/inventory-reports/inventory-reports.service.ts`

- [ ] Task 2: Inventory page filters
  - [ ] Add group and subgroup filter controls to the existing inventory list page.
  - [ ] Preserve the current search and DataTable ergonomics while adding category filters.
  - [ ] Likely file targets: `apps/frontend/src/app/dashboard/inventory/page.tsx`, `apps/frontend/src/lib/api.ts`

- [ ] Task 3: Reporting integration
  - [ ] Thread category filters into reorder, shrinkage, and valuation reporting pages when present.
  - [ ] Likely file targets: `apps/frontend/src/app/dashboard/inventory/reports/*`, `apps/backend/src/inventory-reports/*`

- [ ] Task 4: Tests
  - [ ] Add frontend filter interaction tests and backend filtered-query coverage.
  - [ ] Likely file targets: `apps/frontend/src/app/dashboard/inventory/page.test.tsx`, `apps/backend/src/products/products.service.spec.ts`

## Dev Notes

- This story should improve browsing and reporting, not introduce a second inventory list page.
- If URL-backed filters are already used elsewhere in the dashboard, follow the same convention.

## Dependencies

- Depends on Stories 45.1 and 45.3.
- Enriches Stories 41.3, 43.2, and 43.3.

### References

- [Source: docs/prd/epic-45-product-categorization.md]
- [Source: apps/frontend/src/app/dashboard/inventory/page.tsx]
- [Source: docs/prd/epic-43-inventory-analytics-reporting.md]
