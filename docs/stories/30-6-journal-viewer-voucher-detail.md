# Story 30.6: Journal Viewer & Voucher Detail

Status: complete

## Story

As a Shop Owner or Manager,
I want to review vouchers in a searchable journal and inspect full voucher details,
so that I can audit accounting activity chronologically and verify posted entries.

## Acceptance Criteria

1. `GET /accounting/vouchers` returns vouchers with filtering by date range and voucher type. [x]
2. The journal screen lists voucher number, date, type, description, and total amount. [x]
3. Users can filter the journal by voucher type and date range. [x]
4. Users can open a voucher detail view that shows all debit and credit rows. [x]
5. The journal supports pagination or server-side limits suitable for large tenants. [x]
6. Journal responses remain tenant-scoped and ordered newest-first by default. [x]

## Tasks / Subtasks

- [x] Task 1: Journal list endpoint
  - [x] Implement list query with filters for voucher type and date range.
  - [x] Include nested or summarized detail totals needed for the journal list.
  - [x] Add pagination metadata.

- [x] Task 2: Voucher detail endpoint or expanded response
  - [x] Provide a way to retrieve a single voucher with full detail rows.
  - [x] Include account display names for each row.

- [x] Task 3: Journal frontend
  - [x] Build a DataTable-based journal page aligned with the shared operational list pattern.
  - [x] Add filter controls for voucher type and date range.
  - [x] Add row action to open voucher details.

- [x] Task 4: Voucher detail frontend
  - [x] Render header metadata, narration, reference number, and line items.
  - [x] Show debit and credit columns with totals at the footer.

## Dev Notes

- The journal list should reuse the existing searchable dashboard list experience where practical.
- Do not over-scope this story into editing or reversing vouchers unless that workflow is explicitly requested later.
- Voucher detail should be printable-friendly, even if a dedicated print template comes later.

## Dependencies

- Depends on Stories 30.4 and 30.5.
- Can be built in parallel with Story 30.7 after voucher posting is stable.

### References

- [Source: docs/prd/epic-30-financial-ledgers-accounting.md]
- [Source: docs/architecture/api-specification.md]
- [Source: docs/front-end-spec.md]

## File List

- `apps/backend/src/accounting/accounting.dto.ts`
- `apps/backend/src/accounting/accounting.controller.ts`
- `apps/backend/src/accounting/accounting.service.ts`
- `apps/backend/src/accounting/accounting.controller.spec.ts`
- `apps/backend/src/accounting/accounting.service.spec.ts`
- `apps/backend/test/integration.spec.ts`
- `apps/frontend/src/lib/api.ts`
- `apps/frontend/src/components/Sidebar.tsx`
- `apps/frontend/src/app/dashboard/accounting/page.tsx`
- `apps/frontend/src/app/dashboard/accounting/journal/page.tsx`
- `apps/frontend/src/app/dashboard/accounting/journal/page.test.tsx`
- `apps/frontend/src/app/dashboard/accounting/journal/[id]/page.tsx`
- `apps/frontend/src/app/dashboard/accounting/journal/[id]/page.test.tsx`

## Dev Agent Record

### Agent Model Used

GPT-5.4

### Completion Notes List

- Upgraded `GET /accounting/vouchers` from a raw list into a tenant-scoped journal endpoint with voucher-type/date filters, computed totals, and pagination metadata.
- Added `GET /accounting/vouchers/:id` so the frontend can retrieve a single voucher with full line-item detail and account display names.
- Added a dedicated `/dashboard/accounting/journal` route for chronological journal review without colliding with the separate general-ledger stories.
- Implemented `/dashboard/accounting/journal/[id]` as a printable-friendly voucher detail view showing metadata, narration, debit/credit rows, and footer totals.
- Updated accounting navigation so Journal is reachable from both the accounting landing page and the sidebar.

### Tests

- Backend: `cd apps/backend && npm test -- --runTestsByPath src/accounting/accounting.controller.spec.ts src/accounting/accounting.service.spec.ts test/integration.spec.ts`
- Backend full suite: `cd apps/backend && npm test`
- Frontend: `cd apps/frontend && npm test -- --runTestsByPath src/app/dashboard/accounting/journal/page.test.tsx 'src/app/dashboard/accounting/journal/[id]/page.test.tsx' src/components/Sidebar.test.tsx`
- Frontend full suite: `cd apps/frontend && npm test`

### Test Notes

- Focused backend journal tests passed: 3 suites, 36 tests.
- Full backend suite passed: 13 suites, 102 tests.
- Focused frontend journal/navigation tests passed: 3 suites, 4 tests.
- Full frontend suite passed: 11 suites, 40 tests.
- Existing frontend tests still emit pre-existing React `act(...)` warnings in login and POS coverage, plus jsdom `window.alert` warnings in POS tests, but they pass unchanged.
