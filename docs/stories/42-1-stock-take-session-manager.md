# Story 42.1: Stock-Take Session Manager

Status: drafted

## Story

As a Store Manager,
I want to open and manage a stock-take session for a warehouse,
so that physical counting work is organized and isolated from day-to-day inventory operations.

## Acceptance Criteria

1. A `StockTakeSession` model exists with statuses such as `DRAFT`, `COUNTING`, `REVIEW`, `POSTED`, and `CANCELLED`. [ ]
2. A session is always scoped to one tenant and one warehouse. [ ]
3. Creating a session snapshots expected stock quantities for the selected warehouse at session start. [ ]
4. `POST /stock-takes`, `GET /stock-takes`, and `GET /stock-takes/:id` exist with tenant-scoped session detail. [ ]
5. The dashboard includes a stock-take list page showing session status, warehouse, started date, and progress metrics. [ ]
6. Tests cover warehouse scoping, snapshot generation, and status transitions into counting mode. [ ]

## Tasks / Subtasks

- [ ] Task 1: Session schema and snapshot design
  - [ ] Add `StockTakeSession` and `StockTakeCountLine` models or equivalent snapshot structure.
  - [ ] Store expected quantity at session creation so later movements do not mutate the audit baseline.
  - [ ] Likely file targets: `packages/database/prisma/schema.prisma`

- [ ] Task 2: Backend session APIs
  - [ ] Implement create, list, and detail endpoints plus status transition rules.
  - [ ] Expose summary counters such as counted lines, discrepant lines, and total expected quantity.
  - [ ] Likely file targets: `apps/backend/src/stock-takes/*`, `apps/backend/src/app.module.ts`

- [ ] Task 3: Frontend stock-take shell
  - [ ] Add stock-take session list page and create-session entry flow.
  - [ ] Show warehouse, session status, progress, and actions to open/count/review.
  - [ ] Likely file targets: `apps/frontend/src/app/dashboard/inventory/stock-takes/page.tsx`, `apps/frontend/src/lib/api.ts`, `apps/frontend/src/components/Sidebar.tsx`

- [ ] Task 4: Tests
  - [ ] Add session lifecycle backend tests and frontend list-shell coverage.
  - [ ] Likely file targets: `apps/backend/src/stock-takes/stock-takes.service.spec.ts`, `apps/frontend/src/app/dashboard/inventory/stock-takes/page.test.tsx`

## Dev Notes

- The snapshot must be immutable after session creation. Posting later should reconcile against the snapshot plus counted quantity, not against current live stock.
- Do not mix the session manager with discrepancy posting logic in this story; that belongs to Story 42.3.

## Dependencies

- Depends on Story 40.1.
- Blocks Stories 42.2 and 42.3.

### References

- [Source: docs/prd/epic-42-inventory-discrepancy-entry.md]
- [Source: apps/frontend/src/app/dashboard/purchases/page.tsx]
