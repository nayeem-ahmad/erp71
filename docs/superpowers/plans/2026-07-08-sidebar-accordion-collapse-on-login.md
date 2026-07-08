# Sidebar Accordion Navigation + Collapse-on-Login Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the ERP71 sidebar behave like an accordion (one section open at a time, current page's section auto-open) and reset to a fully-collapsed default state on login.

**Architecture:** Two pure helper functions compute the accordion open-state map; the `Sidebar` component wires them into its single-group toggle and its active-route effect (changing that effect from *merge* to *replace*); the auth login choke-point clears the persisted sidebar `localStorage` keys so the next mount starts from defaults.

**Tech Stack:** Next.js 15, React (client component), TypeScript, Jest + Testing Library.

## Global Constraints

- All work is in `apps/frontend`. Run commands from `apps/frontend/`.
- Test runner: `npx jest <file> -t "<test name>"` (the `test` script is bare `jest`).
- Menu-group open state is a `Record<string, boolean>` keyed by `mod.key` (top-level) and `` `${mod.key}:${child.key}` `` (subgroup). Preserve this exact key format.
- Do **not** modify menu structure, permissions, or nav filtering — only open/collapse behavior.
- Keep the existing Expand-all / Collapse-all bulk buttons unchanged (explicit manual overrides).
- Signup flow is out of scope — only the login choke-point resets the sidebar.

---

### Task 1: Pure accordion state helpers

**Files:**
- Modify: `apps/frontend/src/lib/sidebar-nav-filter.ts` (append two exported functions)
- Test: `apps/frontend/src/lib/sidebar-nav-filter.test.ts` (append a `describe` block)

**Interfaces:**
- Produces:
  - `accordionOpenState(key: string): Record<string, boolean>` — the open-map when `key` is opened: the key plus its parent (for a `parent:child` subgroup key) set to `true`, nothing else.
  - `accordionCloseState(prev: Record<string, boolean>, key: string): Record<string, boolean>` — `prev` with `key` removed; if `key` is top-level (no `:`), also removes any `` `${key}:*` `` subgroup entries.

- [ ] **Step 1: Write the failing tests**

Append to `apps/frontend/src/lib/sidebar-nav-filter.test.ts`:

```ts
import { accordionOpenState, accordionCloseState } from './sidebar-nav-filter';

describe('accordion state helpers', () => {
    it('opens a top-level group as the only open node', () => {
        expect(accordionOpenState('accounting')).toEqual({ accounting: true });
    });

    it('opens a subgroup together with its parent', () => {
        expect(accordionOpenState('accounting:reports')).toEqual({
            accounting: true,
            'accounting:reports': true,
        });
    });

    it('closing a top-level group also drops its subgroups', () => {
        const prev = { accounting: true, 'accounting:reports': true };
        expect(accordionCloseState(prev, 'accounting')).toEqual({});
    });

    it('closing a subgroup keeps the parent open', () => {
        const prev = { accounting: true, 'accounting:reports': true };
        expect(accordionCloseState(prev, 'accounting:reports')).toEqual({ accounting: true });
    });

    it('does not mutate the input map', () => {
        const prev = { accounting: true, 'accounting:reports': true };
        accordionCloseState(prev, 'accounting');
        expect(prev).toEqual({ accounting: true, 'accounting:reports': true });
    });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd apps/frontend && npx jest src/lib/sidebar-nav-filter.test.ts -t "accordion state helpers"`
Expected: FAIL — `accordionOpenState is not a function` (import undefined).

- [ ] **Step 3: Implement the helpers**

Append to `apps/frontend/src/lib/sidebar-nav-filter.ts`:

```ts
/**
 * Accordion open-map when `key` becomes the open node: the key plus its
 * ancestor chain set to true, nothing else. For `parent:child` keys the
 * parent is included so the subgroup is visible inside its module.
 */
export function accordionOpenState(key: string): Record<string, boolean> {
    const state: Record<string, boolean> = { [key]: true };
    const sepIndex = key.indexOf(':');
    if (sepIndex !== -1) {
        state[key.slice(0, sepIndex)] = true;
    }
    return state;
}

/**
 * Remove `key` from an accordion open-map. Closing a top-level group also
 * drops any of its `parent:child` subgroups, since they can no longer show.
 */
export function accordionCloseState(
    prev: Record<string, boolean>,
    key: string,
): Record<string, boolean> {
    const next = { ...prev };
    delete next[key];
    if (key.indexOf(':') === -1) {
        for (const existing of Object.keys(next)) {
            if (existing.startsWith(`${key}:`)) {
                delete next[existing];
            }
        }
    }
    return next;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd apps/frontend && npx jest src/lib/sidebar-nav-filter.test.ts -t "accordion state helpers"`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/frontend/src/lib/sidebar-nav-filter.ts apps/frontend/src/lib/sidebar-nav-filter.test.ts
git commit -m "feat(sidebar): add accordion open/close state helpers"
```

---

### Task 2: Wire accordion into the Sidebar (toggle + active-route effect)

**Files:**
- Modify: `apps/frontend/src/components/Sidebar.tsx`
  - import block (add the two helpers)
  - `toggleGroup` (currently lines 458-464)
  - active-route effect (currently lines 327-363)
- Test: `apps/frontend/src/components/Sidebar.test.tsx` (append tests to the existing `describe`)

**Interfaces:**
- Consumes: `accordionOpenState`, `accordionCloseState` from Task 1.

- [ ] **Step 1: Write the failing tests**

Append inside the `describe('Sidebar — Story 30.1', ...)` block in `apps/frontend/src/components/Sidebar.test.tsx` (before its closing `});`):

```ts
    it('opening one subgroup closes a sibling subgroup (accordion)', async () => {
        render(<Sidebar canAccessAccounting canAccessInventoryReports canAccessAccountingAdvanced />);

        await waitFor(() => {
            expect(screen.getByText('Transactions & Funds')).toBeInTheDocument();
        });

        fireEvent.click(screen.getByText('Transactions & Funds'));
        expect(screen.getByText('Expense Categories')).toBeInTheDocument();

        // Opening Reports must collapse Transactions & Funds.
        fireEvent.click(screen.getByText('Reports'));
        expect(screen.getByText('Trial Balance')).toBeInTheDocument();
        expect(screen.queryByText('Expense Categories')).not.toBeInTheDocument();
    });

    it('persists the single open subgroup to localStorage', async () => {
        render(<Sidebar canAccessAccounting canAccessInventoryReports canAccessAccountingAdvanced />);

        await waitFor(() => {
            expect(screen.getByText('Reports')).toBeInTheDocument();
        });

        fireEvent.click(screen.getByText('Reports'));

        const saved = JSON.parse(localStorage.getItem('sidebar-open-groups') ?? '{}');
        const openKeys = Object.entries(saved).filter(([, v]) => v).map(([k]) => k);
        // Only the Reports subgroup chain (parent + subgroup) should be open.
        expect(openKeys.some((k) => k.endsWith(':reports'))).toBe(true);
        expect(openKeys.filter((k) => k.includes(':')).length).toBe(1);
    });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd apps/frontend && npx jest src/components/Sidebar.test.tsx -t "accordion"`
Expected: FAIL — `Expense Categories` is still present after opening Reports (current toggle allows multiple subgroups open).

- [ ] **Step 3: Add the helper imports**

In `apps/frontend/src/components/Sidebar.tsx`, find the existing import from `sidebar-nav-filter`:

```ts
import { buildOpenGroupsState, collectNavGroupKeys, filterNavModules } from '@/lib/sidebar-nav-filter';
```

Replace it with:

```ts
import {
    accordionCloseState,
    accordionOpenState,
    buildOpenGroupsState,
    collectNavGroupKeys,
    filterNavModules,
} from '@/lib/sidebar-nav-filter';
```

(If the current import list differs slightly, keep its existing members and add `accordionCloseState` and `accordionOpenState`.)

- [ ] **Step 4: Rewrite `toggleGroup` as accordion**

Replace the current `toggleGroup` (lines 458-464):

```ts
    const toggleGroup = (key: string) => {
        setOpenGroups((prev) => {
            const next = { ...prev, [key]: !prev[key] };
            localStorage.setItem('sidebar-open-groups', JSON.stringify(next));
            return next;
        });
    };
```

with:

```ts
    const toggleGroup = (key: string) => {
        setOpenGroups((prev) => {
            const next = prev[key]
                ? accordionCloseState(prev, key)
                : accordionOpenState(key);
            localStorage.setItem('sidebar-open-groups', JSON.stringify(next));
            return next;
        });
    };
```

- [ ] **Step 5: Change the active-route effect from merge to replace**

Replace the `setOpenGroups` block at the end of the active-route effect (currently lines 350-361):

```ts
        setOpenGroups((prev) => {
            let changed = false;
            const next = { ...prev };
            for (const [key, value] of Object.entries(toOpen)) {
                if (value && !next[key]) {
                    next[key] = true;
                    changed = true;
                }
            }
            if (!changed) return prev;
            localStorage.setItem('sidebar-open-groups', JSON.stringify(next));
            return next;
        });
```

with a replace that enforces the accordion invariant (the active section becomes the only open chain):

```ts
        setOpenGroups((prev) => {
            const prevKeys = Object.keys(prev).filter((key) => prev[key]);
            const nextKeys = Object.keys(toOpen);
            const unchanged =
                prevKeys.length === nextKeys.length &&
                nextKeys.every((key) => prev[key]);
            if (unchanged) return prev;
            localStorage.setItem('sidebar-open-groups', JSON.stringify(toOpen));
            return toOpen;
        });
```

Leave the early `if (Object.keys(toOpen).length === 0) return;` (line 348) in place: when the current page belongs to no group (e.g. the dashboard landing after login), the effect makes no change, so a freshly-cleared `localStorage` leaves every group collapsed.

- [ ] **Step 6: Run the new tests to verify they pass**

Run: `cd apps/frontend && npx jest src/components/Sidebar.test.tsx -t "accordion"`
Expected: PASS (both new tests).

- [ ] **Step 7: Run the full Sidebar suite to verify no regressions**

Run: `cd apps/frontend && npx jest src/components/Sidebar.test.tsx`
Expected: PASS (all tests, including `expands and collapses all menu groups` and the subgroup tests).

- [ ] **Step 8: Commit**

```bash
git add apps/frontend/src/components/Sidebar.tsx apps/frontend/src/components/Sidebar.test.tsx
git commit -m "feat(sidebar): accordion navigation — one section open at a time"
```

---

### Task 3: Collapse the sidebar on login

**Files:**
- Modify: `apps/frontend/src/lib/auth-session.ts`
  - add an exported `clearSidebarLayoutState()` near `removeStorage` (after line 118)
  - call it at the top of `storeAuthResponse` (after line 122)
- Test: `apps/frontend/src/lib/auth-session.test.ts` (new file)

**Interfaces:**
- Consumes: existing `removeStorage(key: string): void` (auth-session.ts:115).
- Produces: `clearSidebarLayoutState(): void` — removes `sidebar-open-groups`, `sidebar-collapsed`, `sidebar-width` from both storage backends.

- [ ] **Step 1: Write the failing test**

Create `apps/frontend/src/lib/auth-session.test.ts`:

```ts
import { clearSidebarLayoutState } from './auth-session';

describe('clearSidebarLayoutState', () => {
    beforeEach(() => {
        localStorage.clear();
        sessionStorage.clear();
    });

    it('removes the persisted sidebar layout keys from localStorage', () => {
        localStorage.setItem('sidebar-open-groups', '{"accounting":true}');
        localStorage.setItem('sidebar-collapsed', 'true');
        localStorage.setItem('sidebar-width', '320');

        clearSidebarLayoutState();

        expect(localStorage.getItem('sidebar-open-groups')).toBeNull();
        expect(localStorage.getItem('sidebar-collapsed')).toBeNull();
        expect(localStorage.getItem('sidebar-width')).toBeNull();
    });

    it('clears sidebar keys from sessionStorage too', () => {
        sessionStorage.setItem('sidebar-width', '320');

        clearSidebarLayoutState();

        expect(sessionStorage.getItem('sidebar-width')).toBeNull();
    });

    it('leaves unrelated keys untouched', () => {
        localStorage.setItem('tenant_id', 'abc');

        clearSidebarLayoutState();

        expect(localStorage.getItem('tenant_id')).toBe('abc');
    });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/frontend && npx jest src/lib/auth-session.test.ts`
Expected: FAIL — `clearSidebarLayoutState is not a function`.

- [ ] **Step 3: Implement and wire the helper**

In `apps/frontend/src/lib/auth-session.ts`, add this exported function immediately after `removeStorage` (after line 118):

```ts
/**
 * Sidebar rail/menu open-state persisted for a returning session. Cleared on
 * login so every login starts with a fully-collapsed sidebar at default width.
 */
export function clearSidebarLayoutState(): void {
    removeStorage('sidebar-open-groups');
    removeStorage('sidebar-collapsed');
    removeStorage('sidebar-width');
}
```

Then in `storeAuthResponse`, immediately after the token is stored (after line 122 `setStorage('access_token', data.access_token, rememberMe);`), add:

```ts
    // Fresh login → start from a collapsed, default-width sidebar.
    clearSidebarLayoutState();
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd apps/frontend && npx jest src/lib/auth-session.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Typecheck and lint the touched files**

Run: `cd apps/frontend && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add apps/frontend/src/lib/auth-session.ts apps/frontend/src/lib/auth-session.test.ts
git commit -m "feat(sidebar): reset sidebar to collapsed default on login"
```

---

## Verification (after all tasks)

- [ ] Run the full frontend test suite: `cd apps/frontend && npx jest`
  Expected: all pass.
- [ ] Manual smoke (per the `verify` skill): log in as a demo user, expand a menu section, log out, log back in → the sidebar loads with all sections collapsed and the current page's section auto-opened; opening another section collapses the first.

## Self-Review Notes

- **Spec coverage:** Accordion open-logic → Task 1 + Task 2 (toggleGroup). Active-route merge→replace → Task 2 (Step 5). Collapse-on-login → Task 3. Signup out of scope, bulk buttons unchanged → honored (no code touches them).
- **Type consistency:** `accordionOpenState` / `accordionCloseState` signatures match between Task 1 (defined) and Task 2 (consumed). `clearSidebarLayoutState` matches between Task 3 definition and its `storeAuthResponse` call site.
- **No placeholders:** every step shows concrete code and exact commands.
