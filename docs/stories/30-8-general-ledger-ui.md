# Story 30.8: General Ledger UI

Status: complete

## Story

As a Shop Owner or Manager,
I want to view the full ledger of any account with filters and running balance,
so that I can audit cash, bank, revenue, and expense movements without leaving the dashboard.

## Acceptance Criteria

1. Users can select an account and date range from the Ledger screen. [x]
2. The ledger table shows date, voucher number, voucher type, description, debit, credit, and running balance. [x]
3. The screen highlights opening balance, period movement, and closing balance. [x]
4. Users can navigate from a ledger row to the underlying voucher detail. [x]
5. Empty states and no-result filters are handled clearly. [x]
6. The ledger screen is readable on both desktop and tablet-sized layouts used in store operations. [x]

## Tasks / Subtasks

- [x] Task 1: Screen scaffold
  - [x] Build `/dashboard/accounting/ledger` page.
  - [x] Add account selector populated from the Chart of Accounts API.
  - [x] Add date-range controls.

- [x] Task 2: Ledger data presentation
  - [x] Render the API response in a searchable and readable table.
  - [x] Surface opening balance, running balance, and closing balance summary.
  - [x] Link voucher numbers to the voucher detail view from Story 30.6.

- [x] Task 3: UX polish
  - [x] Handle loading, no-account-selected, and empty-range states.
  - [x] Preserve filters in the URL or page state for repeat review workflows.

- [x] Task 4: Tests
  - [x] Add frontend tests for filter changes and ledger row rendering.

## Dev Notes

- This screen should follow the same information density and table ergonomics used in Sales and Purchase ledger-style pages.
- Export, print, and statement formatting can be deferred to a follow-up story unless immediately required.
- Keep the ledger page focused on one account at a time; cross-account statements belong to later reporting epics.

## Dependencies

- Depends on Stories 30.6 and 30.7.

### References

- [Source: docs/prd/epic-30-financial-ledgers-accounting.md]
- [Source: docs/front-end-spec.md]
- [Source: docs/architecture/api-specification.md]

## File List

- `apps/frontend/src/lib/api.ts`
- `apps/frontend/src/app/dashboard/accounting/ledger/page.tsx`
- `apps/frontend/src/app/dashboard/accounting/ledger/page.test.tsx`

## Dev Agent Record

### Agent Model Used

GPT-5.4

### Completion Notes List

- Replaced the ledger placeholder with a real `/dashboard/accounting/ledger` report screen backed by Story 30.7’s ledger API.
- Added account and date-range filters, plus URL-backed state so repeat reviews preserve the selected account and date window.
- Rendered ledger activity in a searchable table with voucher drill-down links into the journal voucher detail route.
- Surfaced selected account context, opening balance, period movement, closing balance, and period debit/credit totals in a tablet-friendly responsive layout.
- Added clear loading, no-account-selected, API-error, and empty-range states so the page stays usable across common audit workflows.

### Tests

- Frontend: `cd apps/frontend && npm test -- --runTestsByPath src/app/dashboard/accounting/ledger/page.test.tsx`
- Frontend full suite: `cd apps/frontend && npm test`

### Test Notes

- Focused frontend ledger tests passed: 1 suite, 2 tests.
- Full frontend suite passed: 12 suites, 42 tests.
- Existing frontend warnings in login and POS tests about React `act(...)` and jsdom `window.alert` remain unchanged and non-blocking.
