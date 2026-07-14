# ERP71 UI Design Guidelines (PROPOSED)

**Status: PROPOSAL — no UI changes have been made.** This document is the output of a full UI review (2026-07-14) covering the app shell, list/table pages, forms/modals/detail pages, dashboard, POS, storefront, auth/marketing, settings, and admin surfaces. Part 1 records what exists today; Part 2 proposes the guidelines; Part 3 proposes a migration order.

Goals: **beautiful, compact, consistent, mobile-responsive, minimal scrolling, nothing hidden behind floating buttons.**

---

## Part 1 — Current state (audit summary)

### What's already good (keep and build on)

- **`src/lib/ui/compact-density.ts`** is a real, working de-facto design system: page/card/button/form/table density tokens with `comfortable`/`compact` variants. It just isn't adopted widely.
- **`DataTable`** (`src/components/data-table/DataTable.tsx`, TanStack v8) is used by ~66 list pages with consistent toolbar, search, filters, presets, column persistence, export, pagination, mobile scroll hint, and `hideOnMobile` column support. Pagination is the one fully consistent pattern in the app.
- **`ModalShell`** has correct mobile behavior (bottom sheet < `sm`, centered card above).
- **The shell** (`(app)/layout.tsx` + `Sidebar.tsx`) is solid: `h-dvh`, safe-area utilities, focus trap, swipe-to-close, resizable/collapsible sidebar, `min-h-touch` (44px) targets.
- **Marketing + auth pages** are the most internally consistent surface (blue-600, `rounded-xl/2xl`, gray-50) and effectively define the brand.

### The core problem: one system, thin adoption

The compact system exists but is bypassed everywhere:

| Primitive | Adopted | Bypassed |
|---|---|---|
| `PageShell` | CRM leads, accounting, settings hub, dashboard | ~35 pages (12 settings, 23 admin, plus sales/purchases/hr/inventory lists) hand-copy the literal string `overflow-y-auto h-full bg-[#f3f4f6] p-3 md:p-4 font-sans text-gray-900 text-[13px]` |
| `ModalShell` | 10 modals | 27 hand-rolled `fixed inset-0 z-50` modals (all admin, import-dialog, many inline page dialogs) — centered-only, no mobile bottom sheet |
| `compactDensity.formField` / `formLabel` / `modal` tokens | ~0 consumers | every form declares its own input classes |
| `compact/Button.tsx` | rare | most screens write raw `<button>` classes |
| Global `Toaster` (`z-[70]`) | some | ~20 pages hand-roll `fixed bottom-6 right-6` toasts; POS has a third toast system at `z-[100]` |
| DataTable `enableRowSelection` | CRM leads (full checkbox column + bulk bar) | 10 other pages enable selection but render no checkboxes and no bulk UI (dead code) |

### Concrete inconsistencies found

1. **Color drift.** Blue-600 is the de-facto primary (206× `bg-blue-600`), but modules invented their own accents: CRM = violet, purchases = emerald, expenses = rose, dashboard = indigo `#6366f1` hex, admin = indigo, POS = black/blue mix, storefront = black CTAs with blue Pay button. Success is sometimes green, sometimes emerald; danger is sometimes red, sometimes rose.
2. **No token layer.** `tailwind.config.js` extends almost nothing (safe-area spacing, `touch` size, hero animations). Raw palette + arbitrary hex everywhere: `bg-[#f3f4f6]` 126×, `bg-[#f9fafb]` 14×, `#6366f1`, `#eef2f7`, `#16a34a`, navy `#293F75`. The tenant-branding CSS var `--color-primary` (set in `src/lib/branding.tsx`) is **written but never consumed** — dead code.
3. **Radius chaos.** `rounded-xl` 905×, `rounded-lg` 563×, `rounded-2xl` 484×, `rounded-3xl` 91×, often clashing within a single page (CRM detail: `rounded-3xl` hero + `rounded-2xl` cards + `rounded-xl` boxes).
4. **Input recipes: at least 5 distinct ones** — heights `py-1.5`→`py-4`, borders `gray-100/200/300/none`, radii `lg/xl/2xl`, focus rings `/10` vs `/20`. No shared Input/Select/Field component exists at all.
5. **Button recipes: at least 6** — with/without `shadow-lg shadow-blue-200`, `hover:-translate-y-0.5`, `font-black uppercase tracking-widest`, sizes from `px-3 py-1.5 text-xs` to `px-6 py-3`.
6. **Two typographic voices**: compact (`font-medium`/`font-bold`, normal case) vs "expressive" (`font-black uppercase tracking-widest`) — both sometimes on the same page.
7. **Validation** is `alert()` in CRM, inline banners elsewhere, no inline per-field errors anywhere; required-field marking mostly absent.
8. **No z-index scale**: dropdowns and modals are both `z-50`; the feedback dock ties the mobile sidebar at `z-40`; toasts are `z-[70]` globally but `z-[100]` in POS.
9. **No fonts loaded** — system stack only, and **no Bangla font** despite i18n. `docs/front-end-spec.md` (green #4CAF50, Roboto/Open Sans, 16px body) matches nothing that was built and should be superseded by this document.
10. **Floating UI**: FeedbackWidget is a fixed bottom-right pill dock (`FloatingAssistDock`) that covers content; POS has its own cart FAB; VoiceNav lives in the header (fine).
11. **Bugs spotted along the way**: POS renders `${product.price}` (literal `$`) on product cards while totals use `formatBDT()` (`sales/pos/page.tsx:629,846`); CRM leads has two search inputs (its own filter row duplicates DataTable's built-in search); duplicated outside-click/Escape `useEffect` in 4+ header widgets; sidebar logo height hand-synced to header height via magic numbers.
12. **Dark mode**: zero `dark:` usage — out of scope for these guidelines (explicitly not supported for now).

---

## Part 2 — Proposed guidelines

### 2.1 Principles

1. **Compact by default.** This is a data-dense ERP for busy shopkeepers: `text-sm`/`text-[13px]` body, tight padding, high information density. Density comes from spacing, never from shrinking touch targets below 44px on mobile.
2. **One way to do each thing.** Every page uses the shared shell, header, table, form, modal, button, badge, and toast primitives. If a page needs something new, extend the primitive — don't fork it locally.
3. **Nothing important behind floating buttons.** Persistent features live in the header, sidebar, or page toolbar. Floating overlays are reserved for transient system feedback (toasts) only. See §2.8.
4. **Minimal scrolling.** The primary task of a page (scan a list, fill a form, read a record) should be doable at 1366×768 without scrolling past chrome. See §2.9.
5. **Beautiful = restrained.** One accent color, one radius scale, one shadow level per layer, whitespace instead of decoration. Retire the `font-black uppercase tracking-widest` voice and gimmick hover-translate shadows.
6. **Tokens over literals.** No arbitrary hex (`bg-[#f3f4f6]`) and no re-typed class strings in pages; everything routes through Tailwind theme tokens + the shared components.

### 2.2 Color system

Codify in `tailwind.config.js` as semantic aliases (so `bg-primary` etc. work and the palette can change in one place):

| Token | Value | Use |
|---|---|---|
| `primary` | blue-600 (`#2563eb`, hover blue-700) | All primary actions, links, active nav, focus rings — **every module** |
| `success` | emerald-600 / tint emerald-50 | Positive money, success states, confirmations |
| `warning` | amber-500 / tint amber-50 | Warnings, pending states |
| `danger` | red-600 / tint red-50 | Destructive actions, errors, negative money |
| `surface` | white | Cards, modals, header, sidebar panel |
| `canvas` | gray-100 (`#f3f4f6`) | App page background (replaces `bg-[#f3f4f6]` and `bg-[#f9fafb]` — pick one everywhere) |
| `border` | gray-200 (default) / gray-100 (subtle internal dividers) | Two levels only |
| Text | gray-900 primary / gray-500 secondary / gray-400 hints | Three levels only |

Rules:

- **Retire per-module accents.** CRM violet, purchases emerald, expenses rose, dashboard/admin indigo all become `primary`. Module identity may survive only as an icon tint on module-hub cards — never on buttons, links, checkboxes, or banners.
- **Green vs emerald, red vs rose: standardize on emerald and red.** No `green-*`, `rose-*` in new code.
- Status badges use a fixed map (see §2.7-Badges), not per-page invented color maps.
- Tenant branding (`--color-primary`): either wire it into the `primary` token properly (storefront first) or delete it. Don't keep a dead variable.

### 2.3 Typography

- **Load fonts via `next/font`**: Inter (Latin) + **Noto Sans Bengali** as the Bangla fallback, exposed as `font-sans`. This is the single biggest visual-polish win available and fixes the currently-unhandled Bangla rendering.
- Scale (matches what's already dominant — `text-sm` 2125×, `text-xs` 1510×):

| Role | Class |
|---|---|
| Page title | `text-lg font-bold tracking-tight text-gray-950` (existing `compactDensity.pageTitle`) |
| Section/card title | `text-sm font-semibold text-gray-900` |
| Body / table cells | `text-sm` (13px in compact contexts via the density token) |
| Secondary / meta / labels | `text-xs text-gray-500`, labels `text-xs font-medium text-gray-600` |
| KPI value | `text-xl font-bold` |
| Eyebrow (optional, dashboards only) | `text-[10px] font-semibold uppercase tracking-wide text-gray-400` |

- **Deprecate `font-black uppercase tracking-widest`** everywhere except tiny table-header cells (comfortable DataTable mode already uses it there). No uppercase buttons.
- `text-base`+ is for marketing/auth/storefront only.

### 2.4 Shape, elevation, spacing

- **Radius — three stops only:** `rounded-md` (inputs, buttons, badges use `rounded-full`), `rounded-lg` (cards, dropdowns, table wrapper), `rounded-xl` (modals, bottom sheets). Retire `rounded-2xl`/`rounded-3xl` in the app (storefront/marketing may keep `rounded-2xl` for its softer consumer look).
- **Shadow — by layer:** cards `shadow-sm`; dropdowns/popovers `shadow-lg`; modals `shadow-2xl`. Nothing else. No colored shadows (`shadow-blue-200`), no hover `-translate-y` effects.
- **Spacing:** page padding `p-3 md:p-4` (existing token); vertical rhythm `space-y-4` between page sections, `gap-3` inside grids, `p-4` card padding (`p-3` for stat tiles). Admin's `space-y-8` tightens to `space-y-4`.
- **Z-index ladder (codify as tokens):** sticky in-page elements `z-10` → sidebar backdrop `z-30` → mobile sidebar drawer `z-40` → dropdowns/popovers `z-50` → modals `z-60` (backdrop) → toasts `z-70`. Fixes today's modal/dropdown tie at `z-50` and POS's rogue `z-[100]`.

### 2.5 Page anatomy

Every `(app)` page — module list, detail, settings, admin — uses the same skeleton:

```
<PageShell>                        ← the ONLY scroll container; owns canvas bg + padding
  <PageHeader title subtitle breadcrumbs actions />
  [optional KPI strip — one row, CompactStat, grid-cols-2 md:grid-cols-4]
  [optional filter bar — only if filters must live outside DataTable]
  <main content: DataTable | form card | detail cards>
</PageShell>
```

- **`PageShell` is mandatory.** Delete every hand-copied `overflow-y-auto h-full bg-[#f3f4f6]…` literal (~35 pages).
- **`PageHeader` is mandatory**: title left, breadcrumbs + actions right. Primary page action (e.g. "Add product") is a `Button variant=primary size=sm` in the header — never a floating button.
- Detail pages: replace the `p-8 rounded-3xl` hero cards with a compact identity band (avatar 40px, name, badges, actions right) + `rounded-lg` cards below. Single column; use tabs when a record has >3 content groups instead of stacking everything (reduces scroll).
- Admin and settings pages follow the exact same anatomy as tenant pages — no separate visual dialect.

### 2.6 Forms

Build the missing primitives in `src/components/ui/` — `Input`, `Select`, `Textarea`, `Checkbox`, `Field` (label + control + error + hint), `FormGrid`, `FormFooter` — based on the already-defined but unused `compactDensity.formField`:

- **Control recipe (one, everywhere):** `w-full rounded-md border border-gray-200 bg-gray-50 px-2.5 py-1.5 text-sm focus:ring-2 focus:ring-primary/20 focus:border-primary/40 focus:bg-white` — height ~34px desktop, `min-h-touch` (44px) below `md`.
- **Label:** above the control, `text-xs font-medium text-gray-600`; required fields get `<span className="text-danger">*</span>`.
- **Errors: inline, per field** — `text-xs text-danger mt-1` + `border-danger` on the control, with a form-level banner only for submit/server errors. **`alert()` validation (CRM leads) is banned.**
- **Layout:** `grid gap-3 sm:grid-cols-2`, full-width fields `sm:col-span-2`. Group with `CompactSection`, not bespoke cards.
- **Footer:** right-aligned `Cancel` (secondary) + primary submit, `border-t pt-3`, sticky at the modal/sheet bottom for long forms. One placement rule; no more left/right/full-width variance.

### 2.7 Components

- **Button** — extend `compact/Button.tsx` and make it the only button: variants `primary | secondary | ghost | danger`, sizes `sm` (`px-3 py-1.5 text-xs`, default) and `md` (`px-4 py-2 text-sm`), optional leading icon, `loading` state. `min-h-touch` on touch devices.
- **Modals** — `ModalShell` is mandatory (migrate the 27 bypassers). Add `ModalHeader` (title `text-base font-semibold` + X) and `ModalFooter` subcomponents so header/footer stop diverging. Size guidance: `sm` confirm/simple create · `md`–`lg` standard forms · `xl`+ multi-column entry. Anything with tabs or >~10 fields should be a page, not a modal.
- **Tables** — DataTable is mandatory for lists (hand-rolled tables remain OK for invoices/financial reports). Fix selection at the source: when `enableRowSelection`, **DataTable injects the checkbox column itself** and renders a standard bulk-action bar (count + actions + clear), generalizing what CRM leads built — this instantly repairs the 10 pages with dead selection. One search only: use DataTable's toolbar; external filter rows only for server-side filters, styled as the standard filter bar. Wide tables must mark secondary columns `hideOnMobile`.
- **Badges** — one `StatusBadge` component: `rounded-full px-2 py-0.5 text-xs font-medium` + tint (`bg-*-50 text-*-700`), with a fixed status→color map (active/paid/completed = success, pending/draft = warning or gray, overdue/failed/cancelled = danger, informational = primary).
- **Toasts** — the global `Toaster` store is the only toast system. Delete the ~20 hand-rolled `fixed bottom-6 right-6` toasts and POS's private stack. Position: top-right below the header, `z-70`, auto-dismiss 4s, danger persists until dismissed.
- **Banners** — one inline `Alert` component (`info | success | warning | danger`) replacing today's ad-hoc `bg-red-50 rounded-*` blocks.
- **Empty & loading states** — DataTable's built-ins everywhere (no extra page-level spinner gates); skeletons (`animate-pulse`) for dashboard panels.
- **Charts** — keep the hand-rolled SVG/CSS charts (they're light and fast) but move their colors to the token palette (`#6366f1` → primary, donut palette → a defined categorical list).

### 2.8 Floating-element policy

**Rule: no feature is reachable *only* via a floating button.**

- **FeedbackWidget: remove the floating dock.** Move Feedback into the header (icon button next to the notification bell) and/or the sidebar footer. `FloatingAssistDock` goes away.
- Allowed fixed-position elements, exhaustively: toasts (`z-70`), the mobile sidebar drawer + backdrop, ModalShell overlays, and header-anchored dropdowns.
- **POS cart FAB (mobile):** replace with a persistent bottom summary bar (item count + total + "View cart"), which is both always visible and not content-covering. If a FAB is ever truly needed, it must duplicate — never replace — an inline entry point.
- Anything fixed must respect safe-area utilities and never overlap the last table row or form footer (add bottom padding to the scroll container equal to any fixed bar).

### 2.9 Density & scroll minimization

- Compact density (`CompactUiProvider density="compact"`) stays the app default.
- **One scroll container per page** (`PageShell`); never nested vertical scrollbars.
- KPI strips: max one row (`grid-cols-2 md:grid-cols-4`); details go to reports, not more tiles.
- DataTable: sticky header row (`sticky top-0`) inside the scroll container; default 25 rows in compact mode.
- Long forms in modals: scrollable body + sticky footer (ModalShell already caps `max-h-[90vh]`).
- Detail pages: tabs over infinite stacking; collapse rarely-used sections (`CompactSection` collapsed by default).
- Filters live in the DataTable toolbar (one line), not in tall filter cards.

### 2.10 Mobile responsiveness

- Single breakpoint philosophy stays: `md` (768px) separates phone from desktop; `sm` for form-grid collapse; `xl` only for wide dashboards.
- **Touch targets ≥ 44px** (`min-h-touch min-w-touch`) for all interactive elements below `md` — including the compact inputs and table row actions.
- Tables: horizontal scroll + edge fade + `hideOnMobile` on secondary columns (make this required, not optional, for tables >5 columns).
- Modals: bottom sheet below `sm` (free once everything uses ModalShell).
- Page actions: `PageHeader` actions wrap; destructive/secondary actions collapse into a `⋯` menu on mobile rather than wrapping to two rows.
- Test viewport: 360×740 (common low-end Android in BD market) — no horizontal body scroll, ever.

### 2.11 Accessibility & i18n

- WCAG AA contrast (tints like `text-*-600` on `*-50` already pass; keep it that way).
- Visible focus rings (`focus-visible:ring-2 ring-primary/40`) on all interactive elements.
- All icon-only buttons get `aria-label`; modals get `role="dialog"` + focus trap (ModalShell already does).
- **Taka everywhere:** all money through `formatBDT()`; no literal `$` (POS bug).
- Layouts must tolerate Bangla text expansion (~20% longer than English) — no fixed-width labels.

---

## Part 3 — Proposed migration order (only on instruction)

Each phase is independently shippable; nothing here has been started.

1. **Foundation (no visual change):** Tailwind semantic tokens (primary/success/warning/danger/canvas, z-ladder, radius aliases); `next/font` Inter + Noto Sans Bengali; replace arbitrary hex with tokens.
2. **Primitives:** Input/Select/Field/FormFooter, Button variants, StatusBadge, Alert; ModalHeader/ModalFooter; DataTable-owned selection column + bulk bar; single Toaster.
3. **Mechanical adoption:** replace the ~35 hand-copied `PageShell` strings; migrate the 27 hand-rolled modals to ModalShell; delete hand-rolled toasts.
4. **Color normalization:** violet/indigo/rose/emerald accents → semantic tokens (CRM, dashboard, admin, purchases, expenses).
5. **Surface polish:** detail-page compact headers + tabs; FeedbackWidget → header/sidebar; POS bottom bar + `$`→`formatBDT` fix; admin restyle to compact.
6. **Docs:** supersede `docs/front-end-spec.md` with this document once ratified.

Quick wins fixable independently at any point: POS `$` bug, CRM double search box, dead `--color-primary`, dead `KpiTile.tsx`, shared `useDismissable` hook for the duplicated outside-click/Escape logic.
