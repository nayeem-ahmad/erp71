# Story 5.2: Unified Email Communication Service

Status: drafted

## Story

As a developer,
I want a centralized email service with reusable templates,
so that transactional and account communications can be sent consistently across the platform.

## Acceptance Criteria

1. A provider-agnostic email service abstraction exists in the backend. [ ]
2. Standardized templates exist for welcome email, password reset, and transaction receipt. [ ]
3. Email jobs are queued or handled asynchronously so request latency is not blocked by the provider. [ ]
4. Failed sends are logged and retryable. [ ]
5. Modules call the shared notification interface instead of embedding provider-specific logic. [ ]
6. Automated tests cover template rendering and provider failure handling. [ ]

## Tasks / Subtasks

- [ ] Task 1: Backend notification abstraction
  - [ ] Implement a backend `NotificationService` or email service wrapper with provider adapters.
  - [ ] Define a common payload shape for recipients, subject, template key, and data.
  - [ ] Likely file targets: `apps/backend/src/notifications/*`, `packages/shared-types/index.ts`

- [ ] Task 2: Template library
  - [ ] Create initial welcome, password reset, and transaction receipt templates.
  - [ ] Keep rendering server-side and data-driven.
  - [ ] Likely file targets: `apps/backend/src/notifications/templates/*`

- [ ] Task 3: Async delivery path
  - [ ] Route email delivery through the existing background-job strategy introduced in Epic 02 instead of direct request blocking.
  - [ ] Likely file targets: `apps/backend/src/background-jobs/*`, `apps/backend/src/notifications/*`

- [ ] Task 4: Tests and configuration
  - [ ] Add provider mock tests and template rendering tests.
  - [ ] Document provider env vars.
  - [ ] Likely file targets: `apps/backend/src/notifications/*.spec.ts`, `.env.example`

## Dev Notes

- This story should align with `docs/architecture/external-apis.md` and keep provider logic fully on the backend.
- Do not couple template rendering to a single module’s DTOs; use normalized payloads.
- Favor a provider adapter boundary now, even if the first implementation ships with one provider.

## Dependencies

- Depends on Epic 02 background processing.
- Supports account onboarding, billing, sales receipts, and later HR communications.

### References

- [Source: docs/prd/epic-05-core-platform-services.md]
- [Source: docs/architecture/external-apis.md]
