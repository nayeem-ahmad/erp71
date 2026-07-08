# Story 3.4: Plan Entitlement Guard Middleware

Status: drafted

## Story

As a platform owner,
I want plan-gated routes and features to be enforced centrally,
so that tenants on Free/Basic/Standard/Premium only access the functionality included in their active plan.

## Acceptance Criteria

1. Backend request guards can mark selected endpoints with required feature keys and enforce active subscription entitlement checks. [ ]
2. Entitlement checks resolve against the current tenant context, not the signed-in user alone. [ ]
3. The frontend can query plan entitlements and hide or disable gated navigation affordances consistently. [ ]
4. Tenants with insufficient plans or inactive subscriptions receive a clear upgrade-required response instead of generic authorization failures. [ ]
5. Automated tests cover active Free, Basic, Standard, Premium, inactive, and missing-tenant scenarios. [ ]

## Tasks / Subtasks

- [ ] Task 1: Entitlement model
  - [ ] Define plan entitlement metadata for Free, Basic, Standard, and Premium modules or capabilities.
  - [ ] Keep feature keys stable so backend guards and frontend UI checks share the same contract.
  - [ ] Likely file targets: `packages/shared-types/index.ts`, `packages/database/prisma/seed.ts`

- [ ] Task 2: Backend guard implementation
  - [ ] Implement a decorator plus Nest guard for subscription entitlement checks.
  - [ ] Reuse tenant context resolution already handled by auth and tenant interceptor layers.
  - [ ] Likely file targets: `apps/backend/src/auth/*`, `apps/backend/src/database/tenant.interceptor.ts`, `apps/backend/src/subscriptions/*`

- [ ] Task 3: Frontend gating
  - [ ] Add current-plan data to app bootstrap or dashboard context.
  - [ ] Hide or badge Premium-only navigation items until the tenant upgrades.
  - [ ] Likely file targets: `apps/frontend/src/components/Sidebar.tsx`, `apps/frontend/src/lib/api.ts`, `apps/frontend/src/app/dashboard/layout.tsx`

- [ ] Task 4: Tests
  - [ ] Add backend guard tests and a small frontend navigation-gating test.
  - [ ] Likely file targets: `apps/backend/src/auth/*.spec.ts`, `apps/frontend/src/components/Sidebar.test.tsx`

## Dev Notes

- Keep this as an explicit subscription or entitlement guard, not a role guard. Billing state and RBAC are separate concerns.
- Return a domain-specific upgrade error payload so the frontend can route users to billing or plan details.
- Prefer additive decorators on controllers or routes over hard-coded conditional logic inside each service.

## Dependencies

- Depends on Stories 3.1 and 3.3.
- Blocks Epic 03 completion and later Premium-only modules.

### References

- [Source: docs/prd/epic-03-saas-multi-tenancy-billing.md]
- [Source: apps/backend/src/database/tenant.interceptor.ts]
- [Source: apps/frontend/src/components/Sidebar.tsx]
