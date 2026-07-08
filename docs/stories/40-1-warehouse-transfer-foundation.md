# Story 40.1: Warehouse Transfer Foundation

Status: drafted

## Story

As a Shop Owner or Manager,
I want warehouse-aware transfer records and stock balances,
so that internal stock movement can be created safely and traced from source to destination.

## Acceptance Criteria

1. Prisma adds `Warehouse`, `WarehouseTransfer`, `WarehouseTransferItem`, and `InventoryMovement` support needed for warehouse-to-warehouse transfers. [ ]
2. `ProductStock` becomes warehouse-aware, with one stock row per `tenant_id + product_id + warehouse_id` instead of one stock row per product. [ ]
3. Existing product stock is backfilled into a default warehouse per store during migration or seed/bootstrap flow. [ ]
4. `POST /warehouse-transfers`, `GET /warehouse-transfers`, and `GET /warehouse-transfers/:id` exist with tenant-scoped source warehouse, destination warehouse, item, and note context. [ ]
5. Creating a transfer validates source and destination warehouse ownership, blocks same-warehouse transfers, and rejects duplicate or zero-quantity lines. [ ]
6. Creating a transfer in `SENT` state atomically decrements source stock and writes outbound `InventoryMovement` rows for each line. [ ]
7. Automated tests cover warehouse scoping, insufficient stock, and stock backfill behavior. [ ]

## Tasks / Subtasks

- [ ] Task 1: Warehouse-aware schema foundation
  - [ ] Add `Warehouse` with tenant/store relation, name, code, and active/default flags.
  - [ ] Refactor `ProductStock` to include `warehouse_id` and update uniqueness/indexing.
  - [ ] Add `WarehouseTransfer` and `WarehouseTransferItem` models with `DRAFT` and `SENT` status support.
  - [ ] Add `InventoryMovement` model with movement type, reference type/id, warehouse, quantity delta, and running metadata needed for later ledger reporting.
  - [ ] Likely file targets: `packages/database/prisma/schema.prisma`, `packages/database/prisma/seed.ts`

- [ ] Task 2: Backfill and contract alignment
  - [ ] Backfill current single-stock rows into a default warehouse so existing sales and purchases remain valid after migration.
  - [ ] Sync `packages/shared-types/index.ts` with the warehouse-aware stock model that the repo already partially assumes.
  - [ ] Add transfer DTOs and shared response types for list and detail payloads.
  - [ ] Likely file targets: `packages/shared-types/index.ts`, `apps/backend/src/warehouse-transfers/warehouse-transfer.dto.ts`

- [ ] Task 3: Backend transfer create/list/detail flow
  - [ ] Create NestJS module `warehouse-transfers` with controller, service, and tests.
  - [ ] Implement create, list, and detail endpoints with tenant-scoped includes for warehouses, products, and totals.
  - [ ] Encapsulate source-stock decrement and `InventoryMovement` creation in a transaction-safe helper reused by later inventory stories.
  - [ ] Likely file targets: `apps/backend/src/warehouse-transfers/*`, `apps/backend/src/app.module.ts`

- [ ] Task 4: Regression protection
  - [ ] Update purchase and sales stock write paths to target a warehouse-aware stock service instead of raw `productStock` assumptions.
  - [ ] Add focused tests for warehouse backfill and transfer creation failures.
  - [ ] Likely file targets: `apps/backend/src/purchases/purchases.service.ts`, `apps/backend/src/sales/sales.service.ts`, `apps/backend/test/integration.spec.ts`

## Dev Notes

- This story is the schema root for Epics 40 through 44. Do not bolt transfer logic onto the current single-stock `ProductStock` shape.
- Prefer a shared inventory movement ledger now, because transfers, shrinkage, discrepancy posting, and reporting all need the same audit backbone.
- Keep warehouse creation minimal here. Rich defaults and warehouse-rule configuration belong to Story 44.1.

## Dependencies

- Depends on Stories 10.3 and 20.3 because both currently mutate stock directly.
- Blocks Stories 40.2, 40.3, 41.1, 42.1, and 43.1.

### References

- [Source: docs/prd/epic-40-warehouse-transfers.md]
- [Source: packages/database/prisma/schema.prisma]
- [Source: apps/backend/src/sales/sales.service.ts]
- [Source: apps/backend/src/purchases/purchases.service.ts]
