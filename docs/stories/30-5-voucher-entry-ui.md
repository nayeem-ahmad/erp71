# Story 30.5: Voucher Entry Workbench UI

Status: complete

## Story

As a Shop Owner or Manager,
I want a guided voucher entry form with live balancing feedback,
so that I can record accounting transactions accurately without manual bookkeeping mistakes.

## Acceptance Criteria

1. A voucher entry screen exists under Accounting. [x]
2. Users can choose voucher type, date, description, and reference number. [x]
3. Users can add, remove, and edit multiple voucher rows dynamically. [x]
4. Each row supports account selection, debit, credit, and optional comment. [x]
5. The UI shows live debit total, credit total, and balance state before save. [x]
6. The form prevents submission when the voucher is unbalanced or incomplete. [x]
7. Voucher type selection narrows account options where appropriate, such as cash or bank rows for payment and receive flows. [x]
8. Successful save redirects to a voucher detail or journal confirmation state. [x]

## Tasks / Subtasks

- [x] Task 1: Voucher form shell
  - [x] Build a page-level form for voucher metadata.
  - [x] Integrate account lookup endpoints for account dropdowns.
  - [x] Display generated voucher number from Story 30.3.

- [x] Task 2: Dynamic row grid
  - [x] Implement add-row and remove-row interactions.
  - [x] Support row-level debit / credit entry with mutual exclusivity.
  - [x] Show inline validation messages for invalid rows.

- [x] Task 3: Live balancing state
  - [x] Compute debit and credit totals client-side.
  - [x] Highlight balance status clearly.
  - [x] Disable save action until required constraints are met.

- [x] Task 4: Voucher-type UX rules
  - [x] Preconfigure sensible row labels or helper text for each voucher type.
  - [x] Filter account options to cash / bank categories when relevant.
  - [x] Preserve a flexible experience for generic journal vouchers.

- [x] Task 5: Tests
  - [x] Add component or page tests for row addition, balancing feedback, and submission blocking.

## Dev Notes

- This page should follow the same dashboard design language as Sales, Purchases, and Customers rather than introducing a disconnected accounting-only UI style.
- The form should be optimized for keyboard-heavy workflows because accounting operators will enter many rows quickly.
- Keep calculations client-side for responsiveness, but rely on Story 30.4 for final validation.

## Dependencies

- Depends on Stories 30.2, 30.3, and 30.4.
- Blocks full closure of Story 30.6 because journal workflows depend on successful voucher creation.

### References

- [Source: docs/prd/epic-30-financial-ledgers-accounting.md]
- [Source: docs/front-end-spec.md]
- [Source: docs/architecture/api-specification.md]

## File List

- `apps/frontend/src/lib/api.ts`
- `apps/frontend/src/app/dashboard/accounting/vouchers/page.tsx`
- `apps/frontend/src/app/dashboard/accounting/vouchers/page.test.tsx`

## Dev Agent Record

### Agent Model Used

GPT-5.4

### Completion Notes List

- Replaced the voucher placeholder with a real workbench UI that captures voucher metadata, displays the server preview number, and lets users build multi-line entries dynamically.
- Added row-level mutual exclusivity between debit and credit, inline validation messages, and live debit/credit totals with a clear balance state.
- Implemented voucher-type guidance and account filtering rules so the first row is narrowed for cash and bank flows while fund transfers are limited to cash/bank accounts across all rows.
- Wired the form to the live voucher create API, then redirected the route into a journal confirmation state after successful save.
- Extended the frontend API wrapper with voucher create/list helpers for current and upcoming journal workflows.

### Tests

- Frontend: `cd apps/frontend && npm test -- --runTestsByPath src/app/dashboard/accounting/vouchers/page.test.tsx`
- Frontend full suite: `cd apps/frontend && npm test`

### Test Notes

- Focused voucher workbench tests passed: 1 suite, 3 tests.
- Full frontend suite passed: 9 suites, 38 tests.
- Existing frontend tests still emit pre-existing React `act(...)` warnings in login and POS coverage, plus jsdom `window.alert` warnings in POS tests, but they pass unchanged.
