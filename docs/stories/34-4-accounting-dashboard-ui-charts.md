# Story 34.4: Accounting Dashboard Charts and Comparisons

Status: complete

## Story

As a Shop Owner or Manager,
I want the accounting dashboard to visualize financial movement over time,
so that I can quickly spot cash-flow changes and profit trends instead of reading only static KPI totals.

## Acceptance Criteria

1. The dashboard shows a chart for cash inflow versus outflow over a selected period. [x]
2. The dashboard shows a comparison view for net profit versus gross margin. [x]
3. Chart data is sourced from the backend KPI or trend API rather than computed only in the browser. [x]
4. The chart section degrades gracefully when the tenant has little or no accounting activity. [x]
5. Frontend tests cover chart-section rendering and empty-state handling. [x]

## Tasks / Subtasks

- [x] Task 1: Trend data contract
  - [x] Define the backend response shape needed for time-series accounting charts.
  - [x] Decide whether trend data extends the KPI endpoint or uses a dedicated dashboard trend route.

- [x] Task 2: Backend and frontend implementation
  - [x] Implement the trend-data endpoint if needed.
  - [x] Add chart components to the dashboard using the repo’s existing frontend stack.
  - [x] Present gross margin and net profit with clear labels and timeframe context.

- [x] Task 3: Tests
  - [x] Add backend tests for trend aggregation when introduced.
  - [x] Add frontend tests for chart and empty-state rendering.

## Dev Notes

- Keep charting choices lightweight and consistent with the existing dashboard rather than introducing a heavy visualization dependency without need.
- If the repo currently lacks cost-of-goods data needed for a trustworthy gross-margin calculation, narrow this story explicitly before implementation instead of faking the metric.
- This story may require clarification around gross margin inputs if purchase-cost linkage is incomplete.

## Dependencies

- Depends on Story 34.3.
- May require clarification on gross margin data availability before implementation.

### References

- [Source: docs/prd/epic-34-accounting-dashboard.md]
- [Source: docs/prd.md]
- [Source: docs/architecture/testing-strategy.md]

## File List

- `apps/backend/src/accounting/accounting.dto.ts`
- `apps/backend/src/accounting/accounting.controller.ts`
- `apps/backend/src/accounting/accounting.service.ts`
- `apps/backend/src/accounting/accounting.controller.spec.ts`
- `apps/backend/src/accounting/accounting.service.spec.ts`
- `apps/backend/test/integration.spec.ts`
- `apps/frontend/src/lib/api.ts`
- `apps/frontend/src/app/dashboard/page.tsx`
- `apps/frontend/src/app/dashboard/page.test.tsx`

## Dev Agent Record

### Agent Model Used

GPT-5.4

### Completion Notes List

- Added a dedicated tenant-scoped backend trend endpoint at `/accounting/dashboard/trends` rather than overloading the KPI route, keeping the chart contract explicit and simple.
- The trend response now returns daily cash inflow, cash outflow, gross revenue, operating expense, and net profit points for the selected period, plus a comparison summary for the same window.
- Implemented the dashboard chart using lightweight native layout primitives instead of introducing a new charting dependency.
- Narrowed gross margin deliberately: the comparison card shows gross margin as unavailable because the current schema does not track a trustworthy sale-time cost basis, and the backend communicates that explicitly rather than inventing numbers.
- Added an empty-state chart path so tenants with no posted accounting movement still see a stable dashboard section instead of a broken or misleading graph.

### Tests

- Backend focused: `cd /Users/bs01621/Projects/nayeem/retail/apps/backend && npm test -- --runTestsByPath src/accounting/accounting.service.spec.ts src/accounting/accounting.controller.spec.ts test/integration.spec.ts`
- Frontend focused: `cd /Users/bs01621/Projects/nayeem/retail/apps/frontend && npm test -- --runTestsByPath src/app/dashboard/page.test.tsx`
- Backend full suite: `cd /Users/bs01621/Projects/nayeem/retail/apps/backend && npm test`
- Frontend full suite: `cd /Users/bs01621/Projects/nayeem/retail/apps/frontend && npm test`

### Test Notes

- Focused backend coverage passed: 3 suites, 54 tests.
- Full backend suite passed: 13 suites, 120 tests.
- Focused frontend dashboard tests passed: 1 suite, 2 tests.
- Full frontend suite passed: 13 suites, 44 tests.
- Existing frontend warnings in login and POS tests about React `act(...)` and jsdom `window.alert` remain unchanged and non-blocking.
