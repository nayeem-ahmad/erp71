# Story 45.3: Product Category Assignment in Product Flows

Status: drafted

## Story

As a Shop Owner or Manager,
I want to assign a group and subgroup when creating or editing a product,
so that my inventory is categorized at the source instead of later cleanup.

## Acceptance Criteria

1. Product create and edit APIs accept optional `groupId` and `subgroupId` fields. [ ]
2. The backend validates that the subgroup belongs to the selected group and the current tenant. [ ]
3. Product create and edit UI exposes group and subgroup selectors with subgroup options narrowed by the selected group. [ ]
4. Existing products without categories remain valid and editable. [ ]
5. Product list/detail payloads surface group and subgroup names for display. [ ]
6. Tests cover valid assignment, invalid subgroup pairing, and uncategorized-product behavior. [ ]

## Tasks / Subtasks

- [ ] Task 1: Product API updates
  - [ ] Extend product DTOs, service validation, and persistence for category assignment.
  - [ ] Return category context in list/detail payloads.
  - [ ] Likely file targets: `apps/backend/src/products/product.dto.ts`, `apps/backend/src/products/products.service.ts`, `apps/backend/src/products/products.controller.ts`

- [ ] Task 2: Product form UX
  - [ ] Update add/edit product forms to load groups and subgroups.
  - [ ] Filter subgroup choices by selected group and clear invalid subgroup state when the group changes.
  - [ ] Likely file targets: `apps/frontend/src/app/dashboard/inventory/AddProductModal.tsx`, `apps/frontend/src/app/dashboard/inventory/page.tsx`, `apps/frontend/src/lib/api.ts`

- [ ] Task 3: Tests
  - [ ] Add backend validation tests and frontend form-state tests.
  - [ ] Likely file targets: `apps/backend/src/products/products.service.spec.ts`, `apps/frontend/src/app/dashboard/inventory/AddProductModal.test.tsx`

## Dev Notes

- The repo already exposes `group_id` and `subgroup_id` in shared types. This story should make those fields real end-to-end instead of leaving them half-defined.
- Keep category assignment optional for back-compat and phased rollout.

## Dependencies

- Depends on Stories 45.1 and 45.2.
- Blocks Story 45.4 and enhances reporting filters in Epic 43.

### References

- [Source: docs/prd/epic-45-product-categorization.md]
- [Source: apps/backend/src/products/products.service.ts]
- [Source: apps/frontend/src/app/dashboard/inventory/page.tsx]
