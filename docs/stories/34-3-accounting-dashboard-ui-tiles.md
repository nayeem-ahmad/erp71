# Story 34.3: Accounting Dashboard UI KPI Tiles

Status: complete

## Story

As a Shop Owner or Manager,
I want the main dashboard to surface accounting KPI tiles,
so that I can see the financial position of the business immediately after signing in.

## Acceptance Criteria

1. The main dashboard displays accounting KPI tiles sourced from the financial KPI API. [x]
2. Tiles show at minimum cash movement, gross revenue, operating expense, receivables, payables, and tax liability. [x]
3. The UI handles loading, partial-data, and error states clearly. [x]
4. KPI values remain readable on desktop and tablet-sized dashboard layouts. [x]
5. Dashboard tiles do not break existing sales and inventory widgets. [x]
6. Frontend tests cover successful rendering and empty or unavailable metrics. [x]

## Tasks / Subtasks

- [x] Task 1: Dashboard composition
  - [x] Decide where accounting KPIs fit on the existing `/dashboard` page.
  - [x] Preserve the current dashboard information hierarchy while adding financial visibility.

- [x] Task 2: Frontend implementation
  - [x] Add API helpers and page-loading logic for the accounting KPI endpoint.
  - [x] Render a consistent KPI tile grid with value, label, and supporting context.
  - [x] Handle unavailable liability metrics without collapsing the entire section.

- [x] Task 3: Tests
  - [x] Add page tests for KPI tile rendering.
  - [x] Add coverage for loading and degraded states.

## Dev Notes

- Extend the existing main dashboard page rather than creating a parallel accounting dashboard route unless a later story explicitly requires it.
- Keep the first slice focused on tiles and summary cards; charts belong to the follow-up story.
- Reuse established dashboard card styling where practical.

## Dependencies

- Depends on Stories 34.1 and 34.2.
- Blocks Story 34.4.

### References

- [Source: docs/prd/epic-34-accounting-dashboard.md]
- [Source: docs/architecture/frontend-architecture.md]
- [Source: apps/frontend/src/app/dashboard/page.tsx]

## File List

- `apps/frontend/src/lib/api.ts`
- `apps/frontend/src/app/dashboard/page.tsx`
- `apps/frontend/src/app/dashboard/page.test.tsx`

## Dev Agent Record

### Agent Model Used

GPT-5.4

### Completion Notes List

- Extended the existing main dashboard page rather than creating a separate accounting dashboard route, keeping the new financial view inside the established landing workflow.
- Added a frontend `getFinancialKpis` helper and fixed the previously malformed ledger helper block in the shared API client while touching the accounting section.
- Added a dedicated financial snapshot section that renders KPI tiles for net cash movement, gross revenue, operating expense, receivables, payables, and tax liability.
- Implemented clear loading placeholders, degraded-state messaging when the KPI API fails, and `Not configured` fallback rendering when optional accounting metrics are unavailable.
- Preserved the existing sales summary cards, recent activity feed, and inventory overview so the dashboard remains additive rather than disruptive.

### Tests

- Frontend: `cd apps/frontend && npm test -- --runTestsByPath src/app/dashboard/page.test.tsx`
- Frontend full suite: `cd apps/frontend && npm test`

### Test Notes

- Focused frontend dashboard tests passed: 1 suite, 2 tests.
- Full frontend suite passed: 13 suites, 44 tests.
- Existing frontend warnings in login and POS tests about React `act(...)` and jsdom `window.alert` remain unchanged and non-blocking.
