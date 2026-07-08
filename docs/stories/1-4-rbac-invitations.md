# Story 1.4: RBAC & Store Invitations

Status: done

## Story

As a Shop Owner,
I want to define roles like Manager or Cashier,
so that I can control access to my store's data.

## Acceptance Criteria

1.  `roles` enum created (OWNER, MANAGER, CASHIER). [x]
2.  `memberships` table enforces unique `user_id` + `store_id` pairs. [x]
3.  Middleware implemented to check roles for protected routes. [x]

## Tasks / Subtasks

- [x] Task 1: Define Role Schema
  - [x] Add `role` column to `memberships` table in PostgreSQL (mapped to `tenant_users`).
  - [x] Create a shared TypeScript enum for `UserRole`.
- [x] Task 2: Access Control Logic
  - [x] Implement `getRole(userId, storeId)` helper (mapped to `getUserRole`).
  - [x] Add `checkRole(requiredRole)` utility for Server Components/Actions (mapped to `requireRole`).
- [x] Task 3: Middleware Implementation
  - [x] Create Next.js middleware (now `proxy.ts` in v16) to intercept requests and verify role permissions for sensitive paths.

## Dev Notes

- **Roles:** OWNER (full access), MANAGER (full shop access, no owner settings), CASHIER (POS and returns only).
- **Security:** RLS handles data isolation; RBAC handles feature access.
- **Middleware:** Implemented session refresh and auth checks in `src/proxy.ts` following Next.js 16 conventions.

### Project Structure Notes

- Role checks centralized in `apps/web/src/lib/auth-utils.ts`.
- Hierarchy logic implemented to allow superior roles access to subordinate features.

### References

- [Source: docs/architecture/security-and-performance.md#Authorization]
- [Source: docs/architecture/data-models.md]

## Dev Agent Record

### Agent Model Used

Amelia (Developer Agent)

### Debug Log References

- Task 1: Updated `packages/shared-types` with `UserRole` and `TenantUser`.
- Task 2: Created `apps/web/src/lib/auth-utils.ts` with comprehensive role-checking logic.
- Task 3: Implemented `apps/web/src/proxy.ts` for session management and route protection.

### Completion Notes List

- Implemented a robust RBAC system with a defined role hierarchy.
- Established server-side helpers for role enforcement in Server Actions and Components.
- Configured Next.js 16 Proxy (formerly Middleware) for authentication and authorization.

### File List

- `packages/shared-types/index.ts`
- `apps/web/src/lib/auth-utils.ts`
- `apps/web/src/proxy.ts`
- `apps/web/package.json`
