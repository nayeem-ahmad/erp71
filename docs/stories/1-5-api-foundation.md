# Story 1.5: API Foundation & Global Error Handling

Status: done

## Story

As a Developer,
I want a standardized way to handle API calls and errors,
so that our application is robust and easy to maintain.

## Acceptance Criteria

1.  `apiClient` wrapper implemented in `lib/api.ts` with error handling. [x]
2.  `withErrorHandler` HOC/Wrapper for API routes to return standard `ApiError` JSON. [x]
3.  Zod schemas used for all request body validation. [x]

## Tasks / Subtasks

- [x] Task 1: Build the API Client
  - [x] Create `src/lib/api.ts` using `fetch`.
  - [x] Include automatic `Authorization: Bearer <JWT>` header from Supabase session.
- [x] Task 2: Global Error Handler (Backend)
  - [x] Implement `withErrorHandler` utility in `src/lib/api-utils.ts`.
  - [x] Map Zod errors and database errors to the standard `ApiError` shape.
- [x] Task 3: Frontend Toast Integration
  - [x] Integrate a toast library (e.g., `react-hot-toast`) to display API errors to the user.

## Dev Notes

- **Error Format:** Standard `ApiError` interface implemented in `packages/shared-types`.
- **API Client:** Robust `apiClient` with automatic JWT handling and error wrapping.
- **Backend Utility:** `withErrorHandler` provides consistent JSON error responses and request ID tracking.
- **UI Feedback:** `react-hot-toast` integrated into root layout for global notifications.

### Project Structure Notes

- Error handling logic centralized in `apps/web/src/lib/api-utils.ts` and `apps/web/src/lib/api.ts`.
- Standardized error codes defined for consistency.

### References

- [Source: docs/architecture/error-handling-strategy.md]
- [Source: docs/architecture/coding-standards.md#CriticalFullstackRules]

## Dev Agent Record

### Agent Model Used

Amelia (Developer Agent)

### Debug Log References

- Task 1: Created `apps/web/src/lib/api.ts` with `ApiRequestError` class.
- Task 2: Created `apps/web/src/lib/api-utils.ts` with `withErrorHandler` and `formatError`.
- Task 3: Installed `react-hot-toast` and updated `apps/web/src/app/layout.tsx`.

### Completion Notes List

- Established a robust full-stack API foundation with standardized error handling.
- Integrated Zod validation support within the global error handler.
- Enabled real-time user feedback via toast notifications for API failures.

### File List

- `packages/shared-types/index.ts`
- `apps/web/src/lib/api.ts`
- `apps/web/src/lib/api-utils.ts`
- `apps/web/src/app/layout.tsx`
- `apps/web/package.json`
