# Story 45.1: Product Category Schema and API

Status: drafted

## Story

As a Shop Owner or Manager,
I want product groups and subgroups in the core product model,
so that products can be organized consistently for filtering and reporting.

## Acceptance Criteria

1. Prisma adds `ProductGroup` and `ProductSubgroup` models plus nullable foreign keys on `Product`. [ ]
2. Group names are unique per tenant and subgroup names are unique within a tenant-group pair. [ ]
3. CRUD endpoints exist for product groups and product subgroups with tenant-scoped validation. [ ]
4. Subgroups cannot be created against a group outside the current tenant. [ ]
5. Shared types are reconciled so existing `group_id` and `subgroup_id` assumptions match the real schema. [ ]
6. Tests cover uniqueness, tenant scoping, and subgroup-parent integrity. [ ]

## Tasks / Subtasks

- [ ] Task 1: Schema and shared contracts
  - [ ] Add `ProductGroup` and `ProductSubgroup` models plus product relations.
  - [ ] Add indexes and unique constraints aligned to tenant + parent structure.
  - [ ] Update `Product` shared types to match persisted fields and actual optionality.
  - [ ] Likely file targets: `packages/database/prisma/schema.prisma`, `packages/shared-types/index.ts`, `packages/database/prisma/seed.ts`

- [ ] Task 2: Backend CRUD modules
  - [ ] Add group and subgroup DTOs, services, controllers, and tests.
  - [ ] Include delete guards if products still reference a group or subgroup.
  - [ ] Likely file targets: `apps/backend/src/product-groups/*`, `apps/backend/src/product-subgroups/*`, `apps/backend/src/app.module.ts`

- [ ] Task 3: Product endpoint readiness
  - [ ] Extend product list/detail payloads to include group and subgroup context.
  - [ ] Add validation helpers reused by product create/update flows in Story 45.3.
  - [ ] Likely file targets: `apps/backend/src/products/product.dto.ts`, `apps/backend/src/products/products.service.ts`

## Dev Notes

- The PRD file name is correct, but its heading currently says Epic 43. Follow the file path and epic list, not the bad heading text.
- Keep category hierarchy to two levels for now: group and subgroup.

## Dependencies

- Standalone foundation for Epic 45.
- Blocks Stories 45.2, 45.3, and 45.4.

### References

- [Source: docs/prd/epic-45-product-categorization.md]
- [Source: docs/prd/epic-list.md]
- [Source: packages/shared-types/index.ts]
