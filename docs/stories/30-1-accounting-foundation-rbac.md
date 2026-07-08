# Story 30.1: Accounting Module Foundation & Access

Status: complete

## Story

As a Shop Owner or Manager,
I want the accounting module scaffolded with tenant-safe access controls and navigation entry points,
so that accounting features can be introduced incrementally without breaking the existing dashboard experience.

## Acceptance Criteria

1. An Accounting section is available in the frontend navigation instead of a "Coming Soon" placeholder. [x]
2. Backend accounting module scaffold exists with route grouping under `/accounting`. [x]
3. Accounting endpoints enforce tenant isolation and role checks consistent with existing store-scoped modules. [x]
4. Shared enums/constants exist for account type, account category, and voucher type. [x]
5. A minimal landing page for Accounting exists with links to Chart of Accounts, Voucher Entry, Journal, and Ledger. [x]
6. Feature access is limited to authorized roles such as `OWNER` and `MANAGER`. [x]

## Tasks / Subtasks

- [x] Task 1: Frontend navigation and route scaffold
  - [x] Replace the Accounting sidebar placeholder with real child routes.
  - [x] Add dashboard routes for `/dashboard/accounting`, `/dashboard/accounting/coa`, `/dashboard/accounting/vouchers`, and `/dashboard/accounting/ledger`.
  - [x] Create an accounting landing page that mirrors the dashboard card style already used in operational modules.

- [x] Task 2: Backend module scaffold
  - [x] Create NestJS accounting module, controller, and service namespaces.
  - [x] Register the accounting module in the backend app.
  - [x] Reserve route groups for accounts, vouchers, and reports.

- [x] Task 3: Authorization and tenant context
  - [x] Apply the existing auth guard / tenant resolution pattern to accounting controllers.
  - [x] Restrict write operations to `OWNER` and `MANAGER` roles.
  - [x] Add tests to confirm unauthorized users cannot access accounting endpoints.

- [x] Task 4: Shared domain constants
  - [x] Define `AccountType` values: `asset`, `liability`, `equity`, `revenue`, `expense`.
  - [x] Define `AccountCategory` values: `cash`, `bank`, `general`.
  - [x] Define `VoucherType` values: `cash_payment`, `cash_receive`, `bank_payment`, `bank_receive`, `fund_transfer`, `journal`.

## Dev Notes

- This story is intentionally thin on business logic. Its purpose is to remove the current placeholder state and give later stories stable routes, modules, and guards.
- Keep route naming aligned with the API specification under the Accounting module.
- Avoid introducing report logic here; this is only the module foundation.

## Dependencies

- Depends on completed auth / RBAC foundation from Stories 1.3 and 1.4.
- Blocks all other Epic 30 stories.

### References

- [Source: docs/prd/epic-30-financial-ledgers-accounting.md]
- [Source: docs/architecture/api-specification.md]
- [Source: docs/architecture/data-models.md]

## File List

- `packages/shared-types/index.ts`
- `apps/backend/src/app.module.ts`
- `apps/backend/src/auth/tenant-roles.decorator.ts`
- `apps/backend/src/auth/tenant-role.guard.ts`
- `apps/backend/src/accounting/accounting.module.ts`
- `apps/backend/src/accounting/accounting.controller.ts`
- `apps/backend/src/accounting/accounting.service.ts`
- `apps/backend/src/accounting/accounting.controller.spec.ts`
- `apps/frontend/src/app/dashboard/layout.tsx`
- `apps/frontend/src/components/Sidebar.tsx`
- `apps/frontend/src/components/Sidebar.test.tsx`
- `apps/frontend/src/app/dashboard/accounting/page.tsx`
- `apps/frontend/src/app/dashboard/accounting/page.test.tsx`
- `apps/frontend/src/app/dashboard/accounting/coa/page.tsx`
- `apps/frontend/src/app/dashboard/accounting/vouchers/page.tsx`
- `apps/frontend/src/app/dashboard/accounting/ledger/page.tsx`

## Dev Agent Record

### Agent Model Used

GPT-5.4

### Completion Notes List

- Replaced the frontend Accounting placeholder with a real dashboard section and reserved child routes for overview, Chart of Accounts, voucher workflows, and ledger workflows.
- Added a backend `AccountingModule` with `/accounting`, `/accounting/accounts`, `/accounting/vouchers`, and `/accounting/reports/ledger` route namespaces to anchor later stories.
- Implemented reusable tenant-role metadata and guard logic so Accounting access is limited to `OWNER` and `MANAGER` memberships.
- Added shared accounting enums for account types, account categories, and voucher types in the shared package for reuse by upcoming stories.

### Tests

- Backend: `npm test -- --runTestsByPath src/accounting/accounting.controller.spec.ts`
- Backend full suite: `npm test`
- Frontend: `npm test -- --runTestsByPath src/app/dashboard/accounting/page.test.tsx src/components/Sidebar.test.tsx`
- Frontend full suite: `npm test`

### Test Notes

- Full backend suite passed: 11 suites, 80 tests.
- Full frontend suite passed: 7 suites, 32 tests.
- Existing frontend tests still emit React `act(...)` and `window.alert` console warnings in pre-existing login and POS tests, but they pass unchanged.
