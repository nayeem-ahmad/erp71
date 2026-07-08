# Story 1.6: Multi-Store Permission-Based Access Control

Status: done

## Story

As a Shop Owner,
I want to assign users to one or multiple stores with granular permissions,
so that employees only access what they need and cross-store operations are properly controlled.

## Acceptance Criteria

1. `UserStoreAccess` table exists linking users to specific stores with `access_level` field. [x]
2. `UserStorePermission` table exists for granular per-user per-store permission assignments. [x]
3. `StorePermission` enum defined in shared-types with all required permissions. [x]
4. `ProductPrice` table supports store-specific pricing overrides with effective dates. [x]
5. `FundTransfer` model exists with accounting voucher linkage fields. [x]
6. `WarehouseTransfer` extended with `source_store_id`, `destination_store_id`, `is_cross_branch`, `requires_approval`, `approved_by`, `approval_date`. [x]
7. `TenantInterceptor` validates user has `UserStoreAccess` for the requested `x-store-id`. [x]
8. `TenantInterceptor` auto-resolves single-tenant, single-store users without requiring headers. [x]
9. `StorePermissionGuard` enforces `UserStorePermission` on decorated endpoints. [x]
10. `provisionTenant` seeds OWNER with `UserStoreAccess` (MULTI_STORE_CAPABLE) and all permissions. [x]
11. `mapTenantMembership` returns only stores the user has `UserStoreAccess` to (not all tenant stores). [x]
12. Seed data includes a second store ("Banani Branch"), manager/cashier assigned to stores with appropriate permissions. [x]
13. All existing tests pass. [x]

## Tasks / Subtasks

- [x] Task 1: Prisma Schema Changes
  - [x] 1.1 Add `UserStoreAccess` model
  - [x] 1.2 Add `UserStorePermission` model with `StorePermission` enum
  - [x] 1.3 Add `ProductPrice` model
  - [x] 1.4 Add `FundTransfer` model
  - [x] 1.5 Extend `WarehouseTransfer` with cross-branch fields
  - [x] 1.6 Add relations on `Store`, `Tenant`, `User`
  - [x] 1.7 Generate and apply migration

- [x] Task 2: Shared Types
  - [x] 2.1 Add `StorePermission` enum
  - [x] 2.2 Add `UserStoreAccess` interface
  - [x] 2.3 Update `TenantContextSummary` — stores list reflects accessible stores only

- [x] Task 3: Backend — TenantInterceptor Update
  - [x] 3.1 Validate `x-store-id` against `UserStoreAccess` (OWNER bypasses check)
  - [x] 3.2 Auto-resolve single-store users (no header needed)
  - [x] 3.3 Attach `userRole` to request for downstream use

- [x] Task 4: Backend — StorePermissionGuard & Decorator
  - [x] 4.1 Create `RequireStorePermission` decorator
  - [x] 4.2 Create `StorePermissionGuard` — reads decorator, checks `UserStorePermission` table
  - [x] 4.3 Register guard globally in `AppModule`

- [x] Task 5: Auth Service — Provisioning & Mapping
  - [x] 5.1 `provisionTenant` creates `UserStoreAccess` + seeds all OWNER permissions
  - [x] 5.2 `mapTenantMembership` reads `UserStoreAccess` → returns accessible stores only

- [x] Task 6: Seed Data
  - [x] 6.1 Add second store "Banani Branch" with warehouse
  - [x] 6.2 Add `UserStoreAccess` for admin (both stores), manager (Gulshan only), cashier (both stores - weekend coverage)
  - [x] 6.3 Add `UserStorePermission` per user per store per their role presets
  - [x] 6.4 Add `ProductPrice` baseline entries for existing products

- [x] Task 7: Tests
  - [x] 7.1 Unit tests for `StorePermissionGuard`
  - [x] 7.2 Unit tests for updated `TenantInterceptor`
  - [x] 7.3 Update auth service spec to cover new permission seeding

## Dev Agent Record

### Agent Model Used
Amelia (Developer Agent)

### File List
- `packages/database/prisma/schema.prisma`
- `packages/database/prisma/seed.ts`
- `packages/shared-types/index.ts`
- `apps/backend/src/database/tenant.interceptor.ts`
- `apps/backend/src/auth/store-permission.guard.ts` (new)
- `apps/backend/src/auth/store-permission.decorator.ts` (new)
- `apps/backend/src/auth/auth.service.ts`
- `apps/backend/src/app.module.ts`
- `apps/backend/src/auth/store-permission.guard.spec.ts` (new)
- `apps/backend/src/database/tenant.interceptor.spec.ts` (new)
