# Story 30.3: Tenant-Specific Voucher Numbering

Status: complete

## Story

As a Shop Owner or Manager,
I want voucher numbers to be generated automatically by voucher type,
so that my accounting records remain sequential, auditable, and easy to reference.

## Acceptance Criteria

1. Each voucher receives a tenant-specific sequential number at creation time. [x]
2. Numbering is segmented by voucher type using prefixes such as `CP`, `CR`, `BP`, `BR`, `FT`, and `JV`. [x]
3. Voucher numbers are unique per tenant even under concurrent create requests. [x]
4. Users can view the generated number before final save confirmation in the voucher entry workflow. [x]
5. Failed voucher creation does not permanently consume sequence numbers unless explicitly accepted by the implementation design. [x]

## Tasks / Subtasks

- [x] Task 1: Sequence strategy design
  - [x] Decide whether numbering is backed by a dedicated sequence table, database function, or transactional locking strategy.
  - [x] Document the prefix mapping for each voucher type.
  - [x] Define formatting rules such as zero-padding width.

- [x] Task 2: Backend generation logic
  - [x] Implement voucher-number generation in the create-voucher transaction path.
  - [x] Ensure the uniqueness guarantee survives concurrent requests.
  - [x] Add tests for same-tenant concurrency and cross-tenant independence.

- [x] Task 3: Frontend preview behavior
  - [x] Display the next voucher number or reserved generated number in the voucher form.
  - [x] Keep the displayed number in sync when the voucher type changes.

## Dev Notes

- This story should be delivered before the voucher entry UI is considered complete, because the voucher number is part of the primary accounting identity.
- A database-backed approach is preferable over frontend-derived numbering.
- If the product later needs editable voucher numbers, keep the internal generated number authoritative and treat manual overrides as a controlled enhancement.

## Dependencies

- Depends on Story 30.1.
- Should be completed before Stories 30.4 and 30.5 are closed.

### References

- [Source: docs/prd/epic-30-financial-ledgers-accounting.md]
- [Source: docs/architecture/database-schema.md]
- [Source: docs/architecture/data-models.md]

## File List

- `packages/database/prisma/schema.prisma`
- `packages/database/migrations/04_voucher_sequences.sql`
- `apps/backend/src/accounting/accounting.dto.ts`
- `apps/backend/src/accounting/accounting.controller.ts`
- `apps/backend/src/accounting/accounting.service.ts`
- `apps/backend/src/accounting/accounting.controller.spec.ts`
- `apps/backend/src/accounting/accounting.service.spec.ts`
- `apps/backend/test/integration.spec.ts`
- `apps/frontend/src/lib/api.ts`
- `apps/frontend/src/app/dashboard/accounting/vouchers/page.tsx`
- `apps/frontend/src/app/dashboard/accounting/vouchers/page.test.tsx`

## Dev Agent Record

### Agent Model Used

GPT-5.4

### Completion Notes List

- Added a dedicated `voucher_sequences` table and Prisma model so voucher numbering is tenant-scoped, type-scoped, and backed by durable database state.
- Implemented prefix-based voucher number preview and generation logic with serializable transactions plus retry handling for transaction conflicts.
- Added backend route support for `GET /accounting/vouchers/next-number` and surfaced prefix metadata through the accounting voucher namespace.
- Updated the voucher entry page to fetch and refresh the displayed number whenever the selected voucher type changes.
- Extended integration coverage to verify same-tenant concurrency and cross-tenant sequence independence with the real application container.

### Tests

- Database: `cd packages/database && npm run generate`
- Backend: `cd apps/backend && npm test -- --runTestsByPath src/accounting/accounting.controller.spec.ts src/accounting/accounting.service.spec.ts test/integration.spec.ts`
- Backend full suite: `cd apps/backend && npm test`
- Frontend: `cd apps/frontend && npm test -- --runTestsByPath src/app/dashboard/accounting/vouchers/page.test.tsx`
- Frontend full suite: `cd apps/frontend && npm test`

### Test Notes

- Prisma client regenerated successfully after adding the `VoucherSequence` model.
- Full backend suite passed: 13 suites, 92 tests.
- Full frontend suite passed: 9 suites, 36 tests.
- Existing frontend tests still emit pre-existing React `act(...)` warnings in login and POS coverage, plus jsdom `window.alert` warnings in POS tests, but they pass unchanged.
