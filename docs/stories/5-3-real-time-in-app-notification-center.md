# Story 5.3: Real-Time In-App Notification Center

Status: drafted

## Story

As a Store Manager,
I want a notification center inside the app,
so that I can see critical alerts and recent events without leaving the dashboard.

## Acceptance Criteria

1. A notifications table or equivalent persistence exists for historical user-scoped notifications. [ ]
2. The frontend shows a notification bell with unread count and a recent notification list. [ ]
3. Notifications update in near real time without a full page refresh. [ ]
4. Users can mark individual notifications as read and clear all visible notifications. [ ]
5. Notification payloads support info, warning, and error presentation states. [ ]
6. Automated tests cover unread counts, read actions, and empty-state behavior. [ ]

## Tasks / Subtasks

- [ ] Task 1: Notification persistence
  - [ ] Add a notification model with tenant, user, type, title, message, deep link, read state, and timestamps.
  - [ ] Add create, list, mark-read, and clear endpoints.
  - [ ] Likely file targets: `packages/database/prisma/schema.prisma`, `apps/backend/src/notifications/*`

- [ ] Task 2: Realtime delivery path
  - [ ] Wire a realtime update mechanism compatible with the project’s chosen infrastructure, such as Supabase Realtime.
  - [ ] Keep the contract aligned with dashboard alert payloads from Epic 04.
  - [ ] Likely file targets: `apps/backend/src/notifications/*`, `apps/frontend/src/lib/*`

- [ ] Task 3: Frontend notification UI
  - [ ] Add bell icon, unread badge, panel or dropdown, and action handlers.
  - [ ] Integrate the center into the existing dashboard shell.
  - [ ] Likely file targets: `apps/frontend/src/components/Sidebar.tsx`, `apps/frontend/src/components/*`, `apps/frontend/src/lib/api.ts`

- [ ] Task 4: Tests
  - [ ] Add backend tests for list and read-state mutations.
  - [ ] Add frontend tests for badge count and mark-read interactions.
  - [ ] Likely file targets: `apps/backend/src/notifications/*.spec.ts`, `apps/frontend/src/components/*.test.tsx`

## Dev Notes

- This story should become the shared notification substrate for low stock, billing issues, approvals, and future online-order events.
- Keep notification creation domain-driven from source modules, but centralize persistence and delivery.
- Avoid making the notification UI depend on one transport. Polling fallback may still be useful in local development.

## Dependencies

- Depends on Story 4.3 for alert contract alignment.
- Supports Stories 5.4 and later operational modules.

### References

- [Source: docs/prd/epic-05-core-platform-services.md]
- [Source: apps/frontend/src/components/Sidebar.tsx]
