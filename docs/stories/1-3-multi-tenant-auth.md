# Story 1.3: Multi-tenant Auth & Sign-up Flow

Status: done

## Story

As a new Shop Owner,
I want to sign up and create my store profile in one step,
so that I can quickly start using the system.

## Acceptance Criteria

1.  Sign-up page handles Supabase Auth registration. [x]
2.  Post-registration flow automatically creates a `store` and a `membership` record with role `OWNER`. [x]
3.  User redirected to the dashboard upon successful setup. [x]

## Tasks / Subtasks

- [x] Task 1: Sign-up UI
  - [x] Create `(auth)/signup` page with email/password fields.
  - [x] Add "Store Name" field to the initial sign-up form.
- [x] Task 2: Backend Auth Logic
  - [x] Use Next.js Server Actions for `signUpWithPassword`.
  - [x] Implement a transaction-like flow (register user -> create store -> create membership).
- [x] Task 3: Redirection & Session
  - [x] Ensure user is logged in automatically after sign-up.
  - [x] Redirect to `/(main)/dashboard`.

## Dev Notes

- **Auth Provider:** Supabase Auth via `@supabase/ssr`.
- **User Flow:** Single-step registration and store setup for "Radical Simplicity".
- **Implementation:** Next.js Server Actions for robust server-side processing.

### Project Structure Notes

- Route Groups `(auth)` and `(main)` implemented for clean layout separation.
- Supabase client centralized in `apps/web/src/lib/supabase.ts`.

### References

- [Source: docs/architecture/frontend-architecture.md#Routing]
- [Source: docs/architecture/core-workflows.md#UserRegistration]

## Dev Agent Record

### Agent Model Used

Amelia (Developer Agent)

### Debug Log References

- Task 1: Implemented `(auth)/signup/page.tsx` with email, password, and store name.
- Task 2: Created `apps/web/src/app/(auth)/signup/actions.ts` with `signup` Server Action.
- Task 3: Verified redirection to `/dashboard` upon successful registration.

### Completion Notes List

- Implemented a clean, multi-tenant sign-up flow.
- Successfully integrated Supabase Auth with custom business logic (tenant/store/membership creation).
- Ensured proper layout separation using Next.js Route Groups.

### File List

- `apps/web/src/app/(auth)/layout.tsx`
- `apps/web/src/app/(auth)/signup/page.tsx`
- `apps/web/src/app/(auth)/signup/actions.ts`
- `apps/web/src/lib/supabase.ts`
