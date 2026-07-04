# Epic 07: Platform Operations Console

### Epic Goal
Give the platform's own operators (not tenant staff) the tools to onboard tenants directly, manage the roster of platform admins, and handle the manual/offline side of billing — payments, refunds, and credit top-ups — outside the self-serve signup and payment-gateway flows.

### Epic Description
This is internal tooling built up around `apps/backend/src/admin-tenants/` as the platform grew — it was never scoped as its own epic in the PRD even though it's now a large surface area distinct from Epic 03 (tenant-facing subscription/billing) and Epic 90 (tenant-internal RBAC). Everything here sits behind `PlatformAdminGuard` and is invisible to tenant users.

**Integration Points:**
* Reuses the shared `BillingEvent` table (tagged `provider_name: 'manual'`) for admin-recorded payments/refunds/credit sales, so they show up alongside real payment-gateway webhooks.
* Tenant creation bootstraps the same defaults a self-signup gets: default tenant roles, an OWNER `TenantUser`, a default `Store`, a `PAST_DUE` `TenantSubscription`, and a bootstrapped chart of accounts.
* Every mutating action writes an `AuditService.log()` entry.

### Stories

1. **Story 1: Admin-Created Tenant Provisioning**
   * **Description:** A platform admin can create a tenant directly for either a brand-new owner (auto-provisions a `User` with a "set your password" email) or an existing user (looked up by email), picking a plan code and store name. Runs as one transaction: `Tenant`, default `TenantRole`s, OWNER `TenantUser`, default `Store`, `PAST_DUE` `TenantSubscription`, store access/permissions, and bootstrapped accounting.
   * Status: Done — `POST /admin/tenants` (`admin-tenants.controller.ts`), `AdminTenantsService.createTenant()`, `apps/frontend/src/components/admin/tenants/CreateTenantModal.tsx`. See `docs/superpowers/plans/2026-06-16-admin-create-tenant.md`.

2. **Story 2: Platform Admin Users Management**
   * **Description:** CRUD for the platform-admin roster itself (distinct from tenant staff): list/create/edit/delete, promote/demote a user to platform admin, reset password directly or send a reset email. Refuses to demote yourself or the last remaining admin.
   * Status: Done — `apps/backend/src/admin-tenants/admin-users.controller.ts` (`/admin/users*`), `apps/frontend/src/app/(app)/admin/users/page.tsx`.

3. **Story 3: Tenant Ledger, Manual Payments & Credit Sales**
   * **Description:** A cross-tenant ledger (running balance computed client-side from signed `BillingEvent` deltas) plus actions to record a manual payment (auto-reactivates a `PAST_DUE` subscription), record a refund, sell SMS credits (against the real `SmsTransaction` ledger), and sell AI credits (a flat increment to `Tenant.ai_credits_bonus`, no per-transaction ledger).
   * Status: Done — `GET/POST /admin/tenants/:tenantId/ledger|payments|refunds|sms-credits|ai-credits`, `ledger-balance.util.ts`, `apps/frontend/src/app/(app)/admin/tenants/ledger/page.tsx`.

4. **Story 4: Tenant API Key Management**
   * **Description:** Tenants can generate, list, and revoke API keys (`rsk_live_...`, stored as a salted hash) for third-party integrations, gated behind a paid-plan `apiAccess` feature and rate-limited per plan tier.
   * Status: Partial — key issuance/revocation is fully built (`apps/backend/src/api-keys/`), but the authentication path that would let a request actually use one (`CombinedAuthGuard`, `ApiKeyGuard`, `ApiKeyRateLimitGuard`) is implemented and tested yet not wired via `@UseGuards` to any live endpoint — no shipped API route currently accepts an API key.

### Notes
All four stories were already implemented before this epic doc was written. This file only closes the documentation gap — no functional changes accompany it. Story 4's partial status reflects a real product gap (issued keys can't yet authenticate anything) worth a follow-up, not a documentation-only note.
