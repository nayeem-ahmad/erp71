# Story 21.1: Purchase Return Schema & API Foundation

Status: review

## Story

As a Backend System,
I want foundational purchase return models and CRUD endpoints,
so that supplier return records can be created, listed, and maintained consistently.

## Acceptance Criteria

1. `PurchaseReturn` and `PurchaseReturnItem` models exist in Prisma and link to `Purchase`, `Supplier`, and `Product`. [x]
2. `POST /purchase-returns` accepts `purchase_id`, return items, quantities, and return-level metadata such as notes or reference number. [x]
3. `GET /purchase-returns` and `GET /purchase-returns/:id` return list and detail views with supplier and original purchase context. [x]
4. `PATCH /purchase-returns/:id` and `DELETE /purchase-returns/:id` exist for return maintenance flows. [x]
5. Shared DTOs and response contracts exist for frontend consumption. [x]

## Tasks / Subtasks

- [x] Task 1: Schema and relations
  - [x] Add Prisma models and relations for `PurchaseReturn` and `PurchaseReturnItem`.
  - [x] Wire reverse relations from `Tenant`, `Store`, `Purchase`, `PurchaseItem`, `Supplier`, and `Product` if needed for list/detail includes.
  - [x] Ensure schema changes remain additive and backward compatible.
  - [x] Likely file targets: `packages/database/prisma/schema.prisma`
- [x] Task 2: DTOs and contracts
  - [x] Create create and update DTOs with nested item support.
  - [x] Define return item payload fields for `purchaseItemId`, `productId`, `quantity`, and optional reason or note metadata.
  - [x] Add shared response types for purchase-return list/detail payloads used by the frontend.
  - [x] Likely file targets: `apps/backend/src/purchase-returns/purchase-return.dto.ts`, `packages/shared-types/index.ts`
- [x] Task 3: NestJS module scaffolding
  - [x] Implement controller, service, and module for purchase returns.
  - [x] Add list and detail includes matching the purchase and sales-return patterns.
  - [x] Register the module in the backend app module if the repo still wires modules centrally.
  - [x] Expose create, list, detail, update, and delete endpoints with tenant-scoped queries.
  - [x] Likely file targets: `apps/backend/src/purchase-returns/purchase-returns.module.ts`, `apps/backend/src/purchase-returns/purchase-returns.controller.ts`, `apps/backend/src/purchase-returns/purchase-returns.service.ts`, `apps/backend/src/app.module.ts`

## Dev Notes

- **Dependencies:** Depends on Epic 20 purchase persistence and supplier linking.
- **Scope Boundary:** This story establishes the purchase return record shape and baseline CRUD surface. Deep quantity and stock reversal rules are split into Story 21.2.
- **Consistency:** Follow the service/controller/module layout already used in `sales-returns`, `purchases`, and `sales-orders`.

### Project Structure Notes

- Backend code should live under `apps/backend/src/purchase-returns`.
- Shared schema and contract work should stay in `packages/database/prisma` and `packages/shared-types`.

### References

- [Source: docs/prd/epic-21-purchase-returns-management.md]
- [Source: docs/architecture/backend-architecture.md]
- [Source: apps/backend/src/purchases/purchases.service.ts]

## Dev Agent Record

### Agent Model Used

GPT-5.4

### Completion Notes List

- Added `PurchaseReturn` and `PurchaseReturnItem` Prisma models plus the reverse relations needed for tenant-scoped list and detail queries.
- Implemented the NestJS purchase returns module, DTOs, controller, and service with create, list, detail, update, and delete endpoints.
- Added shared purchase-return types and a service unit test suite covering create, update, fetch, and delete behaviors.

### File List

- packages/database/prisma/schema.prisma
- packages/shared-types/index.ts
- apps/backend/src/app.module.ts
- apps/backend/src/purchase-returns/purchase-return.dto.ts
- apps/backend/src/purchase-returns/purchase-returns.controller.ts
- apps/backend/src/purchase-returns/purchase-returns.module.ts
- apps/backend/src/purchase-returns/purchase-returns.service.ts
- apps/backend/src/purchase-returns/purchase-returns.service.spec.ts

### Change Log

- 2026-03-20: Implemented Story 21.1 purchase return schema and API foundation.

