# Story 5.4: Multi-Channel Push Notification Infrastructure

Status: drafted

## Story

As a Shop Owner on the go,
I want high-priority alerts pushed to my device or browser,
so that I can respond to urgent business events even when the app is not open.

## Acceptance Criteria

1. The system can register browser or device push tokens per user. [ ]
2. A push provider integration exists for sending high-priority notifications outside the web session. [ ]
3. Users can opt in or out of notification categories such as sales, inventory, and approvals. [ ]
4. Push notifications deep-link into the relevant dashboard screen when opened. [ ]
5. Failed push deliveries are logged without blocking the originating workflow. [ ]
6. Automated tests cover token registration, category preferences, and payload deep-link generation. [ ]

## Tasks / Subtasks

- [ ] Task 1: Push preference and token model
  - [ ] Add persistence for user push tokens and notification-category preferences.
  - [ ] Likely file targets: `packages/database/prisma/schema.prisma`, `apps/backend/src/notifications/*`

- [ ] Task 2: Provider integration
  - [ ] Integrate FCM or an equivalent push provider behind the notification service abstraction.
  - [ ] Ensure push send calls are asynchronous and reusable by multiple modules.
  - [ ] Likely file targets: `apps/backend/src/notifications/*`, `.env.example`

- [ ] Task 3: Frontend/PWA setup
  - [ ] Add client-side token registration and service worker support where applicable.
  - [ ] Map notification clicks to dashboard deep links.
  - [ ] Likely file targets: `apps/frontend/public/*`, `apps/frontend/src/app/*`, `apps/frontend/src/lib/*`

- [ ] Task 4: Tests and fallback behavior
  - [ ] Add tests for preference changes and deep-link generation.
  - [ ] Define graceful fallback when push is unavailable in the environment.
  - [ ] Likely file targets: `apps/backend/src/notifications/*.spec.ts`, `apps/frontend/src/lib/*.test.ts`

## Dev Notes

- Keep push as an extension of the shared notification system, not a separate domain model.
- Opt-in state matters. Do not send category-specific push messages without explicit user preference support.
- Deep links should target implemented routes only.

## Dependencies

- Depends on Story 5.3.

### References

- [Source: docs/prd/epic-05-core-platform-services.md]
