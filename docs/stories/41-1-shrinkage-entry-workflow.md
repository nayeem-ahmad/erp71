# Story 41.1: Shrinkage Entry Workflow

Status: drafted

## Story

As a Shop Owner or Manager,
I want to record lost, damaged, or stolen stock against a warehouse,
so that shrinkage is removed from available inventory and documented separately from sales and returns.

## Acceptance Criteria

1. A tenant-scoped shrinkage record can be created for a warehouse with one or more product lines, quantities, notes, and a reason code. [ ]
2. Shrinkage posting atomically decrements warehouse stock and writes negative `InventoryMovement` rows tagged as `SHRINKAGE`. [ ]
3. The API blocks zero or negative quantities, duplicate product lines, and quantities above available stock. [ ]
4. A dashboard screen exists for creating and listing shrinkage records. [ ]
5. Shrinkage records remain distinct from sales returns, purchase returns, and stock-take adjustments in list and detail views. [ ]
6. Tests cover insufficient stock, tenant scoping, and successful stock decrement behavior. [ ]

## Tasks / Subtasks

- [ ] Task 1: Shrinkage data model and DTOs
  - [ ] Add shrinkage header and line-item persistence, or a typed inventory-adjustment structure if that abstraction is shared with stock takes.
  - [ ] Add create/list/detail DTOs and response contracts.
  - [ ] Likely file targets: `packages/database/prisma/schema.prisma`, `packages/shared-types/index.ts`, `apps/backend/src/inventory-shrinkage/inventory-shrinkage.dto.ts`

- [ ] Task 2: Backend posting flow
  - [ ] Create NestJS module for shrinkage create/list/detail behavior.
  - [ ] Reuse the warehouse-aware stock service and movement writer from Epic 40.
  - [ ] Enforce warehouse and product scoping within the active tenant.
  - [ ] Likely file targets: `apps/backend/src/inventory-shrinkage/*`, `apps/backend/src/app.module.ts`

- [ ] Task 3: Frontend entry and list UI
  - [ ] Add shrinkage list page with shared table behavior.
  - [ ] Add create modal or dedicated page optimized for quick warehouse and product selection.
  - [ ] Show reason, warehouse, total quantity, and created date in the ledger view.
  - [ ] Likely file targets: `apps/frontend/src/app/dashboard/inventory/shrinkage/page.tsx`, `apps/frontend/src/lib/api.ts`, `apps/frontend/src/components/Sidebar.tsx`

- [ ] Task 4: Tests
  - [ ] Add backend service/controller tests.
  - [ ] Add frontend interaction coverage for invalid quantity and submission success states.
  - [ ] Likely file targets: `apps/backend/src/inventory-shrinkage/inventory-shrinkage.service.spec.ts`, `apps/frontend/src/app/dashboard/inventory/shrinkage/page.test.tsx`

## Dev Notes

- Prefer a shared movement infrastructure over a shrinkage-specific stock mutation path.
- If a generic `inventory_adjustments` backbone is introduced, keep the route, UI copy, and reporting semantics shrinkage-specific.
- Reason catalog management is deepened in Story 44.2, but this story should still work with seeded defaults.

## Dependencies

- Depends on Story 40.1.
- Blocks Stories 41.3 and 43.1.

### References

- [Source: docs/prd/epic-41-lost-stolen-products.md]
- [Source: apps/backend/src/purchase-returns/purchase-returns.service.ts]
- [Source: apps/frontend/src/app/dashboard/purchase-returns/page.tsx]
