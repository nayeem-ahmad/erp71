# Story 4.2: Interactive Executive Dashboard UI

Status: drafted

## Story

As a Shop Owner or Manager,
I want an executive landing page with KPI tiles, charts, and quick actions,
so that I can understand business health and act on it immediately after login.

## Acceptance Criteria

1. The main dashboard landing page displays KPI tiles, a revenue trend chart, and quick actions backed by the aggregation API. [ ]
2. The dashboard supports loading, empty, and error states without breaking the rest of the shell. [ ]
3. Quick actions route to the relevant flows for sale, stock entry, and expense recording. [ ]
4. The layout works on desktop and tablet widths and remains consistent with the existing dashboard design language. [ ]
5. Users can refresh the dashboard state without a full page reload. [ ]
6. Automated frontend tests cover summary rendering, quick actions, and empty-state behavior. [ ]

## Tasks / Subtasks

- [ ] Task 1: Dashboard page composition
  - [ ] Replace the current placeholder dashboard landing page with a data-driven executive view.
  - [ ] Add KPI tiles, trend visualization, and quick action cards.
  - [ ] Likely file targets: `apps/frontend/src/app/dashboard/page.tsx`, `apps/frontend/src/lib/api.ts`

- [ ] Task 2: Reusable dashboard components
  - [ ] Add small, reusable components for KPI cards, chart shells, and quick action blocks.
  - [ ] Keep styling aligned with the repo’s current dashboard patterns instead of introducing a separate visual system.
  - [ ] Likely file targets: `apps/frontend/src/components/dashboard/*`

- [ ] Task 3: Frontend tests
  - [ ] Add page-level tests for loading, empty, and populated summary states.
  - [ ] Likely file targets: `apps/frontend/src/app/dashboard/page.test.tsx`

## Dev Notes

- Use the existing sidebar and dashboard shell rather than building a separate landing experience.
- The quick actions should navigate to real implemented flows: POS, purchases or inventory, and expenses once available.
- Keep the first version intentionally thin on personalization; widget customization can follow after the core summary is stable.

## Dependencies

- Depends on Story 4.1.
- Blocks Story 4.3.

### References

- [Source: docs/prd/epic-04-main-executive-dashboard.md]
- [Source: apps/frontend/src/components/Sidebar.tsx]
