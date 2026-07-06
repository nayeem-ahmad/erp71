# Epic 09: Pay-per-Module Add-on Marketplace

### Epic Goal
Let tenants buy individual premium modules (e.g. Manufacturing, Advanced Accounting) as standalone paid add-ons on top of their subscription plan, instead of forcing an upgrade to a higher plan tier just to unlock one feature.

### Epic Description
This is retroactive documentation, in the same spirit as Epic 07 — the feature was built and shipped (2026-07-05) before this epic existed in the PRD. It sits across Epic 03 (billing/entitlements) and Epic 07 (platform-admin tooling): platform admins curate the catalog, tenants browse and purchase from `/billing`, and purchased add-ons merge into the tenant's existing plan entitlements rather than replacing them.

**Integration Points:**
* `AddonModule` (catalog) and `TenantAddonSubscription` (purchase) Prisma models.
* `mergeAddonFeatures()` unions active add-ons' entitlements on top of the plan (plan ∪ add-ons, never restricts) — consumed by `PlanEntitlementsService`, `SubscriptionAccessGuard`, and auth session responses so `@RequiresFeature` checks and sidebar gating work identically whether an entitlement came from the plan or a purchased add-on.
* Billing checkout/confirm/manual-webhook endpoints accept `addonCodes[]` billed alongside the base plan in the same payment; the SSL Wireless add-on selection is recovered from the `CHECKOUT_CREATED` `BillingEvent` by reference (all 4 native SSLCommerz passthrough fields were already in use by other data).
* `BillingSchedulerService` runs the same retry-reminder / dunning-cancel / period-fee lifecycle for add-on subscriptions as it does for the base plan.

### Stories

1. **Story 1: Add-on Catalog & Entitlement Model**
   * **Description:** Data model for sellable add-on modules (code, name, price, feature entitlements) and per-tenant active subscriptions to them; entitlement resolution merges add-on features on top of the tenant's plan.
   * Status: Done — `AddonModule`/`TenantAddonSubscription` models, `mergeAddonFeatures()` (`packages/shared-types`), `apps/backend/src/addon-modules/addon-modules.service.ts`.

2. **Story 2: Admin Add-on Catalog Management**
   * **Description:** Platform admins can create, edit, price, and retire add-on catalog entries.
   * Status: Done — `addon-modules-admin.controller.ts`, `/admin/platform-settings/addons`.

3. **Story 3: Tenant Add-on Purchase & Billing Integration**
   * **Description:** Tenants can browse and purchase available add-ons from the billing page; purchase is billed through the same checkout/webhook/manual-payment paths as the base plan and follows the same retry/dunning lifecycle.
   * Status: Done — `addonCodes[]` accepted in checkout/confirm/manual-webhook flows, `/billing` purchase/cancel UI, scheduler lifecycle reuse.

4. **Story 4: Regate Existing Premium Features as Standalone Add-ons**
   * **Description:** Convert at least one existing plan-gated feature to be sellable independently as an add-on, without regressing tenants who already have it via their plan.
   * Status: Done — Manufacturing regated from `@RequiresPlan('PREMIUM')` to `@RequiresFeature('premiumManufacturing')`, with a data-migration backfill onto the existing PREMIUM plan row; `MANUFACTURING` and `ADVANCED_ACCOUNTING` catalog rows seeded.

### Notes
Two extensions were deliberately left out of this pass and are logged as follow-ups, not gaps in this epic:
* **Storefront as a paid add-on** — `storefront.controller.ts` currently has no gating at all (free for every tenant); turning it into a paid add-on needs a product decision on whether tenants with an already-live storefront are grandfathered in.
* **Book Publishing add-on** — no backend module exists yet; this would be net-new domain work (publishing-specific catalog/orders), not a regate of an existing module.
