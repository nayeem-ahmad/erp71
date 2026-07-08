# Story 34.1: Financial KPI API Core Summaries

Status: complete

## Story

As a Shop Owner or Manager,
I want a backend endpoint that returns core accounting KPIs,
so that the dashboard can show real-time financial summaries without duplicating business logic in the frontend.

## Acceptance Criteria

1. A tenant-scoped dashboard endpoint returns accounting KPIs for a selected date range. [x]
2. The response includes cash inflow, cash outflow, net cash movement, gross revenue, and operating expense totals. [x]
3. KPI totals are derived from posted vouchers and account categories rather than duplicated dashboard-only tables. [x]
4. The endpoint validates date-range input and rejects invalid windows with a clear error. [x]
5. The query avoids N+1 ledger lookups and remains suitable for larger tenants. [x]
6. Automated tests cover positive and negative cash movement scenarios. [x]

## Tasks / Subtasks

- [x] Task 1: KPI contract and query design
  - [x] Define the response shape for core accounting KPIs.
  - [x] Map account and voucher semantics needed for inflow, outflow, revenue, and expense aggregation.
  - [x] Reuse the existing accounting posting model instead of introducing summary persistence.

- [x] Task 2: Backend implementation
  - [x] Add a tenant-scoped accounting dashboard route in the backend.
  - [x] Implement date-range validation and default range behavior.
  - [x] Aggregate voucher detail data into dashboard-ready KPI totals.

- [x] Task 3: Tests
  - [x] Add unit tests for KPI calculations.
  - [x] Add controller coverage for auth, tenant scoping, and invalid input.
  - [x] Add integration coverage using posted vouchers from the accounting module.

## Dev Notes

- Build on Epic 30 voucher and ledger data instead of introducing a second accounting source of truth.
- Keep the response stable and frontend-ready because later dashboard tiles and charts will consume it directly.
- Default the first implementation to a simple current-period window unless the API contract already defines a different dashboard period pattern.

## Dependencies

- Depends on Stories 30.4 through 30.8.
- Blocks Stories 34.3 and 34.4.

### References

- [Source: docs/prd/epic-34-accounting-dashboard.md]
- [Source: docs/prd.md]
- [Source: docs/architecture/backend-architecture.md]

## File List

- `apps/backend/src/accounting/accounting.dto.ts`
- `apps/backend/src/accounting/accounting.controller.ts`
- `apps/backend/src/accounting/accounting.service.ts`
- `apps/backend/src/accounting/accounting.controller.spec.ts`
- `apps/backend/src/accounting/accounting.service.spec.ts`
- `apps/backend/test/integration.spec.ts`

## Dev Agent Record

### Agent Model Used

GPT-5.4

### Completion Notes List

- Added `GET /accounting/dashboard/kpis` as a tenant-scoped accounting dashboard endpoint within the existing accounting module.
- Implemented a stable KPI response contract with current-month defaults and explicit `from`/`to` date-range validation.
- Derived cash inflow, cash outflow, net cash movement, gross revenue, and operating expense directly from posted voucher details plus account category/type metadata.
- Kept the query efficient by loading only the relevant account IDs once and aggregating voucher detail totals in grouped backend queries rather than performing per-account ledger lookups.
- Added automated coverage for positive and negative cash-movement scenarios, invalid date ranges, controller routing, and integration behavior against real posted vouchers.

### Tests

- Backend: `cd apps/backend && npm test -- --runTestsByPath src/accounting/accounting.controller.spec.ts src/accounting/accounting.service.spec.ts test/integration.spec.ts`
- Backend full suite: `cd apps/backend && npm test`

### Test Notes

- Focused backend KPI tests passed: 3 suites, 47 tests.
- Full backend suite passed: 13 suites, 113 tests.
- Existing backend warnings about `--localstorage-file` and `url.parse()` remain unchanged and non-blocking.
