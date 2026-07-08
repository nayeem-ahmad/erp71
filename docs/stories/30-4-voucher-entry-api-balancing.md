# Story 30.4: Voucher Entry API & Balancing Validation

Status: complete

## Story

As a Shop Owner or Manager,
I want the system to save balanced multi-line vouchers only,
so that every posted accounting transaction preserves double-entry integrity.

## Acceptance Criteria

1. Tables exist for `vouchers` and `voucher_details`. [x]
2. `POST /accounting/vouchers` creates a voucher header and two or more voucher detail rows in a single transaction. [x]
3. The API rejects vouchers where total debit does not equal total credit. [x]
4. The API rejects rows with both debit and credit populated or both zero. [x]
5. The API validates account ownership and ensures all referenced accounts belong to the current tenant. [x]
6. The API supports `cash_payment`, `cash_receive`, `bank_payment`, `bank_receive`, `fund_transfer`, and `journal` voucher types. [x]
7. Created voucher payloads return header information plus nested details for immediate UI rendering. [x]

## Tasks / Subtasks

- [x] Task 1: Database schema and transactional save path
  - [x] Add `vouchers` and `voucher_details` tables.
  - [x] Implement transactional write logic covering both header and detail rows.
  - [x] Enforce tenant-scoped uniqueness on `voucher_number`.

- [x] Task 2: Request validation
  - [x] Create DTOs for voucher header and nested detail rows.
  - [x] Validate supported voucher types and date fields.
  - [x] Validate at least two rows are present.
  - [x] Validate debit-credit balance and single-sided row entry.

- [x] Task 3: Service-level accounting rules
  - [x] Restrict voucher/account category combinations where needed, such as fund transfer requiring bank/cash accounts.
  - [x] Validate account existence inside the tenant context.
  - [x] Attach generated voucher numbers from Story 30.3.

- [x] Task 4: Automated tests
  - [x] Add happy-path tests for each voucher type.
  - [x] Add failure tests for imbalance, bad account IDs, and mixed-tenant access.

## Dev Notes

- Keep all balancing rules on the server, even if the UI also computes totals.
- This story is the financial integrity core of the epic; treat it as the authoritative posting engine for later accounting automation.
- A `Journal Voucher` should remain the least constrained type, while cash/bank and fund-transfer types may require stricter account-category rules.

## Dependencies

- Depends on Stories 30.2 and 30.3.
- Blocks Stories 30.5, 30.6, 30.7, and 30.8.

### References

- [Source: docs/prd/epic-30-financial-ledgers-accounting.md]
- [Source: docs/architecture/database-schema.md]
- [Source: docs/architecture/api-specification.md]
- [Source: docs/architecture/data-models.md]

## File List

- `packages/database/prisma/schema.prisma`
- `packages/database/migrations/05_vouchers.sql`
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

- Added persistent `vouchers` and `voucher_details` models plus SQL migration support aligned with the existing Prisma-managed Postgres conventions.
- Replaced the voucher POST stub with a real transactional create path that validates rows, checks tenant-owned accounts, generates the voucher number, and writes header plus detail rows atomically.
- Kept voucher number allocation inside the same serializable transaction as voucher persistence so failed creations do not permanently consume numbers.
- Added server-side voucher-type category rules for cash, bank, and fund-transfer workflows while leaving journal vouchers intentionally least constrained.
- Extended integration coverage to verify real voucher creation and imbalance rejection through the HTTP API.

### Tests

- Database: `cd packages/database && npm run generate`
- Backend: `cd apps/backend && npm test -- --runTestsByPath src/accounting/accounting.controller.spec.ts src/accounting/accounting.service.spec.ts test/integration.spec.ts`
- Backend full suite: `cd apps/backend && npm test`

### Test Notes

- Prisma client regenerated successfully after adding voucher and voucher detail models.
- Full backend suite passed: 13 suites, 97 tests.
- Backend test output still includes the pre-existing Node warnings about `--localstorage-file` and `url.parse()`, but all suites pass unchanged.
