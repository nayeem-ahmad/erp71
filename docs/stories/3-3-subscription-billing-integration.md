# Story 3.3: Subscription Billing Integration

Status: drafted

## Story

As a platform owner,
I want subscription billing to create, renew, and update tenant subscriptions through a payment integration,
so that SaaS plan access and billing status stay synchronized automatically.

## Acceptance Criteria

1. The backend can initiate subscription checkout for paid plans (Basic/Standard/Premium) using a server-side payment integration. [ ]
2. Selecting Free bypasses payment checkout and creates an active free-tier subscription state safely. [ ]
3. Payment callback or webhook events update `TenantSubscription` status, billing period dates, and provider reference IDs. [ ]
4. Failed, cancelled, and past-due payments do not incorrectly activate paid-plan entitlements. [ ]
5. Billing history and current subscription status are queryable for tenant-facing and platform-admin screens. [ ]
6. Sensitive gateway credentials remain backend-only and are loaded from environment variables. [ ]
7. Automated tests cover checkout initiation, free-plan activation, webhook signature validation or callback verification, and failed-payment transitions. [ ]

## Tasks / Subtasks

- [ ] Task 1: Billing persistence and provider abstraction
  - [ ] Add subscription payment reference fields and audit metadata required to reconcile provider events.
  - [ ] Introduce a backend billing service abstraction so Stripe, bKash, or Nagad can be swapped without changing controller logic.
  - [ ] Likely file targets: `packages/database/prisma/schema.prisma`, `apps/backend/src/billing/*`

- [ ] Task 2: Checkout and callback endpoints
  - [ ] Add endpoints to create a checkout session or payment intent for paid plan selection.
  - [ ] Add safe free-plan activation and paid-to-free downgrade handling paths.
  - [ ] Add provider callback or webhook handlers that resolve tenant subscription state transitions safely and idempotently.
  - [ ] Likely file targets: `apps/backend/src/billing/billing.controller.ts`, `apps/backend/src/billing/billing.service.ts`

- [ ] Task 3: Frontend billing entry points
  - [ ] Add plan selection and billing status UI for onboarding and tenant settings.
  - [ ] Surface current plan, renewal date, and payment-state messaging in the app.
  - [ ] Likely file targets: `apps/frontend/src/lib/api.ts`, `apps/frontend/src/app/dashboard/settings/page.tsx`, `apps/frontend/src/app/dashboard/page.tsx`

- [ ] Task 4: Test coverage and docs
  - [ ] Add tests for duplicate webhook delivery, invalid signatures, and plan changes.
  - [ ] Document required env vars and local sandbox setup.
  - [ ] Likely file targets: `apps/backend/src/billing/billing.service.spec.ts`, `.env.example`, `docs/architecture/external-apis.md`

## Dev Notes

- The PRD allows Stripe or bKash. The architecture docs already reference bKash/Nagad, so the billing abstraction should not hard-code a single provider name into the domain model.
- Treat provider callbacks as idempotent events. Duplicate webhook delivery is normal and should not create duplicate subscription rows.
- Keep provider-specific payload parsing inside the billing integration layer, not in generic auth or tenant services.

## Dependencies

- Depends on Stories 3.1 and 3.2.
- Blocks Stories 3.4 and 3.5.

### References

- [Source: docs/prd/epic-03-saas-multi-tenancy-billing.md]
- [Source: docs/architecture/external-apis.md]
- [Source: .env.example]
