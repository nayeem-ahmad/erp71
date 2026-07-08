# Story 3.5: Tenant Management Dashboard

Status: drafted

## Story

As a platform administrator,
I want a tenant management dashboard with subscription visibility and support actions,
so that I can monitor customer accounts and assist with billing issues.

## Acceptance Criteria

1. A platform-admin-only tenant management screen lists tenants, active plan, billing status, store count, and owner contact. [ ]
2. Platform admins can filter tenants by plan (Free, Basic, Standard, Premium), status, and search text. [ ]
3. Platform admins can view a tenant detail screen with subscription history and current stores. [ ]
4. Support actions exist to mark subscriptions for manual review or resync billing state without directly mutating unrelated tenant data. [ ]
5. Non-admin users cannot access platform management routes. [ ]
6. Automated tests cover admin authorization, filtering, and support-action safety rails. [ ]

## Tasks / Subtasks

- [ ] Task 1: Admin data endpoints
  - [ ] Add admin-only list and detail endpoints for tenants, plans, and subscription records.
  - [ ] Include counts and summaries needed by the UI in a single query shape.
  - [ ] Likely file targets: `apps/backend/src/admin-tenants/*`, `apps/backend/src/app.module.ts`

- [ ] Task 2: Platform-admin authorization
  - [ ] Introduce or extend a platform-admin role separate from tenant membership roles.
  - [ ] Protect admin routes at the controller level.
  - [ ] Likely file targets: `packages/shared-types/index.ts`, `apps/backend/src/auth/*`

- [ ] Task 3: Frontend admin dashboard
  - [ ] Build tenant list and detail pages using the shared DataTable patterns already used in accounting, inventory, and CRM screens.
  - [ ] Surface plan badges, billing-state badges, and quick support actions.
  - [ ] Likely file targets: `apps/frontend/src/app/dashboard/admin/tenants/page.tsx`, `apps/frontend/src/app/dashboard/admin/tenants/[id]/page.tsx`, `apps/frontend/src/lib/api.ts`

- [ ] Task 4: Tests and safety rails
  - [ ] Add backend tests for unauthorized access and support actions.
  - [ ] Add frontend tests for filters and detail rendering.
  - [ ] Likely file targets: `apps/backend/src/admin-tenants/*.spec.ts`, `apps/frontend/src/app/dashboard/admin/tenants/*.test.tsx`

## Dev Notes

- This is a platform-operations surface, not a tenant-facing settings page. Keep it segmented clearly from store-owner workflows.
- Reuse existing dashboard table patterns so this does not become a one-off admin UI.
- Manual billing support actions should be auditable; do not silently overwrite provider state.

## Dependencies

- Depends on Stories 3.1 through 3.4.

### References

- [Source: docs/prd/epic-03-saas-multi-tenancy-billing.md]
- [Source: apps/frontend/src/components/data-table/DataTable.tsx]
