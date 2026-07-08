# Story 20.3: Transactional Inventory Updates

Status: review

## Story

As a Shop Owner,
I want purchase posting to increment inventory atomically,
so that stock levels stay accurate whenever incoming items are recorded.

## Acceptance Criteria

1. A purchase API creates a persisted purchase record and related line items. [x]
2. Saving a purchase atomically increments product stock for every received item. [x]
3. New stock rows are created automatically when a purchased product has no stock row yet. [x]
4. Automated tests cover purchase persistence and stock increment behavior. [x]

## Tasks / Subtasks

- [x] Task 1: Purchase transaction service
  - [x] Add Prisma models for purchases and purchase items.
  - [x] Add NestJS purchase service/controller/module.
- [x] Task 2: Atomic stock updates
  - [x] Persist purchases and line items inside a transaction.
  - [x] Upsert or increment product stock records inside the same transaction.
- [x] Task 3: Test coverage
  - [x] Add purchase service unit tests.
  - [x] Extend integration coverage for the purchase API path.

## Dev Notes

- Purchase creation should mirror the transactional guarantees already used in Sales, but with stock increments.
- The current schema uses a single stock row per product, so stock updates should respect the existing `ProductStock` uniqueness constraint.
- Avoid raw queries; use Prisma transaction APIs.

### Project Structure Notes

- Purchase backend code lives under `apps/backend/src/purchases`.
- Integration coverage stays in `apps/backend/test/integration.spec.ts`.

### References

- [Source: docs/architecture/data-models.md]
- [Source: apps/backend/src/sales/sales.service.ts]

## Dev Agent Record

### Agent Model Used

GPT-5.4

### Debug Log References

### Completion Notes List

- ✅ Added purchase and purchase item persistence using Prisma transactions.
- ✅ Implemented atomic stock increment behavior, including missing stock row creation.
- ✅ Added unit and integration test coverage for purchase posting.

### File List

- packages/database/prisma/schema.prisma
- apps/backend/src/purchases/purchases.module.ts
- apps/backend/src/purchases/purchases.controller.ts
- apps/backend/src/purchases/purchases.service.ts
- apps/backend/src/purchases/purchase.dto.ts
- apps/backend/src/purchases/purchases.service.spec.ts
- apps/backend/test/integration.spec.ts

### Change Log

- 2026-03-20: Created and implemented Story 20.3.
