# Simplified Signup + Store Rename + Configurable Default Plan

**Date:** 2026-07-10
**Status:** Approved — ready for planning

## Goal

Reduce signup friction and increase conversion via progressive onboarding. Collect the
minimum information needed to create a working account, and defer the rest to settings
after the user is inside the app.

## Current State

Signup today (`apps/backend/src/auth/auth.dto.ts` `SignupDto`,
`apps/frontend/src/app/signup/page.tsx`) collects 6 required fields across three entities
(User + Tenant + Store), all created in one transaction:

- **Required:** email, password, mobile, org (tenant) name, store name, and — on the
  frontend only — "your name".
- **Optional:** address, plan code, referral code, mobile country code.

`provisionTenant` (`auth.service.ts`) only runs when both `tenantName` and `storeName` are
present. The subscription plan defaults to `BASIC`, hardcoded in two places
(`page.tsx:71` form state and `auth.service.ts:496` backend fallback). There is no
admin-configurable default plan. There is **no endpoint to rename a `Store`** after
creation.

## Target Field Set

| Field | Before | After |
|---|---|---|
| Org (tenant) name | required | **required** (unchanged) |
| Admin email | required | **required** (unchanged) |
| Password | required | **required** (unchanged) |
| Mobile | required | **optional** |
| Store name | required | **removed** → auto `"Main Store"` |
| Your name | required (frontend) | **removed** → defaults to email local-part |
| Plan | optional (default BASIC) | plan picker kept; default from platform settings |

Result: **3 required fields on the signup screen** (org name, email, password) plus the
plan picker and an optional mobile field.

## Design

### 1. Backend — `SignupDto` (`apps/backend/src/auth/auth.dto.ts`)

- `storeName` → `@IsOptional()`.
- `mobile` → `@IsOptional()` (remove the "Mobile number is required." message).
- `name` — already optional; unchanged.

### 2. Backend — `signup()` (`apps/backend/src/auth/auth.service.ts`)

- **Mobile handling:** the normalize block (currently ~lines 61–70) runs **only when a
  non-empty mobile is provided.** When absent, `mobile` / `mobile_country_code` are left
  null. When present, keep the existing normalization and E.164 validation, but **remove
  the uniqueness check** — duplicate mobiles are now allowed (see section 6).
- **Name default:** when `dto.name` is empty, default `User.name` to the email local-part
  (the substring before `@`).
- **Tenant provisioning:** call `provisionTenant` whenever `dto.tenantName` is present
  (store name no longer gates it). Inside provisioning, the store name is
  `dto.storeName?.trim() || "Main Store"`.
- **Plan default:** replace the hardcoded `dto.planCode ?? 'BASIC'` with
  `dto.planCode ?? <default from platform settings>` (see section 5).

### 3. Frontend — signup form (`apps/frontend/src/app/signup/page.tsx`)

- Remove the "Your name" and "Store name" inputs and their state.
- Remove client-side validation `nameRequired`, `storeNameRequired`, and `mobileRequired`.
  Keep required validation for org name, email, and password.
- Mobile field stays but is optional; label/placeholder marked optional
  (e.g. `01XXXXXXXXX (optional)`).
- Keep the plan picker cards. Pre-select the plan returned by the API default (section 5)
  instead of the hardcoded `'BASIC'`; the `?plan=` query param still overrides.
- **Placeholders:** generic-but-meaningful, no real names. Org name → `Dhaka Retail Co.`,
  email → `you@yourbusiness.com`, mobile → `01XXXXXXXXX (optional)`.

### 4. Store rename (new capability)

Because the store is now auto-named `"Main Store"`, users need a way to rename it.

- **New `stores` module** in `apps/backend/src/stores/` (none exists today): controller +
  service.
- **Endpoint:** `PATCH /stores/:id` with body `{ name: string }`. Scoped by
  `TenantInterceptor` (must belong to the caller's tenant). Gated to the tenant owner or a
  new `MANAGE_STORES` permission added to `packages/shared-types/index.ts`.
- **Read path:** a `GET` to fetch the tenant's store(s) for the settings screen (reuse an
  existing store-listing path if one exists; otherwise add `GET /stores`).
- **Settings UI:** a store-name field in settings (alongside the branding page,
  `apps/frontend/src/app/(app)/settings/branding/`, or a dedicated store settings page)
  that loads the current store name and PATCHes updates.

### 5. Admin-configurable default plan

- **New setting:** add `default_signup_plan` to the `general` group in `SETTINGS_SCHEMA`
  (`apps/backend/src/platform-settings/platform-settings.service.ts`), with in-code schema
  default `STANDARD`. Editable by platform admin via existing platform-settings UI.
- **Seed:** ensure the seeded/effective default is `STANDARD` (schema default suffices;
  no DB seed row is strictly required since `getRawValue` falls back to the schema
  default).
- **Expose publicly:** extend the existing unauthenticated `GET /auth/plans`
  (`auth.controller.ts` / `auth.service.ts`) response to include `defaultPlanCode`, read
  via `platformSettings.getRawValue('general', 'default_signup_plan')`.
- **Frontend:** signup form uses `defaultPlanCode` as the initial selected plan.
- **Backend fallback:** `signup()` uses the same setting when `dto.planCode` is absent.

### 6. Allow duplicate mobile numbers

One person may own multiple businesses and reuse the same mobile across separate accounts,
so mobile is no longer unique.

- **Schema:** drop `@unique` from `User.mobile` (`packages/database/prisma/schema.prisma:202`
  → `mobile String?`).
- **Migration:** a Prisma migration that drops the unique index on `User.mobile`
  (`npm run db:migrate` in `packages/database`).
- **Code:** remove the `findFirst({ where: { mobile } })` duplicate check in `signup()`
  (currently ~lines 67–70). Normalization/validation of a provided mobile stays.
- The tenant-scoped `@@unique([tenant_id, mobile])` on the other model
  (`schema.prisma:1411`) is unrelated and stays as-is.

## Out of Scope / Notes

- Making mobile optional means no guaranteed mobile-for-OTP/recovery at signup. Email
  verification still covers account verification, so this is acceptable.
- The `Tenant.name` rename gap (org name not editable post-signup) is **not** addressed
  here — that remains a separate future task; only store rename is in scope.

## Testing

- Signup with only org name + email + password succeeds; creates User (name = email
  local-part), Tenant (name = org name), Store (name = "Main Store"), and a subscription
  on the configured default plan.
- Signup with a mobile provided still normalizes/validates it; a **duplicate mobile is
  now accepted** (two accounts can share one mobile).
- Signup with no mobile leaves mobile null.
- Plan picker pre-selects the platform-settings default; `?plan=` overrides it.
- `PATCH /stores/:id` renames a store within the caller's tenant; cross-tenant rename is
  rejected; unauthorized role without `MANAGE_STORES` is rejected.
- `GET /auth/plans` returns `defaultPlanCode` and requires no auth.
