# Story 30.7: General Ledger API with Running Balance

Status: complete

## Story

As a Shop Owner or Manager,
I want to retrieve an account ledger with a running balance over time,
so that I can understand how each account reached its current position.

## Acceptance Criteria

1. `GET /accounting/reports/ledger/{accountId}` returns chronologically ordered ledger entries for a selected account. [x]
2. The ledger supports filtering by date range. [x]
3. Each ledger row includes voucher reference, narration, debit, credit, and running balance. [x]
4. Opening balance is included or derivable at the start of the selected date range. [x]
5. Ledger calculations work correctly for asset, liability, equity, revenue, and expense accounts. [x]
6. The endpoint performs acceptably for large tenants and avoids N+1 account lookups. [x]

## Tasks / Subtasks

- [x] Task 1: Ledger query design
  - [x] Define the SQL or query-builder approach to fetch voucher detail lines for one account.
  - [x] Compute opening balance before the requested date range.
  - [x] Compute running balance across the returned rows.

- [x] Task 2: Ledger API implementation
  - [x] Implement the report endpoint with account and date validation.
  - [x] Return a response structure usable directly by the frontend table.
  - [x] Add guards for cross-tenant account access.

- [x] Task 3: Testing and performance
  - [x] Add tests covering positive and negative balance flows.
  - [x] Verify behavior for different account types.
  - [x] Add performance checks on realistic voucher volumes.

## Dev Notes

- Running-balance semantics must be explicitly defined by account type. If the implementation chooses one sign convention internally, normalize the output so the UI does not need accounting math knowledge.
- This story is API-focused; UI delivery is split into Story 30.8.
- Keep the query readable and testable because this endpoint becomes foundational for future Trial Balance and financial statements.

## Dependencies

- Depends on Stories 30.2 and 30.4.
- Blocks Story 30.8 and future reporting epics such as Epic 34.

### References

- [Source: docs/prd/epic-30-financial-ledgers-accounting.md]
- [Source: docs/architecture/api-specification.md]
- [Source: docs/architecture/data-models.md]

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

- Replaced the ledger placeholder route with `GET /accounting/reports/ledger/:accountId` and added tenant-scoped account validation.
- Added `ListLedgerQueryDto` with date-range filtering and shared date-range validation so invalid windows fail early.
- Implemented ledger generation from `voucher_details` plus related vouchers without N+1 account lookups by fetching the account once, aggregating opening balances once, and reading ledger rows in a single ordered query.
- Normalized running-balance semantics by account type so asset and expense accounts are debit-normal while liability, equity, and revenue accounts are credit-normal.
- Returned frontend-ready ledger payloads with opening balance, closing balance, balance sides, row narration, and debit/credit totals.
- Added unit, controller, and integration coverage for opening balances, balance-side flips, date validation, and cross-tenant access rejection.

### Tests

- Backend: `cd apps/backend && npm test -- --runTestsByPath src/accounting/accounting.controller.spec.ts src/accounting/accounting.service.spec.ts test/integration.spec.ts`
- Backend full suite: `cd apps/backend && npm test`

### Test Notes

- Focused backend ledger tests passed: 3 suites, 41 tests.
- Full backend suite passed: 13 suites, 107 tests.
- Existing backend warnings about `--localstorage-file` and `url.parse()` remain unchanged and non-blocking.
