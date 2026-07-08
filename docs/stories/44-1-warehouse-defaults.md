# Story 44.1: Warehouse Defaults and Transaction Routing

Status: drafted

## Story

As a Shop Owner or Manager,
I want configurable default warehouses for transaction flows,
so that inventory actions route to the correct location without repetitive manual selection.

## Acceptance Criteria

1. Inventory settings support default warehouses by transaction type, including product creation, purchase receipt, POS sale, shrinkage, and transfer source/destination presets. [ ]
2. Defaults can optionally vary by role where the current RBAC model supports it. [ ]
3. API responses surface effective default warehouse selection for frontend forms. [ ]
4. Existing create-purchase and create-sale flows can consume defaults without breaking explicit warehouse overrides. [ ]
5. Invalid or inactive warehouse defaults are rejected with clear errors. [ ]
6. Tests cover default resolution precedence and invalid settings behavior. [ ]

## Tasks / Subtasks

- [ ] Task 1: Settings model and resolution rules
  - [ ] Add inventory settings persistence for transaction-type warehouse defaults and optional role overrides.
  - [ ] Define precedence order between explicit selection, role default, transaction default, and store default.
  - [ ] Likely file targets: `packages/database/prisma/schema.prisma`, `packages/shared-types/index.ts`

- [ ] Task 2: Backend settings API and consumers
  - [ ] Add list/update endpoints for warehouse default settings.
  - [ ] Update product, purchase, sales, shrinkage, and stock-take forms to consume resolved defaults where relevant.
  - [ ] Likely file targets: `apps/backend/src/inventory-settings/*`, `apps/backend/src/products/products.service.ts`, `apps/backend/src/purchases/purchases.service.ts`, `apps/backend/src/sales/sales.service.ts`

- [ ] Task 3: Frontend settings UI
  - [ ] Add an inventory settings page section for default warehouse rules.
  - [ ] Surface the effective default in transactional forms while preserving manual override control.
  - [ ] Likely file targets: `apps/frontend/src/app/dashboard/inventory/settings/page.tsx`, `apps/frontend/src/app/dashboard/purchases/CreatePurchaseModal.tsx`, `apps/frontend/src/app/dashboard/inventory/page.tsx`

- [ ] Task 4: Tests
  - [ ] Add backend rule-resolution tests and frontend form-default tests.
  - [ ] Likely file targets: `apps/backend/src/inventory-settings/inventory-settings.service.spec.ts`, `apps/frontend/src/app/dashboard/inventory/settings/page.test.tsx`

## Dev Notes

- This story should not re-implement warehouse CRUD; it should configure behavior on top of Story 40.1.
- Keep override behavior explicit so operators can still select a non-default warehouse when needed.

## Dependencies

- Depends on Story 40.1 and benefits from Story 1.4 role guard patterns.
- Supports Stories 40.1, 41.1, and 42.1 operationally.

### References

- [Source: docs/prd/epic-44-inventory-settings.md]
- [Source: apps/backend/src/products/products.service.ts]
- [Source: apps/backend/src/purchases/purchases.service.ts]
