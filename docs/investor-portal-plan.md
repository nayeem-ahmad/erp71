# Investor Portal — implementation plan

Status: **proposal, not yet built.** Written 2026-08-05.

Goal: an investor logs in and sees their own capital, their own monthly profit
shares, and their own statement — and nothing else about the business.

---

## 1. What already exists

The accounting half of this is done. `feat(accounting): investors on a monthly
share of profit` (PR #460, 2026-08-05) shipped:

| Piece | Location |
|---|---|
| `Investor`, `InvestorCapitalTxn`, `InvestorProfitRun`, `InvestorProfitShare` | `packages/database/prisma/schema.prisma:3517-3654` |
| Service + controller (staff-facing) | `apps/backend/src/investors/` |
| Permissions `VIEW_INVESTORS` / `MANAGE_INVESTORS` | `packages/shared-types/index.ts:92-94` |
| Staff UI | `apps/frontend/src/app/(app)/accounting/investors/page.tsx` |
| Control account `210501 Investor Profit Payable`, `party_type: INVESTOR` | `packages/database/prisma/bootstrap-accounting.ts` |

Two consequences matter for this plan:

1. **`Investor` has `name`/`email`/`phone` but no `user_id`.** There is no way
   for an investor to authenticate as themselves. That is the gap.
2. **`Investor Profit Payable` is already a `PartyType.INVESTOR` control
   account.** A per-investor statement therefore falls out of the existing
   `buildPartyLedger` with no new query code — the portal's most valuable screen
   is close to free.

## 2. What already exists for *portal logins*

Two precedents, taking opposite approaches:

**Storefront customer** (`apps/backend/src/storefront/`, `apps/frontend/src/app/store/[slug]/`)
— a separate route tree, its own sign-in page, its own token scope
(`AUTH_SCOPE_STOREFRONT`) and its own revocation counter
(`User.storefront_token_version`). Heavy, because anyone can self-signup, so a
storefront token had to be made structurally incapable of being an ERP token.

**Referral partner** (`apps/backend/src/referrals/referee-portal.controller.ts`,
`apps/frontend/src/app/(app)/referrals/`) — the *same* login page, the same
token, a `Referee.user_id` link, a `RefereeGuard` that resolves the domain row
from `request.user` and attaches it, and a route inside the existing `(app)`
shell activated by `localStorage.active_context === 'referee'`. Light, because
referees are admin-provisioned, not self-registered.

Investors are admin-provisioned. **The referral-partner pattern is the template.**

---

## 3. Architecture decision

### Options considered

**A. Separate portal, separate token scope** (storefront-style).
New login page, `AUTH_SCOPE_INVESTOR`, `investor_token_version`, own password
reset. Strongest isolation.
*Rejected:* it duplicates the entire auth surface — lockout, throttling, 2FA,
reset — and every duplicate is a new place to get it wrong. Worse, a token can
carry only one scope, so **a shop owner who is also an investor** (the common
case for an SME partnership) would have to log out of their own shop to read
their statement.

**B. Give investors a `TenantUser` row with `VIEW_INVESTORS`.**
*Rejected outright:* `VIEW_INVESTORS` lists *every* investor with their
percentages and payouts. Partner A would see Partner B's terms. A `TenantUser`
row also grants tenant context to every other module.

**C. Referee-style context on the existing login. — RECOMMENDED**
Same `/login`, same JWT (`scope: app`), an `Investor.user_id` link, an
`InvestorPortalGuard`, portal routes inside `(app)` gated by
`active_context === 'investor'`. Dual-role users switch contexts without logging
out. Zero new auth surface.

### Why C is safe without a token scope

An investor-only user has **no `TenantUser` row**. That makes their app token
inert against staff endpoints, by two independent mechanisms:

- `TenantInterceptor` (`apps/backend/src/database/tenant.interceptor.ts:52-61`)
  finds zero memberships and never sets `request.tenantId`.
- `@Tenant()` (`apps/backend/src/database/tenant.decorator.ts:12-15`) then
  **throws** `BadRequestException` for any authenticated user with no resolved
  tenant.

I audited this rather than assuming it: **75 controllers take tenant via
`@Tenant()`; only 3 read `req.tenantId` directly** (`auth`, `navigation`,
`invitations`). `StorePermissionGuard` independently requires a `TenantUser`
row. So the blast radius is small, enumerable, and testable — see §7.

This is the honest trade: option A's isolation is *structural*, option C's rests
on that invariant holding. The mitigation is to pin it with a test that fails
loudly if it ever stops holding, and to audit those 3 controllers before build.

---

## 4. Data model

Migration in `packages/database/prisma/`. No chart-of-accounts change, so **no
`sync:accounting` run is needed** for this work.

```prisma
model Investor {
  // ...existing fields...

  /// The login this investor reads their own statement with. Nullable: most
  /// investors are book-keeping records with no portal access.
  user_id          String?
  /// Owner-controlled kill switch. Revoking this ends portal access on the next
  /// request without unlinking the account or touching the person's other
  /// sessions (they may also be staff, or an investor at another tenant).
  portal_access    Boolean   @default(false)
  portal_invited_at DateTime?
  portal_linked_at  DateTime?

  user User? @relation(fields: [user_id], references: [id])

  // Scoped per tenant, not globally — one person may back several shops on this
  // platform, exactly as Customer.user_id is scoped (schema.prisma:1501-1554).
  // A global @unique (as Referee uses) would forbid that.
  @@unique([tenant_id, user_id])
}
```

`User` gets the back-relation `investorProfiles Investor[]`.

**No `investor_token_version`.** Revocation is `portal_access = false`, which the
guard re-reads on every request — it already hits the database. A version
counter would be a second, weaker mechanism for the same job, and bumping
`token_version` would sign the person out of their staff session too.

---

## 5. Backend

New directory `apps/backend/src/investor-portal/` (separate from `investors/`,
which is staff-facing and guarded by `StorePermissionGuard`).

### `investor-portal.guard.ts`

Mirrors `referrals/referee.guard.ts`. Resolves the caller's investor rows,
selects the active one, attaches `request.investor` **and**
`request.tenantId = investor.tenant_id`.

Three deliberate deviations from `RefereeGuard`:

1. **No email fallback.** `resolveActiveRefereeForUser` falls back to matching on
   email and lazily back-links `user_id`. That is safe there because
   `Referee.email` is globally `@unique` and platform-admin provisioned.
   `Investor.email` is free text typed by a shop owner — an email collision would
   hand a stranger a partner's financials. **Link by `user_id` only.**
2. **Tenant comes from the `Investor` row, never from `x-tenant-id`.** This is
   the load-bearing property: an investor must not be able to widen their scope
   with a header.
3. **Multiple contexts.** A user may be an investor at several tenants, so the
   guard reads an `x-investor-id` header and validates
   `investor.user_id === req.user.userId && investor.portal_access`. Absent
   header with exactly one investor row auto-resolves; with more than one it
   throws, matching `TenantInterceptor`'s behaviour.

Portal controllers use `@UseGuards(JwtAuthGuard, InvestorPortalGuard)` and
**neither `TenantInterceptor` nor `StorePermissionGuard`** — both resolve tenancy
from `TenantUser` membership, which an investor does not have.

### `investor-portal.controller.ts` — read-only, no client-supplied investor id

| Route | Returns |
|---|---|
| `GET /investor-portal/me` | name, agreed share %, status, joined/exited, store scope, portal contexts |
| `GET /investor-portal/me/summary` | capital in/out/net, total accrued, total paid, outstanding payable, loss carry-forward |
| `GET /investor-portal/me/capital` | own `InvestorCapitalTxn` rows — date, direction, amount, method, reference |
| `GET /investor-portal/me/shares` | own `InvestorProfitShare` rows joined to their run — month, basis, share %, amount, `loss_applied`, `ACCRUED`/`PAID` |
| `GET /investor-portal/me/statement` | `buildPartyLedger(tenantId, PartyType.INVESTOR, investorId)` |
| `GET /investor-portal/me/statement.pdf` / `.csv` | same, rendered |

Every route derives the investor from `request.investor`. **No route accepts an
investor id from the client** — that removes the entire IDOR class rather than
guarding against it.

`InvestorsService.get()` already returns capital txns and profit shares with run
detail (`investors.service.ts:61-79`), so the portal service is mostly projection
and field-stripping, not new queries.

### Provisioning — `investors.service.ts` (staff side)

`POST /investors/:id/portal-invite`, `DELETE /investors/:id/portal-access`, both
`@RequireStorePermission(MANAGE_INVESTORS)`. Copy `ensureRefereeUserAccount` +
`passwordReset.requestRefereeInvite`: find-or-create a `User` by email with a
random bcrypt'd password, set `Investor.user_id` + `portal_access`, mint a
1-hour `PasswordResetToken`, email a set-password link. Requires
`Investor.email`; reject with a clear message when it is empty.

If the email already belongs to a `User`, **link, don't create** — that is
exactly the shop-owner-is-also-an-investor case, and it must not fail.

---

## 6. Frontend

Following the referee wiring end to end:

| File | Change |
|---|---|
| `src/lib/auth-session.ts:14-32` | add `investors: []` to `LoginContexts`; include each in `count` |
| `src/lib/auth-session.ts:35-44` | `applyInvestorContext(investor)` — set `active_context='investor'` + `investor_id`, **remove `tenant_id`/`store_id`** (a stale `x-tenant-id` would make `TenantInterceptor` throw `Invalid tenant context`) |
| `src/lib/api.ts:107-119` | attach `x-investor-id` when in investor context |
| `src/app/select-account/page.tsx` | a tile per investor context, beside the shop and referee tiles |
| `src/app/(app)/layout.tsx:154` | `inInvestorMode`; redirect rule mirroring `:330-332`; pass to `<Sidebar>` |
| `src/components/Sidebar.tsx:211` | `if (investorMode)` short-circuit — a single "My Investment" branch |
| `src/lib/routes.ts` | `investorPortal: '/investor-portal'` |
| `src/app/(app)/investor-portal/page.tsx` | new — summary tiles, capital table, shares table, statement link |
| `src/lib/localization/messages/{en,bn,ms}/` | all three locales, as the investors module already does |

`/auth/me` (`auth.service.ts:282-335`) gains an `investors` array so
`getLoginContexts` can see them.

UI per `docs/ui-design-guidelines.md`: `PageShell` + `PageHeader`, `ModalShell`,
`blue-600` accent, `formatBDT()` for every amount, `DataTable` with
`hideOnMobile` on secondary columns.

---

## 7. Security invariants — each gets a test

These are the point of the feature; they are not optional follow-up.

1. **An investor-only token is inert against staff endpoints.** A user with no
   `TenantUser` row gets `400`/`403` from a representative `@Tenant()` controller.
   This pins the invariant §3 relies on.
2. **Investor A cannot read Investor B.** No portal route accepts an id; assert
   the shape rather than the filtering.
3. **Header spoofing.** `x-tenant-id` and `x-investor-id` naming another
   tenant/investor are rejected, not honoured.
4. **`portal_access = false` ends access on the next request**, with no logout
   and with the person's staff session (if any) untouched.
5. **No email-fallback linking** — an `Investor.email` matching an unrelated
   `User` grants nothing.
6. **A dual-role user** (staff + investor at the same tenant) reads their own
   statement in investor context and their shop in tenant context, on one token.
7. **Field-stripping**: portal payloads contain no other investor's name,
   percentage or amount, and no voucher lines outside their own party.

Pre-build audit task: confirm `auth`, `navigation` and `invitations` — the 3
controllers reading `req.tenantId` directly — degrade safely for a user with no
membership.

---

## 8. Phasing

**Phase 1 — login and identity.** Migration; `InvestorPortalGuard`; `GET
/investor-portal/me` + `/summary`; invite/revoke endpoints and the buttons in the
staff investor drawer; `/auth/me` contexts; `select-account` tile; sidebar and
layout gating; a portal page showing summary tiles only. All of §7 lands here —
the security tests belong with the login, not after it.

**Phase 2 — the numbers.** Capital ledger, profit-share history, the
`buildPartyLedger` statement, PDF/CSV export.

**Phase 3 — proactive.** `Notification` on run posted and payout made; bn/ms
copy review; user-manual page; contextual help entry.

Phases 1 and 2 are each one reviewable PR. Phase 3 is optional polish.

---

## 9. Decisions needed before build

These change the work, and they are the shop owner's call, not mine.

1. **Does an investor see the company's net profit?** Their share is
   `basis × pct`, so showing the share while hiding the basis is only nominally
   private — and a partner arguably has a right to it. But an owner with a 5%
   partner may not want total profit disclosed. *Recommendation:* show it, with a
   per-tenant `investor_portal_show_profit_basis` toggle defaulting on.
   Store-scoped investors already see only their store's basis.
2. **Do `EXITED` investors keep access?** Their payout history is their own
   financial record and they may need it after leaving. *Recommendation:* yes,
   read-only, with `portal_access` as the owner's kill switch — status and access
   stay independent.
3. **Confirm option C over A** (§3). C is materially less code and does not break
   the owner-is-also-an-investor case; A is structurally stronger. If investors
   here are expected to be arms-length outsiders rather than partners, A becomes
   worth its cost.

## 10. Out of scope

No write actions from the portal — no requesting a withdrawal, no acknowledging
a payout, no editing profile. Read-only removes a whole class of risk from a
surface handling other people's money, and nothing in the request needs it.

Also unchanged: the three open investor items in `TODO.md` (partial share
payment, mid-month pro-rating, scheduled runs). The portal displays whatever the
accounting module decides; it does not depend on any of them.
