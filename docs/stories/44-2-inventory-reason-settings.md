# Story 44.2: Inventory Reason Catalog Settings

Status: drafted

## Story

As a Shop Owner or Manager,
I want to manage shrinkage and discrepancy reasons centrally,
so that inventory adjustment workflows use tenant-specific categories without code changes.

## Acceptance Criteria

1. Inventory settings support CRUD for tenant-specific reason catalog entries used by shrinkage and discrepancy flows. [ ]
2. Reasons are typed so shrinkage and stock-take workflows only show relevant options. [ ]
3. Seeded system reasons remain available and protected from destructive deletion. [ ]
4. Inactive reasons are hidden from new forms but preserved on historical records. [ ]
5. Existing shrinkage and stock-take APIs validate against the settings-backed reason catalog. [ ]
6. Tests cover create/update/deactivate behavior and historical-record safety. [ ]

## Tasks / Subtasks

- [ ] Task 1: Settings-backed reason model completion
  - [ ] Extend the reason catalog introduced in Story 41.2 with settings CRUD fields such as `is_system`, `is_active`, and display order.
  - [ ] Define delete/deactivate rules for system and in-use reasons.
  - [ ] Likely file targets: `packages/database/prisma/schema.prisma`, `packages/shared-types/index.ts`

- [ ] Task 2: Backend API
  - [ ] Add reason list/create/update/deactivate endpoints.
  - [ ] Update shrinkage and stock-take services to consume the shared validation path.
  - [ ] Likely file targets: `apps/backend/src/inventory-settings/*`, `apps/backend/src/inventory-shrinkage/inventory-shrinkage.service.ts`, `apps/backend/src/stock-takes/stock-takes.service.ts`

- [ ] Task 3: Frontend settings UI
  - [ ] Add reason management section to inventory settings with type filter and status controls.
  - [ ] Reflect active reasons immediately in shrinkage and discrepancy forms.
  - [ ] Likely file targets: `apps/frontend/src/app/dashboard/inventory/settings/page.tsx`, `apps/frontend/src/app/dashboard/inventory/shrinkage/page.tsx`, `apps/frontend/src/app/dashboard/inventory/stock-takes/[id]/page.tsx`

## Dev Notes

- Use soft-deactivation rather than hard delete for in-use reasons to preserve reporting integrity.
- Keep stable machine codes even if display labels change.

## Dependencies

- Depends on Story 41.2.
- Supports Story 42.3 and ongoing shrinkage/reporting work.

### References

- [Source: docs/prd/epic-44-inventory-settings.md]
- [Source: docs/prd/epic-41-lost-stolen-products.md]
- [Source: docs/prd/epic-42-inventory-discrepancy-entry.md]
