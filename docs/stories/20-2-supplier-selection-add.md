# Story 20.2: Supplier Selection & Add

Status: review

## Story

As a Shop Owner,
I want to link purchases to suppliers and add suppliers during entry,
so that procurement records stay traceable without leaving the workflow.

## Acceptance Criteria

1. A supplier data model exists for tenant-scoped supplier records. [x]
2. Users can select an existing supplier during purchase entry. [x]
3. Users can add a new supplier inline during purchase entry without leaving the modal. [x]
4. Supplier information is persisted and linked to the saved purchase. [x]

## Tasks / Subtasks

- [x] Task 1: Supplier persistence
  - [x] Add supplier schema/model support.
  - [x] Add list and create API endpoints.
- [x] Task 2: Purchase supplier linking
  - [x] Extend purchase creation payload to accept supplier selection.
  - [x] Persist supplier references on purchases.
- [x] Task 3: Inline supplier UX
  - [x] Add supplier selection input in the purchase modal.
  - [x] Add inline supplier creation fields in the modal.

## Dev Notes

- Supplier records are tenant-scoped and intentionally lightweight for Epic 20.
- Inline creation should avoid forcing a separate supplier management screen.
- Backend follows the existing Nest + Prisma service/controller split.

### Project Structure Notes

- Supplier backend code lives under `apps/backend/src/suppliers`.
- Shared supplier types belong in `packages/shared-types`.

### References

- [Source: docs/prd/epic-20-core-purchase-transactions.md]
- [Source: docs/architecture/coding-standards.md]

## Dev Agent Record

### Agent Model Used

GPT-5.4

### Debug Log References

### Completion Notes List

- ✅ Added tenant-scoped supplier persistence and API support.
- ✅ Linked purchases to supplier records.
- ✅ Added inline supplier creation to the purchase entry modal.

### File List

- packages/database/prisma/schema.prisma
- packages/shared-types/index.ts
- apps/backend/src/suppliers/suppliers.module.ts
- apps/backend/src/suppliers/suppliers.controller.ts
- apps/backend/src/suppliers/suppliers.service.ts
- apps/backend/src/suppliers/supplier.dto.ts
- apps/backend/src/suppliers/suppliers.service.spec.ts
- apps/backend/src/app.module.ts
- apps/frontend/src/app/dashboard/purchases/CreatePurchaseModal.tsx
- apps/frontend/src/lib/api.ts

### Change Log

- 2026-03-20: Created and implemented Story 20.2.
