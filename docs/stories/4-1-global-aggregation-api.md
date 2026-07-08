# Story 4.1: Executive Dashboard Aggregation API

Status: drafted

## Story

As a Shop Owner or Manager,
I want a single dashboard API that aggregates high-level business KPIs,
so that the landing page can load a coherent executive summary without stitching together multiple slow client-side calls.

## Acceptance Criteria

1. A tenant-scoped dashboard summary endpoint returns KPI tiles for sales, profit, orders, deliveries, and low-stock counts. [ ]
2. The response includes quick-action counts and alert counts required by the landing page. [ ]
3. KPI calculations reuse existing sales, inventory, purchase, and accounting data instead of duplicating summary tables prematurely. [ ]
4. The endpoint supports a small date-range or preset-window contract for today, week, and month views. [ ]
5. The query avoids N+1 cross-module lookups and remains performant for larger tenants. [ ]
6. Automated tests cover empty-state tenants, mixed-activity tenants, and invalid date-window input. [ ]

## Tasks / Subtasks

- [ ] Task 1: Dashboard response contract
  - [ ] Define a stable summary DTO with KPI tiles, quick actions, and alert counts.
  - [ ] Reconcile existing accounting KPI and inventory reporting shapes into a dashboard-friendly contract.
  - [ ] Likely file targets: `packages/shared-types/index.ts`, `apps/backend/src/dashboard/dashboard.dto.ts`

- [ ] Task 2: Backend aggregation service
  - [ ] Create or extend a dashboard module in the backend.
  - [ ] Aggregate data from sales, accounting, inventory, and delivery-related tables using tenant-scoped queries.
  - [ ] Likely file targets: `apps/backend/src/dashboard/*`, `apps/backend/src/accounting/accounting.service.ts`, `apps/backend/src/inventory-reports/inventory-reports.service.ts`

- [ ] Task 3: Test coverage
  - [ ] Add unit and controller tests for summary payload shape and date-window validation.
  - [ ] Likely file targets: `apps/backend/src/dashboard/*.spec.ts`

## Dev Notes

- The repo already has accounting KPI endpoints and an older `apps/web` dashboard summary route. Reuse those semantics where they are still valid, but keep the active implementation in the Nest backend used by `apps/frontend`.
- Avoid creating a second set of financial calculation rules in the dashboard layer.
- If delivery data is not implemented yet, return explicit placeholder or zero states rather than hiding the field silently.

## Dependencies

- Depends on Epics 10, 20, 30, 34, and 43.
- Blocks Stories 4.2 and 4.3.

### References

- [Source: docs/prd/epic-04-main-executive-dashboard.md]
- [Source: apps/backend/src/accounting/accounting.service.ts]
- [Source: apps/web/src/app/api/dashboard/summary/route.ts]
