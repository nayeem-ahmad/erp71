# Story 41.2: Shrinkage Reason Categorization

Status: drafted

## Story

As a Shop Owner or Manager,
I want shrinkage to be categorized by reason,
so that theft, damage, expiration, and unknown loss can be analyzed separately.

## Acceptance Criteria

1. Shrinkage records require a reason selected from a tenant-available reason catalog. [ ]
2. Seeded system reasons include at least `THEFT`, `DAMAGE`, `EXPIRATION`, and `UNKNOWN`. [ ]
3. Reason catalog entries carry a type that differentiates shrinkage reasons from discrepancy reasons. [ ]
4. Shrinkage list and detail responses include both reason code and human label. [ ]
5. Attempting to use a reason outside the current tenant or wrong reason type is rejected. [ ]
6. Tests cover default reasons, reason scoping, and invalid type assignment. [ ]

## Tasks / Subtasks

- [ ] Task 1: Reason catalog foundation
  - [ ] Add an inventory reason table or equivalent typed settings model with tenant scope and system/default metadata.
  - [ ] Seed default shrinkage reasons for each tenant or bootstrap them on first access.
  - [ ] Likely file targets: `packages/database/prisma/schema.prisma`, `packages/database/prisma/seed.ts`

- [ ] Task 2: Shrinkage flow integration
  - [ ] Require `reasonId` or stable `reasonCode` in shrinkage create/update contracts.
  - [ ] Include reason joins in shrinkage list and detail payloads.
  - [ ] Likely file targets: `apps/backend/src/inventory-shrinkage/inventory-shrinkage.dto.ts`, `apps/backend/src/inventory-shrinkage/inventory-shrinkage.service.ts`

- [ ] Task 3: UI reason selection
  - [ ] Populate the shrinkage form with a reason dropdown.
  - [ ] Surface reason badges or labels in list/detail screens.
  - [ ] Likely file targets: `apps/frontend/src/app/dashboard/inventory/shrinkage/page.tsx`, `apps/frontend/src/lib/api.ts`

## Dev Notes

- This story should create the reason model in a way that Story 44.2 can extend into full settings CRUD rather than replacing it.
- Keep reason codes stable and non-localized for reporting joins; labels can be displayed in the current UI language later.

## Dependencies

- Depends on Story 41.1 for the shrinkage workflow surface.
- Enables Story 41.3 and provides base data for Story 44.2.

### References

- [Source: docs/prd/epic-41-lost-stolen-products.md]
- [Source: docs/prd/epic-44-inventory-settings.md]
