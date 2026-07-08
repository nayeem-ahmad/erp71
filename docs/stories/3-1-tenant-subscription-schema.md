# Story 3.1: Tenant Subscription Schema Alignment

Status: drafted

## Story

As a platform owner,
I want the tenant, store, plan, and subscription schema to fully drive access and billing state,
so that every business is isolated correctly and the app can enforce plan-aware behavior from a single source of truth.

## Acceptance Criteria

1. Prisma schema fully models tenant-first organization state with `Tenant`, `Store`, `TenantUser`, `SubscriptionPlan`, and `TenantSubscription` relationships required by the app. [ ]
2. Each tenant has at most one active subscription record and stores remain tenant-scoped. [ ]
3. Seed/bootstrap flow creates default Free, Basic (BDT 499), Standard (BDT 999), and Premium (BDT 1499) plans plus a valid subscription row for seeded tenants. [ ]
4. Auth and tenant context APIs return current tenant membership and subscription summary in one response shape. [ ]
5. Tenant-scoped endpoints can reliably resolve tenant context without falling back to store-only assumptions. [ ]
6. Automated tests cover seeded plans, tenant membership lookups, entitlement JSON parsing, and inactive subscription edge cases. [ ]

## Plan Baseline For This Epic

| Plan | Monthly Price | Entitlement Baseline |
| --- | --- | --- |
| Free | BDT 0 | 1 branch, 1 user, up to 100 SKUs, basic POS, basic inventory tracking, limited reports |
| Basic | BDT 499 | 1 branch, up to 3 users, up to 2,000 SKUs, full POS, low-stock alerts, purchase entry, basic returns |
| Standard | BDT 999 | Up to 3 branches, up to 10 users, up to 20,000 SKUs, split payments, batch/expiry, multi-warehouse, accounting core, richer reports |
| Premium | BDT 1499 | Up to 10 branches, up to 30 users, unlimited SKUs, advanced POS workflows, advanced analytics, API/integration access, priority support |

## Tasks / Subtasks

- [ ] Task 1: Schema and seed normalization
  - [ ] Audit existing Prisma models and add any missing fields needed for billing cycles, renewal dates, plan codes, and feature metadata.
  - [ ] Enforce uniqueness and indexing for `tenant_id`, `plan_id`, and active subscription lookups.
  - [ ] Seed Free, Basic, Standard, and Premium plans with stable codes and prices that backend guards can reference.
  - [ ] Likely file targets: `packages/database/prisma/schema.prisma`, `packages/database/prisma/seed.ts`

- [ ] Task 2: Shared contract updates
  - [ ] Add shared tenant subscription response types used by auth, tenant switcher, and admin views.
  - [ ] Standardize status values and plan codes across backend and frontend.
  - [ ] Likely file targets: `packages/shared-types/index.ts`

- [ ] Task 3: Backend tenant profile surface
  - [ ] Add or extend tenant profile endpoints so the signed-in client can fetch tenant, store memberships, and subscription summary together.
  - [ ] Ensure the auth login payload includes enough tenant metadata to avoid an extra blocking round trip on first load.
  - [ ] Likely file targets: `apps/backend/src/auth/auth.service.ts`, `apps/backend/src/auth/auth.controller.ts`, `apps/backend/src/database/tenant.interceptor.ts`

- [ ] Task 4: Regression protection
  - [ ] Add focused tests for seeded plan creation, tenant membership lookup, and inactive subscription visibility.
  - [ ] Validate that existing sales, purchase, accounting, and inventory routes continue to resolve tenant context correctly.
  - [ ] Likely file targets: `apps/backend/src/auth/auth.service.spec.ts`, `apps/backend/test/integration.spec.ts`

## Dev Notes

- The repo already contains tenant and subscription primitives in Prisma. This story should close the runtime and contract gaps instead of redesigning the data model from scratch.
- Keep plan codes stable and human-readable, because later feature gating and billing admin screens will key off those values.
- Do not reintroduce store-only authorization shortcuts; tenant context should remain the top-level scope.

## Dependencies

- Depends on Stories 1.3 and 1.4.
- Blocks Stories 3.2, 3.3, 3.4, and 3.5.

### References

- [Source: docs/prd/epic-03-saas-multi-tenancy-billing.md]
- [Source: packages/database/prisma/schema.prisma]
- [Source: packages/database/prisma/seed.ts]
- [Source: apps/backend/src/auth/auth.service.ts]
