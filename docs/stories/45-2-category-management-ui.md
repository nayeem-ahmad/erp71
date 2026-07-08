# Story 45.2: Category Management UI

Status: drafted

## Story

As a Shop Owner or Manager,
I want a settings interface to manage product groups and subgroups,
so that category structure can be maintained without touching product records one by one.

## Acceptance Criteria

1. A category management UI exists for listing, creating, editing, and deleting groups and subgroups. [ ]
2. The interface clearly shows subgroup-to-group relationships. [ ]
3. Delete actions are blocked when referenced products or child subgroups would be orphaned. [ ]
4. The UI follows the shared dashboard `DataTable` and inline-form patterns already used in customers and accounting. [ ]
5. Tests cover create/edit/delete interactions and parent-group validation. [ ]

## Tasks / Subtasks

- [ ] Task 1: Page shell and navigation
  - [ ] Add category management route under inventory settings or inventory setup.
  - [ ] Add navigation entry consistent with existing dashboard structure.
  - [ ] Likely file targets: `apps/frontend/src/app/dashboard/inventory/categories/page.tsx`, `apps/frontend/src/components/Sidebar.tsx`

- [ ] Task 2: Group and subgroup management UI
  - [ ] Add list sections or tables for groups and subgroups.
  - [ ] Add create/edit forms with parent-group selection for subgroups.
  - [ ] Surface product counts where available to inform delete guards.
  - [ ] Likely file targets: `apps/frontend/src/app/dashboard/inventory/categories/page.tsx`, `apps/frontend/src/lib/api.ts`

- [ ] Task 3: Tests
  - [ ] Add page tests for creation, edit, and blocked delete flows.
  - [ ] Likely file targets: `apps/frontend/src/app/dashboard/inventory/categories/page.test.tsx`

## Dev Notes

- Reuse the same operational UI language as customer groups, territories, and chart-of-accounts setup pages.
- Avoid a tree widget unless the flat list becomes unwieldy; two-level hierarchy is manageable without added complexity.

## Dependencies

- Depends on Story 45.1.
- Supports Story 45.3.

### References

- [Source: docs/prd/epic-45-product-categorization.md]
- [Source: apps/frontend/src/app/dashboard/accounting/coa/page.tsx]
- [Source: apps/frontend/src/app/dashboard/customer-groups/page.tsx]
