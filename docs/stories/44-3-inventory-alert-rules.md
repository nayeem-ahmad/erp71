# Story 44.3: Inventory Alert Rules and Threshold Settings

Status: drafted

## Story

As a Shop Owner or Manager,
I want configurable inventory alert rules,
so that low-stock warnings, reorder suggestions, and discrepancy approvals follow store policy.

## Acceptance Criteria

1. Inventory settings support global defaults and product-level overrides for reorder level, safety stock, lead time days, and discrepancy approval threshold. [ ]
2. Alert-rule data is available to reorder suggestion and stock-take approval logic through a stable backend contract. [ ]
3. Settings changes do not retroactively mutate historical records, only future recommendations and approvals. [ ]
4. The product create/edit flow can display and optionally override default alert rules. [ ]
5. Invalid numeric settings are rejected with clear validation errors. [ ]
6. Tests cover fallback behavior, override precedence, and invalid input. [ ]

## Tasks / Subtasks

- [ ] Task 1: Rule schema and shared contracts
  - [ ] Reconcile current shared-type assumptions such as `reorder_level` with the active Prisma schema.
  - [ ] Add settings storage for global defaults and product override fields.
  - [ ] Likely file targets: `packages/database/prisma/schema.prisma`, `packages/shared-types/index.ts`

- [ ] Task 2: Backend settings and consumers
  - [ ] Add update/read endpoints for alert rules.
  - [ ] Wire reorder suggestion and stock-take approval flows to the resolved rule set.
  - [ ] Likely file targets: `apps/backend/src/inventory-settings/*`, `apps/backend/src/inventory-reports/inventory-reports.service.ts`, `apps/backend/src/stock-takes/stock-takes.service.ts`

- [ ] Task 3: Frontend settings and product forms
  - [ ] Add alert-rule controls to inventory settings.
  - [ ] Extend add/edit product forms with optional override fields or linked settings display.
  - [ ] Likely file targets: `apps/frontend/src/app/dashboard/inventory/settings/page.tsx`, `apps/frontend/src/app/dashboard/inventory/AddProductModal.tsx`, `apps/frontend/src/app/dashboard/inventory/page.tsx`

- [ ] Task 4: Tests
  - [ ] Add backend precedence tests and frontend settings form coverage.
  - [ ] Likely file targets: `apps/backend/src/inventory-settings/inventory-settings.service.spec.ts`, `apps/frontend/src/app/dashboard/inventory/settings/page.test.tsx`

## Dev Notes

- Do not bury critical thresholds in frontend-only state. The backend must resolve the effective rule set for consistent reporting and approvals.
- If product overrides are not shipped immediately, the API contract should still reserve that capability cleanly.

## Dependencies

- Depends on Story 45.3 only if category-specific alert rules are introduced later; otherwise standalone.
- Blocks Story 43.2 and strengthens Story 42.3.

### References

- [Source: docs/prd/epic-44-inventory-settings.md]
- [Source: packages/shared-types/index.ts]
