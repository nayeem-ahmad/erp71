# Admin & Settings Menu Reorganization — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Slim the Platform Admin and tenant Account Settings menus to daily-use direct links, move the long tail into grouped hub pages, and hide plan-excluded items entirely.

**Architecture:** Navigation is registry-driven (`packages/shared-types/navigation.ts`) and rendered by `Sidebar.tsx` from ordered layout trees. We (a) collapse long subgroups in the layout trees into single hub links, (b) build/extend hub pages that render grouped cards, and (c) gate both sidebar links and hub cards by subscription entitlement using the existing `hasPlanEntitlement` helper so the two surfaces never disagree.

**Tech Stack:** Next.js 15 (App Router, client components), TypeScript, Tailwind, `@erp71/shared-types` (nav registry + plan entitlements), Jest + Testing Library.

## Global Constraints

- Branch policy: all work on `dev` (never `main`). Commit frequently.
- Multi-tenancy: entitlement checks read the *current* tenant's plan (`tenant_id` in localStorage → `me.tenants[...]`), mirroring `apps/frontend/src/app/(app)/accounting/page.tsx:24-35`.
- Plan-excluded items are **hidden entirely** — no upsell, no empty card, in **both** sidebar and hub.
- Do not change any deep route (`/settings/branding`, `/admin/platform-settings/sms`, …). Only their menu/hub entries change. Deep links must keep working.
- Reuse existing components: `ModuleHub` / `CompactLinkGrid` for hubs, `hasPlanEntitlement` for gating. No new deps.
- Localization: every new user-facing string needs keys in all three locales (`en`, `bn`, `ms`).

---

## File Structure

**New files**
- `apps/frontend/src/lib/use-tenant-plan-features.ts` — hook returning the current tenant's `{ planCode, features, ready }`, DRY-ing the `getMe → tenant → features_json` extraction repeated across hub pages.
- `apps/frontend/src/lib/nav-visibility.ts` — pure functions mapping a nav/hub item's entitlement gate to a visible/hidden decision, shared by Sidebar and hubs.
- `apps/frontend/src/lib/nav-visibility.test.ts` — unit tests for the above.
- `apps/frontend/src/lib/use-tenant-plan-features.test.ts` — unit tests for the hook's extraction logic (via an exported pure helper).

**Modified files**
- `packages/shared-types/navigation.ts` — registry entries + both layout trees.
- `apps/frontend/src/app/(app)/profile/page.tsx` — absorb password / 2FA / privacy from the old account page.
- `apps/frontend/src/app/(app)/settings/page.tsx` — becomes the tenant Settings hub (grouped, gated cards).
- `apps/frontend/src/app/(app)/admin/platform-settings/page.tsx` — group cards into categories + add Referrals/Feedback.
- `apps/frontend/src/components/Sidebar.tsx` — generalize entitlement filtering beyond `premiumOnly`.
- `apps/frontend/src/app/(app)/layout.tsx` — resolve the extra gate props passed to Sidebar.
- Localization message modules for `settings` and `admin.platformSettings` in `en` / `bn` / `ms`.

---

## Risk Notes (surfaced during design)

These informed the tasks; the implementer should be aware:

1. **`/settings` currently IS the account page** (profile + password + 2FA + privacy tabs). Making it the hub requires moving password/2FA/privacy into `/profile` first (Task 2) — otherwise those flows become unreachable. Task 3 must not land before Task 2.
2. **`/profile` already exists** (avatar + name) and is the destination of `AvatarDropdown` (`components/AvatarDropdown.tsx:55 → routes.profile`). Merging keeps that entry point valid — no dropdown change needed.
3. **2FA status is not reliably returned by `getMe`** — the old account page had a fallback (`settings/page.tsx:616-627`). Carrying it into `/profile` preserves current behavior; it is not a new regression, but do not "fix" it in this plan.
4. **`isShopWorkspacePath` keys off the `/settings` prefix** (`lib/auth-session.ts:212`) — the hub stays under `/settings`, so this keeps working. No change needed.
5. **Nothing else deep-links to `/settings` as the account page** — verified only `AvatarDropdown` targets account UI and it uses `/profile`. Bookmarks to `/settings` will now show the hub (acceptable).

---

## Task 1: Shared plan-features hook + nav-visibility helper

**Files:**
- Create: `apps/frontend/src/lib/nav-visibility.ts`
- Create: `apps/frontend/src/lib/nav-visibility.test.ts`
- Create: `apps/frontend/src/lib/use-tenant-plan-features.ts`
- Create: `apps/frontend/src/lib/use-tenant-plan-features.test.ts`

**Interfaces:**
- Produces:
  - `type EntitlementGate = { entitlement?: string }` — a nav/hub item carrying an optional plan-entitlement key.
  - `isItemVisible(item: EntitlementGate, features: Record<string, unknown> | null | undefined): boolean` — visible when no `entitlement` set, else `hasPlanEntitlement(normalizePlanFeatures(features), entitlement)`.
  - `extractTenantPlan(me: any, tenantId: string | null): { planCode: string | null; features: Record<string, unknown> }` — pure extraction.
  - `useTenantPlanFeatures(): { planCode: string | null; features: Record<string, unknown>; ready: boolean }` — React hook wrapping `api.getMe()` + `extractTenantPlan`.

- [ ] **Step 1: Write failing test for `isItemVisible`**

```ts
// apps/frontend/src/lib/nav-visibility.test.ts
import { isItemVisible, extractTenantPlan } from './nav-visibility';

describe('isItemVisible', () => {
  it('shows items with no entitlement gate', () => {
    expect(isItemVisible({}, {})).toBe(true);
    expect(isItemVisible({ entitlement: undefined }, null)).toBe(true);
  });

  it('hides gated items when the entitlement is absent', () => {
    expect(isItemVisible({ entitlement: 'premiumCrm' }, {})).toBe(false);
  });

  it('shows gated items when the entitlement is present (boolean true)', () => {
    expect(isItemVisible({ entitlement: 'premiumCrm' }, { premiumCrm: true })).toBe(true);
  });

  it('shows gated items when the entitlement is a positive number', () => {
    expect(isItemVisible({ entitlement: 'aiCreditsMonthly' }, { aiCreditsMonthly: 500 })).toBe(true);
  });
});

describe('extractTenantPlan', () => {
  const me = {
    tenants: [
      { id: 't1', subscription: { plan: { code: 'BASIC', features_json: { premiumCrm: false } } } },
      { id: 't2', subscription: { plan: { code: 'PREMIUM', features_json: { premiumCrm: true } } } },
    ],
  };
  it('selects the tenant matching tenantId', () => {
    expect(extractTenantPlan(me, 't2')).toEqual({ planCode: 'PREMIUM', features: { premiumCrm: true } });
  });
  it('falls back to the first tenant when tenantId is null/unknown', () => {
    expect(extractTenantPlan(me, null).planCode).toBe('BASIC');
  });
  it('returns empty features when me has no tenants', () => {
    expect(extractTenantPlan({}, 't1')).toEqual({ planCode: null, features: {} });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/frontend && npx jest src/lib/nav-visibility.test.ts`
Expected: FAIL — "Cannot find module './nav-visibility'".

- [ ] **Step 3: Implement `nav-visibility.ts`**

```ts
// apps/frontend/src/lib/nav-visibility.ts
import { hasPlanEntitlement, normalizePlanFeatures } from '@erp71/shared-types';

export type EntitlementGate = { entitlement?: string };

export function isItemVisible(
  item: EntitlementGate,
  features: Record<string, unknown> | null | undefined,
): boolean {
  if (!item.entitlement) return true;
  return hasPlanEntitlement(normalizePlanFeatures(features ?? undefined), item.entitlement);
}

export function extractTenantPlan(
  me: any,
  tenantId: string | null,
): { planCode: string | null; features: Record<string, unknown> } {
  const tenants = me?.tenants ?? [];
  const tenant = tenants.find((entry: { id: string }) => entry.id === tenantId) ?? tenants[0];
  return {
    planCode: tenant?.subscription?.plan?.code ?? null,
    features: (tenant?.subscription?.plan?.features_json ?? {}) as Record<string, unknown>,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/frontend && npx jest src/lib/nav-visibility.test.ts`
Expected: PASS.

- [ ] **Step 5: Write failing test for the hook's extraction wiring**

```ts
// apps/frontend/src/lib/use-tenant-plan-features.test.ts
import { renderHook, waitFor } from '@testing-library/react';
import { useTenantPlanFeatures } from './use-tenant-plan-features';
import { api } from './api';

jest.mock('./api', () => ({ api: { getMe: jest.fn() } }));

describe('useTenantPlanFeatures', () => {
  beforeEach(() => {
    localStorage.setItem('tenant_id', 't1');
    (api.getMe as jest.Mock).mockResolvedValue({
      tenants: [{ id: 't1', subscription: { plan: { code: 'BASIC', features_json: { premiumCrm: false } } } }],
    });
  });

  it('resolves the current tenant plan features and flips ready', async () => {
    const { result } = renderHook(() => useTenantPlanFeatures());
    expect(result.current.ready).toBe(false);
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.planCode).toBe('BASIC');
    expect(result.current.features).toEqual({ premiumCrm: false });
  });

  it('degrades to empty features when getMe rejects', async () => {
    (api.getMe as jest.Mock).mockRejectedValue(new Error('nope'));
    const { result } = renderHook(() => useTenantPlanFeatures());
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.features).toEqual({});
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `cd apps/frontend && npx jest src/lib/use-tenant-plan-features.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 7: Implement `use-tenant-plan-features.ts`**

```ts
// apps/frontend/src/lib/use-tenant-plan-features.ts
'use client';

import { useEffect, useState } from 'react';
import { api } from './api';
import { extractTenantPlan } from './nav-visibility';

export function useTenantPlanFeatures() {
  const [state, setState] = useState<{
    planCode: string | null;
    features: Record<string, unknown>;
    ready: boolean;
  }>({ planCode: null, features: {}, ready: false });

  useEffect(() => {
    let active = true;
    api.getMe()
      .then((me) => {
        if (!active) return;
        const tenantId = localStorage.getItem('tenant_id');
        const { planCode, features } = extractTenantPlan(me, tenantId);
        setState({ planCode, features, ready: true });
      })
      .catch(() => {
        if (active) setState({ planCode: null, features: {}, ready: true });
      });
    return () => {
      active = false;
    };
  }, []);

  return state;
}
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `cd apps/frontend && npx jest src/lib/nav-visibility.test.ts src/lib/use-tenant-plan-features.test.ts`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add apps/frontend/src/lib/nav-visibility.ts apps/frontend/src/lib/nav-visibility.test.ts apps/frontend/src/lib/use-tenant-plan-features.ts apps/frontend/src/lib/use-tenant-plan-features.test.ts
git commit -m "feat(nav): shared plan-entitlement visibility helper + tenant-plan hook"
```

---

## Task 2: Merge account controls (password / 2FA / privacy) into /profile

Move `PasswordTab`, `TwoFATab`, `PrivacyTab` (and the profile name/email edit) so `/profile` is the single "My Profile" account page. This frees `/settings` to become the hub (Task 3).

**Files:**
- Modify: `apps/frontend/src/app/(app)/profile/page.tsx`
- Reference (source of the tabs to move): `apps/frontend/src/app/(app)/settings/page.tsx:55-335,608-711`

**Interfaces:**
- Consumes: existing `t.settings.*` i18n keys (profile/password/twoFactor/privacy) — keep using them; do not rename keys in this task.
- Produces: `/profile` renders a tabbed card with tabs `profile | password | 2fa | privacy`, avatar upload retained above the tabs.

- [ ] **Step 1: Add a tab scaffold to the profile page**

In `profile/page.tsx`, keep the existing avatar + name block, then add a tabbed card below it. Import the three tab components by copying `PasswordTab`, `TwoFATab`, `PrivacyTab` verbatim from `settings/page.tsx:207-602` into `profile/page.tsx` (they depend only on `fetchWithAuth`, `useI18n`, lucide icons — all already importable). Add the 2FA-status derivation from `settings/page.tsx:616-627`.

```tsx
// Inside ProfilePage, after existing avatar/name UI:
type Tab = 'profile' | 'password' | '2fa' | 'privacy';
const [activeTab, setActiveTab] = useState<Tab>('profile');
const [twoFAEnabled, setTwoFAEnabled] = useState<boolean | null>(null);
useEffect(() => {
  const has = user?.two_factor_enabled ?? user?.twoFactorEnabled ?? null;
  setTwoFAEnabled(has === true ? true : has === false ? false : null);
}, [user]);

const tabs: { key: Tab; label: string }[] = [
  { key: 'profile', label: t.settings.tabs.profile },
  { key: 'password', label: t.settings.tabs.password },
  { key: '2fa', label: t.settings.tabs.twoFactor },
  { key: 'privacy', label: t.settings.tabs.dataPrivacy },
];
```

Render the same tab-bar + content switch as `settings/page.tsx:655-704`, but the `profile` tab keeps the existing avatar/name editor already on this page (do not duplicate the name form — reuse what `/profile` already has, or move `ProfileTab` in and delete the page's own inline name form to avoid two name editors).

- [ ] **Step 2: Verify the page compiles and renders all four tabs**

Run: `cd apps/frontend && npx tsc --noEmit -p tsconfig.json 2>&1 | grep -i profile || echo "no profile type errors"`
Expected: no profile type errors.

- [ ] **Step 3: Manual smoke via dev server**

Run: `cd apps/frontend && npm run dev` then visit `/profile`. Confirm: avatar upload works, password change form present, 2FA setup present, privacy export/delete present.
Expected: all four sections reachable on `/profile`.

- [ ] **Step 4: Commit**

```bash
git add apps/frontend/src/app/\(app\)/profile/page.tsx
git commit -m "feat(profile): merge password/2FA/privacy from account settings into My Profile"
```

---

## Task 3: Convert /settings into the tenant Settings hub

Replace the account tabs in `settings/page.tsx` with a grouped, entitlement-gated card hub built on `ModuleHub`.

**Files:**
- Modify: `apps/frontend/src/app/(app)/settings/page.tsx` (full rewrite of the page component)
- Reference: `apps/frontend/src/app/(app)/hr/page.tsx` (ModuleHub usage), `apps/frontend/src/components/ModuleHub.tsx`

**Interfaces:**
- Consumes: `useTenantPlanFeatures` (Task 1), `isItemVisible` (Task 1), `ModuleHub`, `routes.settings.*`.
- Produces: `/settings` renders sections Business Profile · Sales & POS · Communications · Billing & Credits · Advanced, each card gated by `entitlement` where set.

- [ ] **Step 1: Define the section config with entitlement gates**

```tsx
// settings/page.tsx (new content)
'use client';
import { useMemo } from 'react';
import {
  Palette, Globe, Receipt, Monitor, ShoppingBag, CreditCard, Tag, Gift,
  MessageSquare, BarChart3, Sparkles, ScrollText, Database,
} from 'lucide-react';
import CompactLinkGrid from '@/components/ui/compact/CompactLinkGrid';
import PageHeader from '@/components/ui/compact/PageHeader';
import PageShell from '@/components/ui/compact/PageShell';
import { useI18n } from '@/lib/i18n';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';
import { routes } from '@/lib/routes';
import { useTenantPlanFeatures } from '@/lib/use-tenant-plan-features';
import { isItemVisible } from '@/lib/nav-visibility';

type Card = { href: string; key: string; icon: any; accent: string; entitlement?: string };
type Section = { key: string; cards: Card[] };

const SECTIONS: Section[] = [
  { key: 'businessProfile', cards: [
    { href: routes.settings.branding, key: 'branding', icon: Palette, accent: 'bg-violet-50 text-violet-700 border-violet-100' },
    { href: routes.settings.localization, key: 'localization', icon: Globe, accent: 'bg-sky-50 text-sky-700 border-sky-100' },
    { href: routes.settings.tax, key: 'tax', icon: Receipt, accent: 'bg-amber-50 text-amber-700 border-amber-100' },
  ]},
  { key: 'salesPos', cards: [
    { href: routes.settings.counters, key: 'counters', icon: Monitor, accent: 'bg-blue-50 text-blue-700 border-blue-100' },
    { href: routes.settings.sales, key: 'sales', icon: ShoppingBag, accent: 'bg-emerald-50 text-emerald-700 border-emerald-100' },
    { href: routes.settings.paymentMethods, key: 'paymentMethods', icon: CreditCard, accent: 'bg-indigo-50 text-indigo-700 border-indigo-100' },
    { href: routes.settings.discountCodes, key: 'discountCodes', icon: Tag, accent: 'bg-rose-50 text-rose-700 border-rose-100' },
    { href: routes.settings.loyalty, key: 'loyalty', icon: Gift, accent: 'bg-fuchsia-50 text-fuchsia-700 border-fuchsia-100' },
  ]},
  { key: 'communications', cards: [
    { href: routes.settings.sms, key: 'sms', icon: MessageSquare, accent: 'bg-green-50 text-green-700 border-green-100' },
    { href: routes.settings.reports, key: 'reportEmails', icon: BarChart3, accent: 'bg-teal-50 text-teal-700 border-teal-100' },
  ]},
  { key: 'billingCredits', cards: [
    { href: '/sms-credits', key: 'smsCredits', icon: MessageSquare, accent: 'bg-green-50 text-green-700 border-green-100' },
    { href: '/ai-credits', key: 'aiCredits', icon: Sparkles, accent: 'bg-purple-50 text-purple-700 border-purple-100' },
  ]},
  { key: 'advanced', cards: [
    { href: routes.settings.auditLogs, key: 'auditLogs', icon: ScrollText, accent: 'bg-gray-50 text-gray-700 border-gray-200' },
    { href: routes.settings.data, key: 'data', icon: Database, accent: 'bg-slate-50 text-slate-700 border-slate-200' },
  ]},
];
```

Note: no card carries `entitlement` yet — the audit in Step 2 fills them in. The gate machinery must be wired now so it is a one-line change per card later.

- [ ] **Step 2: Assign entitlement gates per the audit**

Set `entitlement` on cards whose feature is plan-gated, using keys from `packages/shared-types/subscription-plans.ts` `PLAN_ENTITLEMENT_REGISTRY`. Minimum required mapping (leave others ungated):
- `loyalty` → `entitlement: undefined` (available on all plans; keep visible) — confirm against registry; if a `loyalty`/`premiumCrm`-style key exists, use it, else leave ungated.
- `aiCredits` → gate on `premiumAi` if AI is plan-gated; otherwise leave ungated (credits page shows purchase regardless).

Because the exact per-feature plan mapping is a product decision, default rule: **only gate a card if the underlying page is already access-controlled elsewhere** (search `grep -rn "accountingOnly\|premium" apps/frontend/src/app/\(app\)/settings`). Ungated is the safe default (item stays visible). Record any gate you add in the commit message.

- [ ] **Step 3: Render the hub with gating**

```tsx
export default function SettingsHubPage() {
  const { t } = useI18n();
  const { features, ready } = useTenantPlanFeatures();
  const s = t.settings.hub;

  const grids = useMemo(() =>
    SECTIONS.map((section) => ({
      label: s.sections[section.key],
      links: section.cards
        .filter((c) => isItemVisible(c, features))
        .map((c) => ({ href: c.href, title: s.links[c.key], icon: c.icon, accent: c.accent })),
    })).filter((g) => g.links.length > 0),
  [s, features]);

  return (
    <PageShell maxWidth="wide">
      <PageHeader
        title={s.title}
        subtitle={s.subtitle}
        breadcrumbs={modulePageBreadcrumbs(t.dashboardHome.breadcrumbHome, t.sidebar.modules.accountSettings, s.title, 'settings')}
      />
      {ready && grids.map((g) => <CompactLinkGrid key={g.label} label={g.label} links={g.links} />)}
    </PageShell>
  );
}
```

- [ ] **Step 4: Typecheck**

Run: `cd apps/frontend && npx tsc --noEmit 2>&1 | grep -i "settings/page" || echo "clean"`
Expected: `clean` (after Task 8 adds the i18n keys; if run before Task 8, expect key-type errors — acceptable, re-run after Task 8).

- [ ] **Step 5: Commit**

```bash
git add apps/frontend/src/app/\(app\)/settings/page.tsx
git commit -m "feat(settings): tenant Settings hub with grouped, entitlement-gated cards"
```

---

## Task 4: Update tenant nav registry + layout tree

Slim `account-settings` to direct links (My Profile, Team, Billing) + the hub overview; drop the moved links from the tenant layout.

**Files:**
- Modify: `packages/shared-types/navigation.ts:182-199` (registry) and `:359-376` (`DEFAULT_TENANT_NAV_LAYOUT`)

**Interfaces:**
- Consumes: existing `NAV_REGISTRY` node shape.
- Produces: tenant sidebar shows under Account Settings: overview `/settings` (hub), `My Profile` `/profile`, `Team & Permissions` `/team`, `Billing` `/billing`.

- [ ] **Step 1: Add a My Profile registry node**

In `navigation.ts` after `account-settings.overview` (line 183), add:

```ts
'account-settings.profile': { id: 'account-settings.profile', kind: 'link', icon: 'UserCog', labelKey: 'sidebar.items.myProfile', href: '/profile' },
```

Keep `account-settings.overview` (`/settings`) but change its `labelKey` to a hub label, e.g. `'sidebar.items.settingsHub'` (add this key in Task 8). Leave `account-settings.team` and `account-settings.billing` as-is. The registry may keep the other `account-settings.*` link nodes (branding, tax, …) — they are simply no longer referenced by the tenant layout tree, which is harmless.

- [ ] **Step 2: Rewrite the tenant layout `account-settings` block**

Replace `navigation.ts:359-376` with:

```ts
  layoutNode('account-settings', null, 8),
  layoutNode('account-settings.overview', 'account-settings', 0),
  layoutNode('account-settings.profile', 'account-settings', 1),
  layoutNode('account-settings.team', 'account-settings', 2),
  layoutNode('account-settings.billing', 'account-settings', 3),
```

(The 13 moved links now live only on the `/settings` hub.)

- [ ] **Step 3: Typecheck shared-types**

Run: `cd packages/shared-types && npx tsc --noEmit`
Expected: PASS (labelKeys are strings; no type break).

- [ ] **Step 4: Commit**

```bash
git add packages/shared-types/navigation.ts
git commit -m "feat(nav): slim tenant Account Settings menu to profile/team/billing + hub"
```

---

## Task 5: Group the platform-settings hub into categories + add Growth cards

**Files:**
- Modify: `apps/frontend/src/app/(app)/admin/platform-settings/page.tsx`

**Interfaces:**
- Produces: `/admin/platform-settings` renders four labeled groups: Channels · Plans & Billing · Platform Config · Growth (Referrals, Feedback).

- [ ] **Step 1: Restructure `SECTIONS` into grouped arrays**

Convert the flat `SECTIONS` array (`platform-settings/page.tsx:14-103`) into groups. Keep every existing card; add Referrals (`/admin/referrals`, icon `Gift`) and Feedback (`/admin/feedback`, icon `MessageSquare`) under a new **Growth** group.

```tsx
const GROUPS = [
  { key: 'channels',   cards: [sms, email, whatsapp, payments] },
  { key: 'plans',      cards: [plans, addons] },
  { key: 'config',     cards: [general, tenantFeatures, ai, navigation, feedbackAutomation] },
  { key: 'growth',     cards: [
    { href: '/admin/referrals', icon: Gift, label: m.sections.referrals.label, description: m.sections.referrals.description, color: 'text-pink-600', bg: 'bg-pink-50' },
    { href: '/admin/feedback', icon: MessageSquare, label: m.sections.feedback.label, description: m.sections.feedback.description, color: 'text-cyan-600', bg: 'bg-cyan-50' },
  ]},
];
```

(where `sms`, `email`, … are the existing card objects extracted from the current array.)

- [ ] **Step 2: Render each group with a heading**

Wrap the existing card-grid render in a `GROUPS.map`, emitting a section label (`m.groups[group.key]`) above each `grid`. Reuse the existing card markup (`platform-settings/page.tsx:124-139`).

- [ ] **Step 3: Typecheck**

Run: `cd apps/frontend && npx tsc --noEmit 2>&1 | grep -i "platform-settings/page" || echo clean`
Expected: `clean` after Task 8 adds `m.groups` + `sections.referrals`/`sections.feedback` keys.

- [ ] **Step 4: Commit**

```bash
git add apps/frontend/src/app/\(app\)/admin/platform-settings/page.tsx
git commit -m "feat(admin): group platform-settings hub into categories + Growth cards"
```

---

## Task 6: Update platform-admin nav registry + layout tree

Collapse the `admin.platform-settings` subgroup to a single link to the hub; remove `admin.referrals` and `admin.feedback` from the top level (they moved into the hub's Growth group).

**Files:**
- Modify: `packages/shared-types/navigation.ts:214-225` (registry) and `:391-...` (`DEFAULT_PLATFORM_ADMIN_NAV_LAYOUT`)

**Interfaces:**
- Produces: platform-admin sidebar shows Overview, Tenant Management (3), Users, Support, System Health, Status, and a single **Platform Settings** link to `/admin/platform-settings`.

- [ ] **Step 1: Turn the subgroup node into a link**

Change `admin.platform-settings` (line 214) from `kind: 'subgroup'` to:

```ts
'admin.platform-settings': { id: 'admin.platform-settings', kind: 'link', icon: 'Settings', labelKey: 'sidebar.sections.platformSettings', href: '/admin/platform-settings' },
```

Leave the 11 `admin.platform-settings.*` child registry entries in place (unreferenced by the layout, harmless, and still valid deep-link targets).

- [ ] **Step 2: Rewrite the platform-admin layout tree**

In `DEFAULT_PLATFORM_ADMIN_NAV_LAYOUT` (starts `navigation.ts:392`), read the full block and replace the `admin.platform-settings.*` child layout nodes and the `admin.referrals` / `admin.feedback` nodes so the tree is:

```ts
  layoutNode('admin', null, 0),
  layoutNode('admin.overview', 'admin', 0),
  layoutNode('admin.tenant-management', 'admin', 1),
  layoutNode('admin.tenant-management.tenants', 'admin.tenant-management', 0),
  layoutNode('admin.tenant-management.ledger', 'admin.tenant-management', 1),
  layoutNode('admin.tenant-management.reminders', 'admin.tenant-management', 2),
  layoutNode('admin.users', 'admin', 2),
  layoutNode('admin.support', 'admin', 3),
  layoutNode('admin.system-health', 'admin', 4),
  layoutNode('admin.status', 'admin', 5),
  layoutNode('admin.platform-settings', 'admin', 6),
```

(No child `platform-settings.*` layout nodes; no `admin.referrals` / `admin.feedback`.) Read lines 392 onward first to get the exact current end of the array before editing.

- [ ] **Step 3: Typecheck shared-types**

Run: `cd packages/shared-types && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/shared-types/navigation.ts
git commit -m "feat(nav): collapse platform-settings to a single hub link in admin sidebar"
```

---

## Task 7: Generalize Sidebar entitlement filtering

Today `Sidebar.tsx` filters children by `premiumOnly`/`advancedOnly` only. Generalize so any registry node with an `entitlement` key is hidden when the tenant lacks it, using the same `isItemVisible` helper as the hub, so sidebar and hub agree.

**Files:**
- Modify: `apps/frontend/src/components/Sidebar.tsx:96-110` (child filter)
- Modify: `apps/frontend/src/app/(app)/layout.tsx:221-245` (resolve tenant `features` and pass to Sidebar)
- Modify: `packages/shared-types/navigation.ts` (add optional `entitlement?: string` to the nav node type, if not already present)

**Interfaces:**
- Consumes: `isItemVisible` (Task 1); nav nodes' optional `entitlement`.
- Produces: `Sidebar` accepts a `planFeatures: Record<string, unknown>` prop; a child/link with `entitlement` set is dropped when `!isItemVisible(node, planFeatures)`.

- [ ] **Step 1: Add `entitlement` to the nav node type**

In `navigation.ts`, add `entitlement?: string;` to the `NavRegistryNode` (or equivalent) interface alongside `premiumOnly`/`advancedOnly`. Typecheck: `cd packages/shared-types && npx tsc --noEmit` → PASS.

- [ ] **Step 2: Thread `planFeatures` into Sidebar**

In `layout.tsx`, where `planFeatures` is already computed (line ~221), pass it to `<Sidebar planFeatures={planFeatures} … />`. Add the prop to Sidebar's props type.

- [ ] **Step 3: Apply the generalized filter**

In `Sidebar.tsx` `filterChildren` (lines 96-110), add after the existing `premiumOnly` check:

```ts
if (child.entitlement && !isItemVisible(child, planFeatures)) return null;
```
and the analogous line in the link-filter branch (line ~104):
```ts
if (link.entitlement && !isItemVisible(link, planFeatures)) return false;
```
Import `isItemVisible` from `@/lib/nav-visibility`.

- [ ] **Step 4: Typecheck + existing sidebar tests**

Run: `cd apps/frontend && npx tsc --noEmit 2>&1 | grep -i sidebar || echo clean` and `npx jest src/components/Sidebar 2>/dev/null || echo "no sidebar tests"`
Expected: `clean`; existing tests (if any) pass.

- [ ] **Step 5: Commit**

```bash
git add apps/frontend/src/components/Sidebar.tsx apps/frontend/src/app/\(app\)/layout.tsx packages/shared-types/navigation.ts
git commit -m "feat(nav): generalize sidebar entitlement gating via shared isItemVisible"
```

---

## Task 8: Localization keys for hubs and new labels

Add copy in all three locales for: the tenant Settings hub (`t.settings.hub.*`), the new sidebar labels (`sidebar.items.myProfile`, `sidebar.items.settingsHub`), and the platform-settings groups + Growth cards (`t.admin.platformSettings.index.groups.*`, `.sections.referrals`, `.sections.feedback`).

**Files:**
- Modify: the `en`, `bn`, `ms` message modules that define `settings`, `sidebar`, and `admin.platformSettings`. Find them: `grep -rln "platformSettings" apps/frontend/src/lib/localization/messages/en`.

**Interfaces:**
- Produces: `t.settings.hub.{title,subtitle,sections.{businessProfile,salesPos,communications,billingCredits,advanced},links.{branding,localization,tax,counters,sales,paymentMethods,discountCodes,loyalty,sms,reportEmails,smsCredits,aiCredits,auditLogs,data}}`; `t.sidebar.items.{myProfile,settingsHub}`; `t.admin.platformSettings.index.{groups.{channels,plans,config,growth},sections.{referrals,feedback}}`.

- [ ] **Step 1: Add English keys**

Add the `hub` block to the `settings` message object and the new sidebar/admin keys, with real English copy. Example for the hub section labels:

```ts
hub: {
  title: 'Settings',
  subtitle: 'Configure your business — profile, sales, communications, and more.',
  sections: {
    businessProfile: 'Business Profile',
    salesPos: 'Sales & POS',
    communications: 'Communications',
    billingCredits: 'Billing & Credits',
    advanced: 'Advanced',
  },
  links: {
    branding: 'Branding', localization: 'Localization', tax: 'Tax / VAT',
    counters: 'POS Counters', sales: 'Sales Settings', paymentMethods: 'Payment Methods',
    discountCodes: 'Discount Codes', loyalty: 'Loyalty Program', sms: 'SMS Notifications',
    reportEmails: 'Report Emails', smsCredits: 'SMS Credits', aiCredits: 'AI Credits',
    auditLogs: 'Audit Logs', data: 'Data Management',
  },
},
```

Plus `sidebar.items.myProfile: 'My Profile'`, `sidebar.items.settingsHub: 'Settings'`, `admin.platformSettings.index.groups: { channels: 'Channels', plans: 'Plans & Billing', config: 'Platform Config', growth: 'Growth' }`, and `sections.referrals` / `sections.feedback` `{ label, description }`.

- [ ] **Step 2: Mirror keys in `bn` and `ms`**

Add the same key structure to the `bn` and `ms` modules with translated (bn) / English-fallback-or-translated (ms) copy. Every key present in `en` must exist in `bn` and `ms` or the typed `t` access breaks.

- [ ] **Step 3: Typecheck the whole frontend**

Run: `cd apps/frontend && npx tsc --noEmit`
Expected: PASS (this resolves the deferred key errors from Tasks 3 and 5).

- [ ] **Step 4: Run the frontend test suite touched by this work**

Run: `cd apps/frontend && npx jest src/lib/nav-visibility.test.ts src/lib/use-tenant-plan-features.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/frontend/src/lib/localization/messages
git commit -m "i18n: settings hub + platform-settings groups + profile/settings labels"
```

---

## Task 9: End-to-end verification

**Files:** none (verification only).

- [ ] **Step 1: Build**

Run: `cd apps/frontend && npm run build`
Expected: build succeeds.

- [ ] **Step 2: Manual walkthrough (dev server)**

Run `npm run dev`, then verify:
- Tenant sidebar → Account Settings shows only: Settings (hub), My Profile, Team & Permissions, Billing.
- `/settings` shows five grouped card sections; every card links to a working page.
- `/profile` has profile/password/2FA/privacy.
- Platform-admin sidebar shows a single **Platform Settings** link (no 11-item subgroup, no loose Referrals/Feedback).
- `/admin/platform-settings` shows four groups incl. Growth (Referrals, Feedback).
- Deep links still work: visit `/settings/branding`, `/admin/platform-settings/sms` directly → render.

- [ ] **Step 3: Entitlement smoke**

With a tenant whose plan lacks a gated feature (if any gates were added in Task 3.2), confirm the item appears in **neither** the sidebar nor the `/settings` hub.

- [ ] **Step 4: Update TODO.md**

Per `CLAUDE.md`, check off / move completed items and add any follow-ups discovered.

- [ ] **Step 5: Final commit**

```bash
git add TODO.md
git commit -m "docs: mark admin/settings menu reorg complete"
```

---

## Self-Review Notes

- **Spec coverage:** Platform Admin reorg → Tasks 5,6. Tenant reorg → Tasks 2,3,4. Hide-by-entitlement (both surfaces) → Tasks 1,3,7. Hub pattern → Tasks 3,5. My Account/Profile merge (discovered) → Task 2.
- **Deferred item from spec** ("per-item entitlement mapping"): handled as Task 3 Step 2 with an explicit safe default (ungated) and an audit instruction, rather than guessing product gates.
- **Ordering constraint:** Task 2 (move account controls) must precede Task 3 (repurpose `/settings`) — noted in Risk Note 1.
- **i18n deferral:** Tasks 3 & 5 introduce new `t.*` keys; Task 8 adds them. Typechecks in 3/5 are scoped greps; the full typecheck gate is Task 8 Step 3.
