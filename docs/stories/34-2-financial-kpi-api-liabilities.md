# Story 34.2: Financial KPI API Receivables, Payables, and Tax Liability

Status: complete

## Story

As a Shop Owner or Manager,
I want the accounting dashboard API to expose receivable, payable, and tax liability metrics,
so that I can understand short-term obligations and what is owed to or by the business.

## Acceptance Criteria

1. The dashboard API exposes receivable and payable balances derived from ledger accounts. [x]
2. The dashboard API exposes tax or VAT liability totals using configured liability accounts when present. [x]
3. Missing optional liability accounts are handled gracefully without breaking the dashboard response. [x]
4. KPI calculations remain tenant-scoped and date-aware where applicable. [x]
5. Tests cover cases where liabilities are absent, zero, or net-negative after adjustments. [x]

## Tasks / Subtasks

- [x] Task 1: Liability metric definitions
  - [x] Define how receivables, payables, and tax liabilities are identified from the Chart of Accounts.
  - [x] Decide how the API represents unavailable metrics when a tenant has not configured the relevant accounts.

- [x] Task 2: Backend implementation
  - [x] Extend the financial KPI endpoint or service with receivable, payable, and tax liability metrics.
  - [x] Normalize balances so the frontend can render them without additional accounting math.

- [x] Task 3: Tests
  - [x] Add calculation coverage for liability-normal accounts.
  - [x] Add integration coverage for tenants with and without matching liability accounts.

## Dev Notes

- This story should not hard-code a single account name if account code or category patterns provide a safer implementation.
- If the current default accounting bootstrap lacks dedicated AR, AP, or tax accounts, document the fallback behavior explicitly in the response and tests.
- Keep the endpoint contract backward-compatible with Story 34.1.

## Dependencies

- Depends on Story 34.1.
- Blocks Stories 34.3 and 34.4.

### References

- [Source: docs/prd/epic-34-accounting-dashboard.md]
- [Source: docs/prd.md]
- [Source: docs/brainstorming-session-results.md]

## File List

- `apps/backend/src/accounting/accounting.service.ts`
- `apps/backend/src/accounting/accounting.controller.spec.ts`
- `apps/backend/src/accounting/accounting.service.spec.ts`
- `apps/backend/test/integration.spec.ts`

## Dev Agent Record

### Agent Model Used

GPT-5.4

### Completion Notes List

- Extended the existing `GET /accounting/dashboard/kpis` response with `accounts_receivable`, `accounts_payable`, and `tax_liability` fields while keeping Story 34.1’s contract backward-compatible.
- Implemented name/code-based account matching so receivable, payable, and tax accounts can be recognized from tenant-specific Charts of Accounts without introducing new schema fields.
- Excluded tax-tagged liability accounts from the generic payable metric so `VAT Payable` contributes only to `tax_liability` rather than double-counting in payables.
- Normalized balances using account-type semantics so receivables are positive on debit-normal balances and payables/tax liabilities are positive on credit-normal balances.
- Documented and implemented graceful fallback behavior: when matching receivable or tax accounts are not configured, the endpoint returns `null`; when a matching payable account exists but has no activity, it returns `0`.
- Added tests covering configured metrics, missing optional accounts, and net-negative receivable adjustments.

### Tests

- Backend: `cd apps/backend && npm test -- --runTestsByPath src/accounting/accounting.controller.spec.ts src/accounting/accounting.service.spec.ts test/integration.spec.ts`
- Backend full suite: `cd apps/backend && npm test`

### Test Notes

- Focused backend liability KPI tests passed: 3 suites, 51 tests.
- Full backend suite passed: 13 suites, 117 tests.
- Existing backend warnings about `--localstorage-file` and `url.parse()` remain unchanged and non-blocking.
