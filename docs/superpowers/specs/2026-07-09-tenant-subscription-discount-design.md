# Tenant Subscription Discount + Ledger Reminder Cleanup — Design

**Date:** 2026-07-09
**Status:** Approved

## Problem

1. When a platform admin creates a tenant, they cannot grant a subscription discount (percentage or fixed amount). A ledger entry should be created reflecting the discounted first charge, and the admin must be able to change the discount later so it affects **future** billing cycles only.
2. Payment retry reminders (`PAYMENT_RETRY_REMINDER`, `ADDON_PAYMENT_RETRY_REMINDER`) currently appear in the tenant ledger even though they are not transactions. They should be removed from the ledger and shown on a dedicated page instead.

## Context

- There is no dedicated `Ledger` model — the tenant ledger is a derived view over the `BillingEvent` table. Balance = sum of signed deltas (`ledger-balance.util.ts` / `ledger-utils.ts`).
- New tenants are created `PAST_DUE` with `current_period_end = now`. The cron `postSubscriptionPeriodFees` (daily 10:00) posts a `subscription_fee` BillingEvent per due subscription using idempotency key `subscription_fee:{tenantId}:{periodKey}`.
- Precedent: referral discount reduces the plan price via a multiplier in `billing.service.ts`.

## Design

### 1. Data model
Add to `TenantSubscription` (Prisma migration):
- `discount_type String?` — `'PERCENTAGE' | 'FIXED'`
- `discount_value Decimal? @db.Decimal(12,2)`

Shared helper `apps/backend/src/billing/discount.util.ts`:
```
applySubscriptionDiscount(base, type, value): number
```
- `PERCENTAGE` → `base * (100 - value) / 100`
- `FIXED` → `base - value`
- Result floored at 0, rounded to 2 dp. No discount (null type) → returns base unchanged.

### 2. Discount at tenant creation
- `CreateAdminTenantDto` gains optional `discountType` (`PERCENTAGE|FIXED`) + `discountValue` (pct 0–100, fixed ≥ 0), validated together.
- `createTenant` stores the discount on the subscription and — inside the same flow — **posts the first `subscription_fee` immediately**, net of discount, reusing the cron idempotency key `subscription_fee:{tenantId}:{periodKey}` (periodKey = `current_period_end` date) so the 10:00 cron will not double-post the same period. Zero-price / FREE plans post nothing.

### 3. Changing the discount later (future cycles only)
- `UpdateAdminTenantSubscriptionDto` gains `discountType` + `discountValue`.
- `updateSubscription` persists them on the subscription (direct `tenantSubscription.update`, isolated from `applySubscriptionChange`).
- The cron `postSubscriptionPeriodFeesImpl` reads the stored discount and posts each **future** `subscription_fee` net of it. Already-posted entries are untouched.

### 4. Payment reminders out of the ledger
- `REMINDER_EVENT_TYPES = ['PAYMENT_RETRY_REMINDER', 'ADDON_PAYMENT_RETRY_REMINDER']` (shared constant).
- `listTenantLedger` excludes these event types (records remain in the DB → dedup/email logic unaffected).
- New backend method + endpoint `GET /admin/tenants/reminders` (optional `tenantId`) returning only reminder events.
- New frontend page `admin/tenants/reminders` (+ nav entry + i18n) to view reminders.

### 5. Frontend
- `CreateTenantModal`: Discount row (None / % / ৳ selector + value input); threaded through `CreateDraft` + create payload.
- `TenantDetailModal` subscription section: discount controls calling the existing update-subscription endpoint.
- Reminders page with tenant filter, mirroring the ledger page layout.

## Scope boundary
Only the two reminder event types are excluded from the ledger. Other non-balance events (e.g. `CHECKOUT_CREATED`) remain visible.

## Testing / verification
- Backend typecheck/build.
- Frontend typecheck/build.
- Manual reasoning trace: create tenant with 10% discount on a ৳1000 plan → ledger shows one `subscription_fee` of ৳900; cron re-run posts nothing (idempotent). Change to ৳200 fixed → next cycle posts ৳800. Reminders no longer appear in ledger; appear on reminders page.
