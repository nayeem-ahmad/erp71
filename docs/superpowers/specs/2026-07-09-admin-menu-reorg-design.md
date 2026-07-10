# Admin & Settings Menu Reorganization — Design

**Date:** 2026-07-09
**Status:** Approved (design), pending implementation plan

## Problem

Two navigation surfaces have grown into long flat lists that are hard to scan:

1. **Platform Admin** (`admin` module, `DEFAULT_PLATFORM_ADMIN_NAV_LAYOUT`) — ~6 loose
   top-level links plus an `admin.platform-settings` subgroup holding **11 flat items**.
2. **Tenant Account Settings** (`account-settings` module) — **17 flat items** under one module.

Separately, when a tenant's subscription plan does not include a feature, its settings
menu item is still shown (or, for the few `premiumOnly` cases, hidden ad hoc). We want a
consistent rule.

Historically the tenant settings lived on a `/settings` **hub page** (a grid of cards).
Commit `684e2c8` flattened those into the sidebar. The user wants to restore the hub
pattern selectively.

## Goals

- Slim both menus so daily-use items stay one click away and the long tail is grouped.
- Restore a **hub page** (grid of category cards) for the grouped items.
- **Hide entirely** any item whose subscription-plan entitlement is not met — no empty
  cards, no upsell placeholder.

## Non-Goals

- No upsell / "Upgrade" badges on plan-excluded items (explicitly declined).
- No change to the underlying settings pages themselves — only where they are reached from.
- No new entitlement keys; reuse the existing registry in `subscription-plans.ts`.

## Design Principle: keep-direct vs. hub

For each item decide: **frequently used or standalone → keep as a direct sidebar link;
otherwise → move into a grouped hub page.** The hub page renders the moved items as
category-grouped cards.

## Section 1 — Platform Admin (`admin` module)

### Keep direct under Admin (sidebar)
- Overview → `/admin`
- Tenant Management subgroup (unchanged): Tenants, Ledger, Reminders
- Users → `/admin/users`
- Support → `/admin/support`
- System Health → `/admin/system-health`
- Status → `/status`

### Move into a **Platform Settings hub** page (`/admin/platform-settings`)
The `admin.platform-settings` subgroup collapses to a **single sidebar link** pointing at a
new hub page. The hub renders cards grouped by category:

- **Channels:** SMS · Email · WhatsApp · Payments
- **Plans & Billing:** Plans · Add-ons
- **Platform Config:** General · Tenant Features · Navigation · AI · Feedback Automation
- **Growth:** Referrals · Feedback

(`admin.referrals` and `admin.feedback`, currently loose top-level links, move into the hub
under Growth.)

The individual routes (`/admin/platform-settings/sms`, etc.) are unchanged — only their
sidebar entries are removed in favor of the hub link. Deep-linking still works.

## Section 2 — Tenant Account Settings (`account-settings` module)

### Keep direct in the module (sidebar)
- My Account → `/settings` (this page becomes the **hub**, see below)
- Team & Permissions → `/team` (`teamGated`)
- Billing → `/billing` (`billingGated`)

### Move into the **Settings hub** (`/settings`, i.e. `account-settings.overview`)
The `/settings` overview page is restored to a grid-of-cards hub. Cards grouped by category:

- **Business Profile:** Branding · Localization · Tax/VAT
- **Sales & POS:** POS Counters · Sales Settings · Payment Methods · Discount Codes · Loyalty
- **Communications:** SMS · Report Emails
- **Billing & Credits:** SMS Credits · AI Credits
- **Advanced:** Audit Logs (`teamGated`) · Data Management

Direct routes unchanged; only their sidebar entries are removed in favor of the hub.

## Section 3 — Plan-based visibility (hide entirely)

Extend the existing filter pattern so every hub card and direct link can carry an
**entitlement gate**, and unmet gates hide the item — in **both** the sidebar and the hub
cards, so the two surfaces never disagree.

- Current flags: `premiumOnly`, `advancedOnly` (nav registry) → resolved in
  `apps/frontend/src/app/(app)/layout.tsx` into `canAccess*` props → filtered in
  `Sidebar.tsx` (`filterChildren`).
- Generalize to a small set of entitlement gates keyed off `subscription-plans.ts`
  entitlements (e.g. `accountingOnly`, `multiStore`, `premiumCrm`, `premiumAi`,
  manufacturing/storefront platform features). The exact mapping of which settings item
  requires which entitlement is decided in the implementation plan by auditing each page.
- The **hub page** must apply the *same* gate check as the sidebar so a hidden item shows
  neither a sidebar link nor a hub card.
- Accounting-only mode already trims admin links via `ACCOUNTING_ONLY_ADMIN_LINK_HREFS`
  (`Sidebar.tsx`); the hub must honor the same list.

## Affected files (indicative)

- `packages/shared-types/navigation.ts` — registry entries + both layout trees
  (`DEFAULT_TENANT_NAV_LAYOUT`, `DEFAULT_PLATFORM_ADMIN_NAV_LAYOUT`); introduce hub-link
  nodes; drop moved items from the layouts.
- `apps/frontend/src/app/(app)/settings/page.tsx` — restore grid-of-cards hub.
- `apps/frontend/src/app/(app)/admin/platform-settings/page.tsx` — new hub page (create if
  absent).
- `apps/frontend/src/components/Sidebar.tsx` — generalize entitlement filtering.
- `apps/frontend/src/app/(app)/layout.tsx` — resolve additional `canAccess*` gate props.
- `apps/frontend/src/lib/plan-entitlements.ts` — helper(s) mapping entitlement → visibility,
  reused by both sidebar and hub so the check lives in one place.
- Localization message files (`en`/`bn`/`ms`) — hub category headings + any new labels.

## Testing

- Sidebar renders slimmed menus for both platform-admin and tenant modes.
- Hub pages render all moved items, grouped, with correct links.
- A tenant on a plan lacking entitlement X sees the item in **neither** sidebar nor hub.
- Deep-linking to a moved route still works (routes unchanged).
- Accounting-only tenant sees only the accounting-relevant subset in both surfaces.

## Open items for the plan

- Per-item entitlement mapping (audit each settings page for its required plan feature).
- Whether the shared visibility helper lives in `plan-entitlements.ts` or a new
  `nav-visibility.ts`.
