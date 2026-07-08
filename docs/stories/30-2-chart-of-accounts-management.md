# Story 30.2: Chart of Accounts Management

Status: complete

## Story

As a Shop Owner or Manager,
I want to define and manage my Chart of Accounts,
so that every financial transaction can be posted to the correct ledger account.

## Acceptance Criteria

1. Database models exist for `account_groups`, `account_subgroups`, and `accounts`. [x]
2. APIs exist to list and create account groups, subgroups, and accounts under `/accounting`. [x]
3. The account model supports `type`, `category`, optional `code`, and tenant-scoped uniqueness rules. [x]
4. Users can create asset, liability, equity, revenue, and expense accounts from the UI. [x]
5. Users can flag accounts as `cash`, `bank`, or `general` category. [x]
6. The COA screen supports search and filtering by type, group, and category. [x]
7. Seed or bootstrap logic creates a minimal default account skeleton for new tenants. [x]

## Tasks / Subtasks

- [x] Task 1: Database schema
  - [x] Add `account_groups`, `account_subgroups`, and `accounts` tables to the database schema.
  - [x] Enforce unique constraints for tenant-scoped group names, subgroup names within a group, and account names.
  - [x] Add indexes on tenant and group foreign keys.

- [x] Task 2: Backend CRUD APIs
  - [x] Implement `GET/POST /accounting/account-groups`.
  - [x] Implement `GET/POST /accounting/account-subgroups`.
  - [x] Implement `GET/POST /accounting/accounts`.
  - [x] Add DTO validation for account type, category, and relation integrity.

- [x] Task 3: Default account bootstrap
  - [x] Define a minimal seed template covering cash in hand, bank, sales revenue, purchase-related liability, and owner equity.
  - [x] Create bootstrap logic that can initialize a tenant without duplicating accounts on rerun.

- [x] Task 4: Frontend COA page
  - [x] Build a management screen for groups, subgroups, and accounts.
  - [x] Add inline or modal forms for creating each entity.
  - [x] Show hierarchical relationships clearly while preserving efficient list behavior.
  - [x] Add filters and search compatible with the shared table patterns used elsewhere in the dashboard.

## Dev Notes

- The architecture docs already define the required tables and field names; stay consistent with those names to avoid drift.
- Default account bootstrap is important because later voucher stories assume at least one cash and one bank-capable account exist.
- Do not bundle account editing or deactivation unless needed for the initial workflow; create/update is sufficient for MVP delivery.

## Dependencies

- Depends on Story 30.1.
- Blocks Stories 30.4, 30.5, 30.6, 30.7, and 30.8.

### References

- [Source: docs/prd/epic-30-financial-ledgers-accounting.md]
- [Source: docs/architecture/database-schema.md]
- [Source: docs/architecture/data-models.md]
- [Source: docs/architecture/api-specification.md]

## File List

- `packages/database/prisma/schema.prisma`
- `packages/database/migrations/03_accounting_coa.sql`
- `packages/database/prisma/bootstrap-accounting.ts`
- `packages/database/prisma/seed.ts`
- `packages/database/index.ts`
- `apps/backend/src/auth/auth.service.ts`
- `apps/backend/src/accounting/accounting.dto.ts`
- `apps/backend/src/accounting/accounting.controller.ts`
- `apps/backend/src/accounting/accounting.service.ts`
- `apps/backend/src/accounting/accounting.controller.spec.ts`
- `apps/backend/src/accounting/accounting.service.spec.ts`
- `apps/backend/src/accounting/bootstrap-accounting.spec.ts`
- `apps/backend/test/integration.spec.ts`
- `apps/frontend/src/lib/api.ts`
- `apps/frontend/src/app/dashboard/accounting/coa/page.tsx`
- `apps/frontend/src/app/dashboard/accounting/coa/page.test.tsx`

## Dev Agent Record

### Agent Model Used

GPT-5.4

### Completion Notes List

- Added persistent Chart of Accounts data models for groups, subgroups, and accounts, with Prisma table mapping aligned to the SQL migration used by the test database.
- Implemented tenant-scoped accounting CRUD endpoints and validation for type/category integrity, duplicate prevention, and group/subgroup ownership.
- Centralized default accounting bootstrap logic so seeded tenants and new store setups both receive the same minimal account skeleton idempotently.
- Replaced the COA placeholder page with a working management screen that supports creation flows and filtering by group, type, and category.
- Repaired the backend e2e harness so new accounting tables are created before integration tests run, preventing store setup regressions.

### Tests

- Database: `cd packages/database && npm run generate`
- Backend: `cd apps/backend && npm test -- --runTestsByPath src/accounting/accounting.controller.spec.ts src/accounting/accounting.service.spec.ts src/accounting/bootstrap-accounting.spec.ts`
- Backend full suite: `cd apps/backend && npm test`
- Frontend: `cd apps/frontend && npm test -- --runTestsByPath src/app/dashboard/accounting/coa/page.test.tsx`
- Frontend full suite: `cd apps/frontend && npm test`

### Test Notes

- Prisma client regenerated successfully after adding table mappings for the new accounting models.
- Full backend suite passed: 13 suites, 86 tests.
- Full frontend suite passed: 8 suites, 35 tests.
- Existing frontend tests still emit pre-existing React `act(...)` warnings in login and POS coverage, plus jsdom `window.alert` warnings in POS tests, but they pass unchanged.
