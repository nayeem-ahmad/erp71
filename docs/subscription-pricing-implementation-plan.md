# Subscription Pricing — Implementation Plan

**Companion to:** `docs/subscription-pricing-architecture.md` (what we are selling and why)
**This document:** how it gets built, in what order, and what breaks if the order changes.
**Drafted:** 2026-09-03

---

## The ordering rule

Two constraints decide the sequence, and everything else follows from them:

1. **Nothing is sold before it is enforced.** Today 7 entitlement keys are enforced across 16 of ~126 controllers. Publishing a 59-row matrix on top of that turns every unenforced row into a support ticket, and every enforcement added *after* launch into a feature being taken away from a paying tenant.
2. **Nothing is priced per-unit before it can be charged once.** Capacity packs (৳400/branch, ৳300/5 users) have nowhere to store a quantity, and the setup fee has nowhere to record that it was paid. Selling either before the schema exists means invoicing by hand.

Phase 0 is the exception: it is data-only, reverses a live revenue leak, and depends on nothing.

```
Phase 0  Repricing ──────────────┐
                                 ├──> Phase 4  One registry ──> Phase 5  Plans as data ──> Enterprise
Phase 1  Enforcement ────────────┤
Phase 2  Seats & portals ──┐     │
                           ├─────┘
Phase 3  Billing mechanics ┘

Phase 6  Build the "in development" list — independent, runs in parallel throughout
```

Phase 4 needs 1 (a matrix row is only publishable once enforced). Phase 3's capacity packs need 2 (seats cannot be priced while portal logins consume them). Phase 5 needs 4 (a data-driven matrix is what makes new plan rows cheap).

---

## Phase 0 — Repricing

**Goal:** stop Premium undercutting its own add-ons, and put Starter at ৳299.
**Effort:** ~1 day, mostly care rather than code. **No migration. No deploy.**

### 0.1 The seed file cannot do this

`seedPlatformReferenceData` in `packages/database/prisma/seed-platform.ts` upserts plans, but for an **existing** plan it only calls `addMissingKeys` on `features_json` and updates that column. Price, name, description and `is_active` are deliberately left alone so an admin's edits survive a deploy — the file says so in its header.

So repricing production means **the platform admin UI** (`apps/frontend/src/app/(app)/admin/platform-settings/plans/page.tsx`) or a data migration. Update `seed-platform.ts` in the same PR anyway, so a freshly seeded environment matches production.

| Plan | Now | Becomes | Display name |
|---|---|---|---|
| `BASIC` | ৳499 / ৳4,990 | **৳299 / ৳2,990** | Starter |
| `STANDARD` | ৳999 / ৳9,990 | unchanged | Growth |
| `PREMIUM` | ৳1,499 / ৳14,990 | **৳2,499 / ৳24,990** | Business |
| `ACCOUNTING` | ৳749 / ৳7,490 | unchanged | Accounting edition |

Codes do not move. Starter/Growth/Business are `name` values over the existing enum.

### 0.2 Grandfathering, and the hole in it

There is no per-tenant price — `TenantSubscription` points at a plan and the price lives on the plan, so raising Premium raises it for everyone on Premium. The mechanism that already exists is `TenantSubscription.discount_type` / `discount_value`: set `FIXED` / `1000` on existing Premium tenants and they keep paying ৳1,499.

**This works on renewal and nowhere else.** `applySubscriptionDiscount` is called from `billing-scheduler.service.ts` (both the plan and add-on renewal paths) and from `admin-tenants.service.ts` for display — but **not** from `createCheckout` in `billing.service.ts`, which applies only the referral discount. A grandfathered tenant who lapses and self-serve checks out pays the new full price.

Fix that in the same phase: apply the subscription discount in `createCheckout` alongside the referral discount, and decide the stacking order explicitly (recommend: referral first, then admin discount, floored at 0).

### 0.3 Deactivate `IMPORTS_LC`

Set `is_active: false`. It sets `features_json: { premiumImports: true }`, `premiumImports` is not in `PLAN_ENTITLEMENT_REGISTRY`, `mergeAddonFeatures` iterates that registry and drops unknown keys, and no controller reads the flag. It grants nothing. Check `TenantAddonSubscription` for anyone who bought it and refund.

### Verification
- A tenant on each plan sees the new price on `/pricing` and in billing.
- A grandfathered Premium tenant's next renewal charges ৳1,499, and so does a fresh checkout.
- `GET /subscription-plans` returns no `IMPORTS_LC`.

---

## Phase 1 — Enforcement

**Goal:** every row in the published matrix is refused by the API on a plan that does not include it.
**Effort:** ~5–8 days. **The long pole, and the one that must not be cut.**

### 1.1 Close the registry hole first

`mergeAddonFeatures` and `normalizePlanFeatures` both iterate `PLAN_ENTITLEMENT_REGISTRY` and silently ignore unknown keys. That is how a ৳999 add-on shipped granting nothing. Add a startup assertion — every `features_json` key on every seeded plan and add-on must exist in the registry, or the app refuses to boot. Ten lines, and it makes this class of bug impossible to repeat.

### 1.2 AI on every tier

The pricing sells an assistant on all four plans with credits as the differentiator. Today `premiumAi` is `true` only on `PREMIUM`, while `aiCreditsMonthly` is `100` on `BASIC` — an allowance on a plan whose endpoints refuse the request.

- `premiumAi: true` on Starter, Growth, Business, Enterprise
- `aiCreditsMonthly`: 100 / 500 / 2000 / custom
- `premiumVoice`: Growth and above (`assertVoiceEnabled` in `ai.controller.ts` already gates it)
- Anomaly detection: Business and above — needs a new key, `premiumAiAnomaly`, and a guard on `anomaly-detection.service.ts`'s controller entry points

Credit enforcement already exists (`enforceCredits`, `ai_credits_bonus`, `AI_TOKENS_PER_CREDIT = 1000`).

### 1.3 Storefront

`premiumStorefront` gates nothing, so a Starter tenant can switch on a storefront today. Add `@RequiresFeature('premiumStorefront')` to the tenant-facing storefront settings routes and to the `storefront_enabled` toggle — **not** to the public `GET /storefront/:slug` routes, which serve shoppers and must stay open.

Grandfather: any store with `storefront_enabled = true` today keeps it regardless of plan.

### 1.4 Module-level nav gating is dead config

`NAV_REGISTRY` declares `chat: { entitlement: 'teamChat' }`, but `buildNavModulesFromLayout` in `apps/frontend/src/lib/nav-resolver.ts` copies `moduleKey`, `platformFeature` and `soon` onto the resolved module and drops `entitlement` — `ResolvedNavModule` has no such field. Only links and subgroups are gated today. Add the field and honour it, otherwise every new module-level entitlement in the matrix is decorative.

### 1.5 The sweep

Work the matrix top to bottom. For each row that is not "on every plan": find the controller, add `@RequiresFeature`, add the nav gate, add a spec. Existing pattern to copy: the 8 `premiumCrm` usages.

Rows needing a key that does not exist yet: payroll, recruitment, projects, campaigns/territories, price lists, loyalty, delivery/warranty, stock takes, custom fields, print templates. Add them to `PLAN_ENTITLEMENT_REGISTRY` with `group` set, defaulting to `false`, then set them true per plan.

### 1.6 Fail closed, in the right words

`apps/frontend/src/app/(app)/chat/page.tsx` maps any 403 to "buy the Team Chat add-on", but the controller has three independent 403 sources — lapsed subscription, missing entitlement, missing permission. It named the wrong one twice in a live debugging session. As rows get enforced, this pattern multiplies. Return a discriminated reason from `SubscriptionAccessGuard` and render it.

### Verification
- A table-driven spec: for each entitlement key, a tenant without it gets 403 from every controller that declares it.
- `grep -c RequiresFeature` climbs from 16 toward the row count.
- Manual: a Starter tenant sees no ledger, no storefront settings, no payroll.

---

## Phase 2 — Seats and portals

**Goal:** "unlimited customer accounts and employee self-service" becomes true, so seats can be priced.
**Status:** done. **No migration in the end** — see below.

Storefront customers are already safe: `POST /storefront/:slug/auth/signup` creates a `User` and a `Customer` and never a `TenantUser`, and `assertUserQuota` counts only `tenantUser` rows.

Employees are not. `EmployeeGuard`'s own comment: unlike a referee, an employee "is a real tenant member with a real membership row". `assertUserQuota` counts every `TenantUser` with no filter on role, so a 40-person shop wanting payslip access needs 30 extra seats — ৳1,800/mo on top of a ৳999 plan.

**Landed 2026-09-03, and it needed no migration.** Portal-only status is derived
from the invariant the security model already depends on — such a user is
provisioned with no store permissions, which is what makes `StorePermissionGuard`
refuse every guarded controller — rather than stored on a column that can drift
away from it. `countPortalOnlyMembers` in `plan-entitlements.service.ts` excludes
them from `assertUserQuota`; grant one a store permission and the next count
bills for them. `OWNER` is never portal-only, since an owner bypasses permission
checks however few rows they hold. No column, no backfill, four specs.

---

## Phase 3 — Billing mechanics

**Goal:** charge a setup fee once, and sell capacity by quantity.
**Effort:** ~3–4 days. **Two migrations.**

### 3.1 Setup fee

The cheap half already works: `createCheckout` builds `amount` as plan + add-ons and writes `line_items` into the `BillingEvent` payload, and `billing-scheduler` recomputes renewals from `plan.monthly_price` rather than reusing that amount — **so a setup line added at checkout will not recur.**

Missing: nothing records that it was paid, so a tenant who lapses to `PAST_DUE` and checks out again is charged twice.

- Migration: `SubscriptionPlan.setup_fee Decimal @db.Decimal(12,2) @default(0)` — a price, so a column, not a `features_json` key (that JSON is validated against the entitlement registry).
- Migration: `TenantSubscription.setup_fee_paid_at DateTime?`.
- `createCheckout` adds a `setup` line item when `setup_fee > 0` and `setup_fee_paid_at` is null; the webhook handler stamps it on success.
- No billing-cycle condition — the waiver was dropped, so the fee is flat on monthly and yearly.
- Referral discount: exclude it, matching how add-ons are already excluded.
- Values: Starter 0, Growth 4000, Business 15000, Enterprise handled by contract.

### 3.2 Capacity quantity

`TenantAddonSubscription` has no `quantity`, and `TenantSubscription` has no `extra_branches`.

- Migration: `TenantAddonSubscription.quantity Int @default(1)`.
- New add-ons: `EXTRA_BRANCH` (৳400, grants `maxStores: 1`), `EXTRA_USERS_5` (৳300, grants `maxUsers: 5`).
- **`mergeAddonFeatures` changes semantics:** today numeric grants take `Math.max(plan, addon)`. Capacity packs need `plan + (addon × quantity)`. That is a real behavioural change to a function the entitlement system depends on — write the tests first. Booleans keep OR.
- `createCheckout` and both renewal paths multiply add-on price by quantity.

Do not ship 3.2 before Phase 2, or a tenant buying user packs is paying for seats their own employees are consuming.

---

## Phase 4 — One registry drives the matrix

**Goal:** a platform admin toggling an entitlement changes the public pricing page without a deploy.
**Effort:** ~3 days. **No migration.**

`PLAN_COMPARISON_ROWS` in `apps/frontend/src/lib/marketing/plans.ts` is 16 hardcoded rows that already disagree with the database — it shows lead management as Premium-only while Standard carries `premiumCrm: true`.

- Extend `PlanEntitlementDefinition` with `marketingLabel`, `matrixGroup`, `showInMatrix`, `displayOrder`.
- `GET /subscription-plans` returns the matrix shape; `/pricing` renders from it.
- Same component serves the in-app upgrade screen with the tenant's current column highlighted, and the admin plan editor.
- Delete `PLAN_COMPARISON_ROWS` and `MARKETING_PLANS`' feature arrays. Keep a static fallback for when the API is down — the page already has this pattern in `buildMarketingPlansFromApi`.
- `packages/shared-types/*.test.ts` is executed by nothing today (frontend jest matches `src/**`, backend `testRegex` is `.spec.ts`). Fix that here, since this phase puts real logic in that package.

---

## Phase 5 — Plans as data

**Goal:** publish, hide or add a plan without a deploy. Unblocks Enterprise.
**Effort:** ~3 days. **One migration, and a careful one.**

`SubscriptionPlanCode` is a Prisma enum and `SELF_SERVE_SUBSCRIPTION_PLAN_CODES` / `COMING_SOON_SUBSCRIPTION_PLAN_CODES` are code constants, so a fourth rung costs a migration plus a deploy plus a shared-types release.

- Migration: `is_public`, `is_self_serve`, `sort_order` on `SubscriptionPlan`; widen `code` to `String @unique`.
- Retire the two constant arrays; `isSelfServeSubscriptionPlan` reads the columns.
- Keep the enum's values as data so webhooks and existing `TenantSubscription` rows keep resolving. Payment provider payloads carry plan codes — check `billing.service.ts`'s webhook parsing before dropping the enum type.
- Then add `ENTERPRISE` as a row: `is_public: true`, `is_self_serve: false`.

---

## Phase 6 — Build what the matrix marks "in development"

Independent of the above; can run in parallel. Ordered by cost-to-value.

| Item | Size | Note |
|---|---|---|
| Customer order-history page | ~1 day | Backend already done — `GET :slug/customer/orders` exists and `getCustomerOrders` is called from nowhere in `apps/frontend`. Pure frontend. |
| Storefront custom domain | ~3–5 days | `storefront_slug` is the only routing today. Needs domain verification, TLS via Caddy (already the reverse proxy), and a tenant-facing setup flow. Sold on Business. |
| Imports & LC module | ~3–4 weeks | Design exists: `docs/lc-imports-and-proforma-invoice-plan.md`. Nothing in the schema yet. Register `premiumImports` when it lands and reactivate the add-on. |
| Book publishing module | ~3–4 weeks | `premiumBookPublishing` is in the registry and gates nothing; no backend module. Vertical add-on at ৳799. |
| SSO / dedicated database | Enterprise-driven | Do not build speculatively — build it for the first signed Enterprise contract that requires it. |

---

## Risks

**The enforcement sweep is where this fails.** It is unglamorous, spans ~110 controllers, and every other phase looks more interesting. If it stalls half-done, the matrix is published against partial enforcement, which is worse than today because the promises are now written down. Treat Phase 1 as the gate on publishing the new `/pricing`.

**`mergeAddonFeatures` is load-bearing.** Phase 3.2 changes numeric merge from max to additive. Every entitlement read in the app flows through it — `getFeaturesForTenant` is called on `/auth/me`. Tests before code.

**Grandfathering is only as good as the discount path.** Until `createCheckout` applies the subscription discount, any grandfathered tenant who re-subscribes silently loses their old price. That is a trust problem, not a billing bug.

**Repricing is not reversible in customers' minds.** Starter dropping from ৳499 to ৳299 is fine. Premium rising 67% will be noticed by every existing Premium tenant even if they are grandfathered — decide the message before the number changes.

---

## Not in scope

- Per-seat pricing (rejected — shared logins destroy the audit trail)
- Metering products, warehouses, or transactions
- A transaction fee on storefront orders (we are not in the payment path)
- Retro-paywalling the storefront or anything else tenants already have
