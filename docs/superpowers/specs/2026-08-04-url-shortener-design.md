# URL Shortener & Public Share Links — Design

**Date:** 2026-08-04
**Status:** Approved for planning

---

## Problem

Users want to share a quotation with a customer, or a storefront product, over WhatsApp. Today they cannot.

- `SalesQuotationsController` is entirely authenticated CRUD. There is no URL a customer without an ERP71 login can open.
- The storefront has no per-product page. `/store/[slug]/shop` is a single page with filters in query params, so there is nothing to link to.
- The only shareable URLs that exist are long authenticated app URLs, which show a customer a login wall.

A shortener alone does not solve this. The shortener is the small half; the missing half is public, login-free views to point the short links at.

Separately, platform staff and tenant admins want a general-purpose shortener for campaign links.

## Scope

In scope:

1. Public, token-authorized quotation view (read-only, printable).
2. Public storefront product page.
3. A generic `ShortLink` table and `/s/[code]` resolver with click counts.
4. Share UI on the quotation detail page and storefront product card.
5. A paste-a-URL shortener page for platform staff (`/admin/url-shortener`) and for tenants (`/settings/url-shortener`).

Out of scope, deliberately:

- Accept/Reject buttons on the public quotation, and any comment thread. Both need their own abuse handling, audit trail, and notification design. Separate spec.
- Custom/vanity short codes. Adds a collision UI, a reserved-word list, and a moderation surface for tenant-chosen codes on our domain.
- Link expiry. See "Access model" for why.
- Server-side PDF generation. The existing print-CSS approach is reused.

## Architecture

Three layers, each independently useful:

1. **Public views** — pages a customer opens with no login.
2. **Share tokens** — the unguessable secret authorizing a public view.
3. **ShortLink** — a generic code-to-URL alias with click counts.

The token is the authority; the short code is only an alias. This is what makes revocation work: regenerating a quotation's token kills every link ever sent for it, short or long, because they all resolve through the token.

### Access model

Public quotation links use an unguessable token with no expiry, revocable from the quotation page. Same model as Stripe and Xero invoice links.

No expiry, deliberately: a customer opening an old WhatsApp message hits a working page rather than a dead link and a phone call. Staleness is handled by showing the quotation's validity date on the page, not by breaking the URL.

### Data model

One new model in `packages/database/prisma/schema.prisma`:

```prisma
enum ShortLinkKind {
  ENTITY
  MANUAL
}

enum ShortLinkEntity {
  QUOTATION
  STOREFRONT_PRODUCT
}

model ShortLink {
  id            String    @id @default(uuid())
  /// Null for links minted by platform staff, who sit outside any tenant.
  tenant_id     String?
  /// 7-char base62 (~3.5T space). Unique globally; insert retries on collision.
  code          String    @unique
  /// Internal path ("/q/aB3x..") or absolute http(s) URL. Validated by isSafeTarget().
  target_url    String
  /// Human label for the admin list. Manual links only.
  label         String?
  kind          ShortLinkKind
  entity_type   ShortLinkEntity?
  entity_id     String?
  click_count   Int       @default(0)
  last_click_at DateTime?
  created_by    String?
  created_at    DateTime  @default(now())
  revoked_at    DateTime?

  tenant Tenant? @relation(fields: [tenant_id], references: [id], onDelete: Cascade)

  @@index([tenant_id, created_at])
  @@index([entity_type, entity_id])
}
```

Two columns on `Quotation`:

```prisma
share_token    String?   @unique
share_token_at DateTime?
```

`target_url` is frozen at creation. If storefront URLs are later restructured, existing short links break. Resolving live from `entity_id` would survive that, but it is more coupling than this warrants today; `entity_type` and `entity_id` are stored, so a backfill is always possible.

`tenant_id` is nullable because platform staff are not members of a tenant. A null `tenant_id` means a platform-owned link.

### Target validation

`isSafeTarget()` lives in its own file with its own test file. It is the security-critical unit of this feature and the one place a mistake turns `app.erp71.com` into a phishing vector.

It accepts:

- An internal path beginning with a single `/` (a leading `//` is protocol-relative and must be rejected).
- An absolute URL whose scheme is exactly `http` or `https`.

It rejects:

- Any other scheme, notably `javascript:` and `data:`.
- Private, loopback, and link-local hosts: `localhost`, `127.0.0.0/8`, `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `169.254.0.0/16`, `::1`, and IPv6 unique-local `fc00::/7`.
- URLs carrying embedded credentials (`https://user:pass@host`), which are a classic display-spoofing trick.
- Internal paths under `/login`, `/signup`, `/reset-password`, `/verify-email`, and `/accept-invitation`. Shortening an auth path lets a link on our own domain drive someone into a credential form from an untrusted context.

Everything else on the create path is ordinary CRUD.

### Redirect behavior

`/s/[code]` resolves the code, then:

- **Internal target** — straight 302, no friction. A customer opening a shared quotation never sees an extra click.
- **Off-domain target** — an interstitial page naming the destination host, with a continue button. `app.erp71.com/s/xyz` can never silently bounce a visitor to a third-party site.
- **Unknown, revoked, or unsafe** — 404 page.

The click write is best-effort and must never block or break the redirect. This follows the precedent set by the referral route at `apps/frontend/src/app/r/[code]/route.ts`, which documents the same reasoning: a tracking failure must not stop someone reaching their destination.

## Components

### Backend

`apps/backend/src/short-links/`

- `is-safe-target.ts` — pure validation, no dependencies.
- `short-links.service.ts` — `create()`, `resolve()` (increments click count), `list()`, `revoke()`. Code generation retries on unique-constraint collision.
- `short-links.controller.ts`
  - `GET /short-links/resolve/:code` — public, no guard. Covered by the global `ThrottlerGuard`.
  - `POST /short-links` — `JwtAuthGuard` + `TenantInterceptor` + `MANAGE_SHORT_LINKS`. Tenant-scoped manual links.
  - `GET /short-links` — as above; lists the tenant's own links.
  - `DELETE /short-links/:id` — as above; sets `revoked_at`.
- `short-links-admin.controller.ts` — `JwtAuthGuard` + `PlatformAdminGuard`, at `admin/short-links`. Lists and creates platform-owned links only (`tenant_id: null`), never another tenant's; no `TenantInterceptor`. Revoke stays unscoped, so support can kill an abusive link anywhere.

`apps/backend/src/sales-quotations/`

- `POST /sales-quotations/:id/share` — ensures `share_token`, creates or reuses the `ShortLink`, returns the short URL. Idempotent: reopening the modal returns the same link rather than minting a new code.
- `DELETE /sales-quotations/:id/share` — clears `share_token`, revoking every link for that quotation.
- `GET /public/quotations/:token` — public, no guard, returns the sanitized DTO.

Both share endpoints require the existing quotation permission, not `MANAGE_SHORT_LINKS`. Sharing a quotation is a normal part of selling; it should not need a settings-level permission.

### The sanitized DTO

The highest-risk file in this build. It must be an explicit allow-list of fields, never a spread of the Prisma row.

Included: quotation number, version, status, issue date, validity date, customer name, seller (store) name, notes, line items (product name, quantity, unit price, line total), and the total amount.

There is no subtotal, discount or tax line: `QuotationItem` carries only `quantity` and `unit_price`, and `Quotation` carries a single `total_amount`. The public view shows what the record actually holds rather than inventing a breakdown.

Excluded: cost price, margin, internal notes, `created_by`, `tenant_id`, and every internal ID.

Its test asserts on the exact key set of the response. A column added to `Quotation` later cannot leak — the allow-list simply does not copy it, and the test stays green because the output is unchanged. What the test catches is someone widening the allow-list itself, which is the only path a new field has to a customer-facing page.

### Frontend

- `apps/frontend/src/app/s/[code]/route.ts` — resolver. Close to a copy of the existing `/r/[code]` handler.
- `apps/frontend/src/app/s/[code]/leaving/page.tsx` — off-domain interstitial.
- `apps/frontend/src/app/q/[token]/page.tsx` — public quotation view. Server component. Tenant branding, line items, totals, validity date. "Print / Save as PDF" uses `window.print()` with `print:` classes, the same mechanism the internal detail page already uses at `apps/frontend/src/app/(app)/sales/quotes/[id]/page.tsx:274`. No server-side PDF dependency.
- `apps/frontend/src/app/store/[slug]/p/[productId]/page.tsx` — public product page. The first per-product URL in the app. Reuses the storefront's existing public product fetch.
- `apps/frontend/src/components/share/ShareModal.tsx` — built on `ModalShell` per the UI rules. Shows the short URL, a Copy button, and a `wa.me` link, since WhatsApp is how these are actually sent. Opened from the quotation detail header and the storefront product card.
- `apps/frontend/src/app/(app)/admin/url-shortener/page.tsx` — platform staff. Paste a URL, get a code; table of all links with click counts.
- `apps/frontend/src/app/(app)/settings/url-shortener/page.tsx` — tenant-scoped equivalent.

Both pages use `PageShell` + `PageHeader`, `blue-600` for primary actions, and shared `@/components/ui` primitives, per the project UI rules.

### Permissions

One new entry in `StorePermission` (`packages/shared-types/index.ts`): `MANAGE_SHORT_LINKS`. Added to `ROLE_DEFAULT_PERMISSIONS` for MANAGER; OWNER receives it automatically via `Object.values(StorePermission)`. CASHIER and ACCOUNTANT do not get it.

It gates only the tenant Settings shortener page and the manual-link endpoints.

### Navigation

Two nodes in `packages/shared-types/navigation.ts`:

- `admin.url-shortener` — `parentId: 'admin'`, `href: '/admin/url-shortener'`, beside `admin.referrals`.
- `account-settings.url-shortener` — `href: '/settings/url-shortener'`, beside `account-settings.discount-codes`.

Both must ship in the default layouts, not only in `NAV_REGISTRY`. `apps/backend/src/navigation/nav-layout-merge.spec.ts:96` documents exactly this trap: `admin.referrals` was registered but present in no layout, leaving the platform referral screens registered, rendered, and effectively unreachable. Both new nodes get the same shipped-in-default-layout test plus the sibling sort-order collision check.

## Data flow

Sharing a quotation:

1. User clicks Share on the quotation detail page.
2. `POST /sales-quotations/:id/share` ensures `share_token`, then finds or creates a `ShortLink` with `target_url = /q/<token>`, `kind = ENTITY`, `entity_type = QUOTATION`.
3. Response returns `https://app.erp71.com/s/<code>`.
4. `ShareModal` shows it with Copy and WhatsApp actions.

A customer opening the link:

1. `GET /s/<code>` resolves the code and increments the click count, best-effort.
2. Target is internal, so a 302 to `/q/<token>`.
3. The page server-fetches `GET /public/quotations/<token>` and renders the sanitized quotation.
4. Print / Save as PDF uses the browser print dialog.

## Error handling

- Unknown, revoked, or unsafe short code: 404 page, no detail about why.
- Unknown or revoked quotation token: a plain "This link is no longer available" page. It must not distinguish "never existed" from "revoked", which would confirm the existence of a quotation to someone guessing.
- Resolver click-count write failure: swallowed. The redirect proceeds.
- Code-generation collision: retried on the unique-constraint violation, bounded number of attempts, then a 500.
- `isSafeTarget()` rejection on create: 400 with a message naming which rule failed, since this one is user-facing input.

## Testing

- `isSafeTarget()` — the bulk of the tests, weighted to hostile input: `javascript:`, `data:`, protocol-relative `//evil.com`, loopback and private hosts, embedded credentials, and case and whitespace variants.
- Sanitized DTO — asserts the exact key set, so widening the allow-list fails the test; unlisted new columns never reach the output at all.
- Code generation — retries on collision.
- Resolver — increments the click count; returns 404 for revoked links; internal targets 302 while off-domain targets route to the interstitial.
- Share endpoint — idempotent; a second call returns the same code.
- Revocation — clears the token; the public view then returns the unavailable page.
- Navigation — both nodes ship in the default layouts; no sort-order collision with siblings.
- Tenant scoping — a tenant's link list never includes another tenant's links.

## Risks

- **The sanitized DTO** is the one place a mistake exposes customer pricing and margins. Mitigated by the allow-list and the exact-key-set test.
- **`isSafeTarget()`** is the one place a mistake makes our domain a phishing vector. Mitigated by the interstitial, which means even a validation miss cannot produce a silent off-domain redirect.
- **Public endpoints bypass `TenantInterceptor` by design** — the token is the authorization. Each public endpoint must therefore resolve its own tenant scope from the token, never from a request parameter.
