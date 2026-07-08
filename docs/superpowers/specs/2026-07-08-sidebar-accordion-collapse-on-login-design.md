# Sidebar accordion navigation + collapse-on-login — Design

**Date:** 2026-07-08
**Feedback:** `cmra8ve0` — "When I login all menus should be collapsed by default." (#686)
**Area:** `apps/frontend` sidebar navigation

---

## Problem

When a user logs in, the sidebar menu groups appear **expanded**, carried over from
their previous session. The reported expectation is that menus start **collapsed**
after login.

Investigation showed the submenu open/collapse state already *defaults* to collapsed
(`openGroups` starts as `{}`), but three things defeat that:

1. **Persistence** — the open state is saved to `localStorage`
   (`sidebar-open-groups`, `sidebar-collapsed`, `sidebar-width`) and restored on
   mount, so an expanded layout survives logout → login.
2. **Independent multi-open** — any number of groups can be open at once; there is
   no "one section at a time" behavior.
3. **Active-route auto-open** *merges* the current page's group into whatever is
   already open, rather than replacing it.

## Desired behavior (confirmed with user)

- **On login → full reset.** Clear the persisted sidebar state so the rail returns
  to its default width and expanded rail, and all groups start collapsed.
- **Accordion navigation.** Opening any menu section collapses all others: at most
  one top-level group open at a time, and within that group at most one subgroup
  open. This state is persisted to `localStorage`.
- **Auto-open current section.** The group (and subgroup) containing the active
  route opens automatically. Under the accordion rule this means it is the only
  group open.

### Decisions

- **Signup is out of scope.** Only the login choke-point resets the sidebar. New
  signups have nothing persisted yet, so their sidebar is already clean.
- **"Expand all" / "Collapse all" bulk buttons stay** as explicit manual overrides.
  The accordion rule governs navigation and single-group toggle clicks only; a user
  who deliberately presses "Expand all" still sees everything expand.

## Components affected

| File | Change |
|------|--------|
| `apps/frontend/src/components/Sidebar.tsx` | Accordion open-logic in `toggleGroup`; active-route effect changes from *merge* to *replace* |
| `apps/frontend/src/lib/auth-session.ts` | `storeAuthResponse` clears sidebar `localStorage` keys on login |

No changes to `sidebar-nav-filter.ts`, `NavLayoutContext.tsx`, or `nav-resolver.ts`
(menu structure is untouched — only open/collapse state behavior changes).

## Design detail

### 1. Accordion open-logic (`Sidebar.tsx`)

Open state is a `Record<string, boolean>` keyed by `mod.key` (top-level) and
`` `${mod.key}:${child.key}` `` (subgroup).

Define an **ancestor-chain** rule: whenever a node is opened, the resulting open map
contains exactly that node plus its ancestors set to `true`, and nothing else.

- Open top-level `key` → `{ [key]: true }`
- Open subgroup `parent:child` → `{ [parent]: true, "parent:child": true }`
- Closing a node → remove that node from the map (a top-level close also drops its
  subgroups, since they can no longer be visible).

`toggleGroup(key)`:
- If `key` is currently open → close it (and its descendants).
- If `key` is currently closed → open it via the ancestor-chain rule.

The bulk `expandAllGroups` / `collapseAllGroups` are unchanged (explicit overrides).

### 2. Active-route effect (`Sidebar.tsx`, current lines ~327–363)

Change from merging the active chain into existing `openGroups` to **replacing**
`openGroups` with exactly the active module + active subgroup chain. Preserves the
existing "open the section for the page you're on" behavior while enforcing the
accordion invariant. The effect continues to persist the result to `localStorage`.

The search-mode force-open behavior (`isSearching || openGroups[...]`) is unchanged.

### 3. Collapse-on-login (`auth-session.ts`)

In `storeAuthResponse` (the single per-login choke-point shared by password login,
2FA login, and demo login), remove these keys from `localStorage`:

- `sidebar-open-groups`
- `sidebar-collapsed`
- `sidebar-width`

On the next Sidebar mount these read as defaults (expanded rail, default width, all
groups collapsed); the active-route effect then opens only the landing page's group.

## Testing

Extend `apps/frontend/src/components/Sidebar.test.tsx`:

- **Accordion:** opening group B while group A is open closes A. Opening a subgroup
  keeps its parent open but closes sibling subgroups.
- **Active-route replace:** navigating changes which single group is open (others
  close), not additive.
- **Persistence:** the single-open accordion state is written to and restored from
  `localStorage`.
- **Bulk overrides:** existing Expand-all / Collapse-all test still passes.

Add coverage for `storeAuthResponse` (or a small extracted helper) clearing the three
sidebar keys on login, in `apps/frontend/src/lib/` alongside existing auth-session
tests (or a new test file if none exists).

## Out of scope

- New-account signup reset.
- Changes to menu structure, permissions, or nav filtering.
- Top-level rail collapse behavior beyond resetting it to default on login.
