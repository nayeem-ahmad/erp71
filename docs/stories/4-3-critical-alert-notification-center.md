# Story 4.3: Dashboard Critical Alert Center

Status: drafted

## Story

As a Shop Owner or Manager,
I want a consolidated dashboard alert center,
so that urgent issues across stock, returns, approvals, and deliveries are visible in one place.

## Acceptance Criteria

1. The dashboard includes a “Tasks to Do” or alert center widget that lists actionable items across modules. [ ]
2. Alerts include type, severity, count or summary, and a deep link to the relevant workflow. [ ]
3. Low stock, pending returns, and future approval or fulfillment sources can plug into the same alert contract. [ ]
4. The alert center gracefully handles zero-alert state and partial data availability from still-unimplemented modules. [ ]
5. Automated tests cover alert ordering, empty state, and deep-link rendering. [ ]

## Tasks / Subtasks

- [ ] Task 1: Alert aggregation contract
  - [ ] Extend the dashboard summary API or add a dedicated alert endpoint for actionable cross-module items.
  - [ ] Normalize alert payload fields so future modules can contribute alerts without changing the UI contract.
  - [ ] Likely file targets: `apps/backend/src/dashboard/*`, `packages/shared-types/index.ts`

- [ ] Task 2: Frontend alert widget
  - [ ] Add a dashboard widget that lists prioritized alerts and routes users into the correct module screen.
  - [ ] Use clear severity styling and empty-state messaging.
  - [ ] Likely file targets: `apps/frontend/src/app/dashboard/page.tsx`, `apps/frontend/src/components/dashboard/*`

- [ ] Task 3: Tests
  - [ ] Add focused backend and frontend tests for ordering and link targets.
  - [ ] Likely file targets: `apps/backend/src/dashboard/*.spec.ts`, `apps/frontend/src/app/dashboard/page.test.tsx`

## Dev Notes

- This story should share infrastructure with Epic 05 notifications rather than inventing an incompatible alert type.
- For modules not yet implemented, return explicit empty sections or zero counts. Do not fake live operational alerts.
- Prioritize actionable alerts over informational summaries.

## Dependencies

- Depends on Stories 4.1 and 4.2.
- Align with Story 5.3 for notification payload consistency.

### References

- [Source: docs/prd/epic-04-main-executive-dashboard.md]
- [Source: apps/frontend/src/app/dashboard/page.tsx]
