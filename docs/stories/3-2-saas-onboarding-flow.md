# Story 3.2: SaaS Onboarding Flow

Status: drafted

## Story

As a new business owner,
I want to create my organization, choose a plan, and land in the product with the right tenant context,
so that I can start using the SaaS without manual admin intervention.

## Acceptance Criteria

1. A new onboarding flow captures organization name, primary store name, and subscription plan choice from Free, Basic (BDT 499), Standard (BDT 999), and Premium (BDT 1499). [ ]
2. Completing onboarding creates a tenant, store, owner membership, and initial tenant subscription in one transactional backend flow. [ ]
3. The flow supports free and paid-plan paths without leaving orphaned tenants when setup fails. [ ]
4. The frontend stores tenant and store context after onboarding and redirects to the main dashboard. [ ]
5. Validation and error states are explicit for duplicate email, duplicate store name within tenant, and invalid plan selection. [ ]
6. Automated tests cover happy path, invalid plan selection, free-plan onboarding, and partial-failure rollback. [ ]

## Tasks / Subtasks

- [ ] Task 1: Onboarding contract
  - [ ] Define a single backend DTO for organization setup with owner identity, tenant name, store name, and selected plan code.
  - [ ] Return access token, primary tenant, primary store, and subscription summary in one response.
  - [ ] Likely file targets: `apps/backend/src/auth/auth.dto.ts`, `packages/shared-types/index.ts`

- [ ] Task 2: Backend onboarding transaction
  - [ ] Extend auth service setup flow to create tenant, owner membership, primary store, and initial subscription atomically.
  - [ ] Ensure seed/demo flows and manual admin-created tenants can reuse the same bootstrap helper.
  - [ ] Likely file targets: `apps/backend/src/auth/auth.service.ts`, `packages/database/prisma/bootstrap-accounting.ts`, `apps/backend/src/database/database.service.ts`

- [ ] Task 3: Frontend onboarding UX
  - [ ] Add an onboarding screen or post-signup wizard in the main frontend app.
  - [ ] Show plan cards with clear monthly prices and an entitlement summary so users can compare tiers before continuing.
  - [ ] Persist tenant and store context into local storage using the same format as the login flow.
  - [ ] Redirect to `/dashboard` once setup completes.
  - [ ] Likely file targets: `apps/frontend/src/app/login/page.tsx`, `apps/frontend/src/lib/api.ts`, `apps/frontend/src/app/dashboard/page.tsx`

- [ ] Task 4: Tests
  - [ ] Add backend tests for tenant setup rollback and invalid plans.
  - [ ] Add frontend tests for form validation and redirect behavior.
  - [ ] Likely file targets: `apps/backend/src/auth/auth.service.spec.ts`, `apps/frontend/src/app/login/page.test.tsx`

## Dev Notes

- Prefer extending the active `apps/frontend` plus Nest auth flow instead of expanding the older `apps/web` signup path unless the team explicitly revives that app as the primary experience.
- The onboarding response should be rich enough that the frontend can initialize tenant context without a second blocking profile fetch.
- Keep the server-side creation flow transactional so billing and provisioning can be layered onto it later.

## Dependencies

- Depends on Story 3.1.
- Blocks Stories 3.3 and 3.5.

### References

- [Source: docs/prd/epic-03-saas-multi-tenancy-billing.md]
- [Source: apps/backend/src/auth/auth.service.ts]
- [Source: apps/frontend/src/app/login/page.tsx]
