# UI Design-System Migration — Execution Plan

Source of truth: `docs/ui-design-guidelines.md` (Part 2 = target state, Part 1 = current-state citations).
Branch: `dev`. Implementers DO NOT commit — the controller commits per task scope after each batch.

## Global constraints (bind every task)

- Follow `docs/ui-design-guidelines.md` §2.2–§2.11 and the CLAUDE.md "UI Rules (frontend)" section exactly.
- Semantic tokens once Task 1 lands: `primary` (blue-600 family), `success` (emerald), `warning` (amber), `danger` (red), `canvas` (#f3f4f6). Use them instead of raw palette in all NEW/EDITED class strings.
- Radius: `rounded-md` inputs/buttons, `rounded-lg` cards/dropdowns/tables, `rounded-xl` modals, `rounded-full` badges/avatars only. No `rounded-2xl`/`rounded-3xl` in app code.
- No `font-black`, no `uppercase tracking-widest` (exception: DataTable comfortable header cells, which already do this centrally).
- No colored shadows, no `hover:-translate-y-*`. Shadows: cards `shadow-sm`, dropdowns `shadow-lg`, modals `shadow-2xl`.
- Z-index: sticky `z-10`, backdrop `z-30`, drawer `z-40`, dropdown `z-50`, modal `z-modal` (60), toast `z-toast` (70).
- Touch: interactive elements `min-h-touch` below `md` where practical; never shrink below 44px on mobile.
- Money via `formatBDT()`, never `$`.
- Do not touch `apps/frontend/src/app/store/**` (storefront), marketing pages (`src/app/page.tsx`, pricing/contact/terms/privacy/sla/refund/demo), or print/export HTML strings, unless a task explicitly says so.
- Keep all i18n keys working; don't hardcode English where a `t.` key exists.
- Each task: run `npx tsc --noEmit` in `apps/frontend` and the jest tests covering touched files; report command + output summary. Do NOT run `git commit`.
- Only modify files inside your task's stated scope.

## Phase 1 — Foundation

### Task 1: Tailwind semantic tokens + fonts
Scope: `apps/frontend/tailwind.config.js`, `apps/frontend/src/app/layout.tsx`, `apps/frontend/src/lib/ui/compact-density.ts`.
- In `tailwind.config.js` `theme.extend.colors` add: `primary: {DEFAULT:'#2563eb', hover:'#1d4ed8', light:'#eff6ff', border:'#bfdbfe'}` (blue-600/700/50/200), `success: {DEFAULT:'#059669', light:'#ecfdf5', text:'#047857'}` (emerald-600/50/700), `warning: {DEFAULT:'#f59e0b', light:'#fffbeb', text:'#b45309'}` (amber-500/50/700), `danger: {DEFAULT:'#dc2626', light:'#fef2f2', text:'#b91c1c'}` (red-600/50/700), `canvas:'#f3f4f6'`, `surface:'#ffffff'`.
- Add `theme.extend.zIndex: { modal:'60', toast:'70' }`.
- Load fonts via `next/font/google` in `src/app/layout.tsx`: Inter (`variable: '--font-inter'`, `subsets:['latin']`) and Noto Sans Bengali (`variable:'--font-bengali'`, `subsets:['bengali']`, weights 400/500/600/700). Apply both variables on `<body>`. In tailwind config set `theme.extend.fontFamily.sans = ['var(--font-inter)','var(--font-bengali)', ...defaultTheme.fontFamily.sans]`.
- Update `compact-density.ts`: `bg-[#f3f4f6]` → `bg-canvas`; focus rings `focus:ring-blue-500/20 focus:border-blue-300` → `focus:ring-primary/20 focus:border-primary/40`; `btnPrimary` blue classes → `bg-primary hover:bg-primary-hover text-white`.
- Verify: `npx tsc --noEmit`; `npm run build` NOT required; run existing jest suite for any touched components.

### Task 2: Arbitrary-hex sweep (canvas/neutrals only)
Scope: all of `apps/frontend/src` EXCEPT storefront/marketing/print exclusions above. Depends on Task 1.
- Replace class usages: `bg-[#f3f4f6]` → `bg-canvas` (126×); `bg-[#f9fafb]` → `bg-canvas`; `text-[#111827]` → `text-gray-900`; `border-[#eef2f7]` → `border-gray-100`.
- Do NOT touch color-accent hexes (`#6366f1`, `#16a34a`, `#dc2626` in dashboard components — Phase 4), navy `#293F75`/`#1f3058` (print/brand), or anything inside template-literal print HTML.
- Mechanical: prefer scripted replacement + manual spot check of ~10 files. Verify tsc + `grep -rn "bg-\[#f3f4f6\]" src` returns 0.

## Phase 2 — Primitives (Tasks 3–7 run in parallel; disjoint files)

### Task 3: Form primitives
Scope: NEW files `apps/frontend/src/components/ui/{Input,Select,Textarea,Checkbox,Field,FormGrid,FormFooter}.tsx` + colocated `*.test.tsx`. Do not create/modify `index.ts` (Task 8 owns the barrel) or any existing file.
- Control recipe (guidelines §2.6): `w-full rounded-md border border-gray-200 bg-gray-50 px-2.5 py-1.5 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40 focus:bg-white disabled:opacity-60 max-md:min-h-touch` + `border-danger` when `error` prop set. All controls `forwardRef`, spread rest props.
- `Field`: props `label`, `required`, `error`, `hint`, `htmlFor`, children. Label `text-xs font-medium text-gray-600`; required adds `<span className="text-danger"> *</span>`; error `text-xs text-danger mt-1` with `role="alert"`; hint `text-xs text-gray-400 mt-1`.
- `FormGrid`: `grid gap-3 sm:grid-cols-2`; `<FormGrid.Full>` (or `full` prop on a wrapper) → `sm:col-span-2`.
- `FormFooter`: right-aligned `flex justify-end gap-2 border-t border-gray-100 pt-3`, accepts children.
- Jest tests per component (render, error state, required marker). Follow TDD.

### Task 4: Button upgrade
Scope: `apps/frontend/src/components/ui/compact/Button.tsx` + its test file only.
- Variants: `primary` (`bg-primary hover:bg-primary-hover text-white`), `secondary` (existing gray outline), `ghost` (`text-gray-600 hover:bg-gray-100`), `danger` (`bg-danger hover:bg-red-700 text-white`). Sizes: `sm` = `px-3 py-1.5 text-xs` (default), `md` = `px-4 py-2 text-sm`. Shape `rounded-md`, `font-semibold`, `inline-flex items-center gap-1.5`, `disabled:opacity-60`, `max-md:min-h-touch`.
- Add `loading` prop (spinner via lucide `Loader2 animate-spin`, disables button) and optional `icon` prop (ReactNode before label).
- Keep the existing exported API backward compatible (existing `variant="primary|secondary"` callers must not break). Tests for each variant/size/loading.

### Task 5: StatusBadge + Alert
Scope: NEW files `apps/frontend/src/components/ui/{StatusBadge,Alert}.tsx` + tests. No barrel edits.
- `StatusBadge`: `inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium`; prop `tone: 'success'|'warning'|'danger'|'info'|'neutral'` → `bg-success-light text-success-text`, `bg-warning-light text-warning-text`, `bg-danger-light text-danger-text`, `bg-primary-light text-blue-700`, `bg-gray-100 text-gray-600`. Also export `statusToneFor(status: string)` mapping: active/paid/completed/approved/posted→success; pending/draft/processing→warning; overdue/failed/cancelled/rejected/lost→danger; new/info→info; else neutral (case-insensitive).
- `Alert`: prop `tone: 'info'|'success'|'warning'|'danger'`, optional `title`, children; `rounded-md border p-3 text-sm` + tone tint/border; lucide icon per tone; `role="alert"` for danger/warning, `role="status"` otherwise.

### Task 6: ModalShell header/footer + z tokens
Scope: `apps/frontend/src/components/ModalShell.tsx` + test file only.
- Export `ModalHeader` (`px-4 py-3 border-b border-gray-100 flex items-center justify-between`; title `text-base font-semibold text-gray-900`; standard X close button with `aria-label`) and `ModalFooter` (`px-4 py-3 border-t border-gray-100 flex justify-end gap-2`, sticky bottom within scrollable panel).
- Panel radius `rounded-t-xl sm:rounded-xl` (down from 3xl), shadow `shadow-2xl`, backdrop `z-modal` (uses new zIndex token; keep the mobile bottom-sheet behavior exactly as is).
- Keep existing props/API backward compatible; existing 10 callers must not break (they render their own headers — `ModalHeader`/`ModalFooter` are opt-in).

### Task 7: DataTable-owned selection + bulk bar
Scope: `apps/frontend/src/components/data-table/DataTable.tsx`, new `apps/frontend/src/components/data-table/BulkActionBar.tsx`, `apps/frontend/src/app/(app)/crm/leads/page.tsx`, tests in `src/components/data-table/`.
- When `enableRowSelection` is true and no caller-supplied `id:'select'` column exists, DataTable injects a checkbox column (header = select-all-on-page, cells = row checkbox, `text-primary focus:ring-primary/40`, width ~36px, not hideable/exportable).
- New prop `bulkActions?: { label, onClick(selectedRows), tone?: 'default'|'danger', icon? }[]`. When >0 rows selected render `BulkActionBar` above the table: `bg-primary-light border border-primary-border rounded-lg px-3 py-2 flex items-center gap-2 text-sm` with count, action buttons, and a clear-selection button.
- Migrate `crm/leads/page.tsx` to the injected column + `bulkActions` (delete keeps its confirmation; status-set and assign keep existing behavior incl. `selectionEpoch` clearing — move that into DataTable if trivial, else keep). Remove the page's hand-rolled `select` column and violet bulk banner.
- Tests: injected column renders; bulk bar appears on selection; leads page tests still pass.

### Task 8: UI barrel (after 3–7)
Scope: NEW `apps/frontend/src/components/ui/index.ts` only.
- Re-export: Input, Select, Textarea, Checkbox, Field, FormGrid, FormFooter, StatusBadge, Alert, statusToneFor, Button (from `./compact/Button`), plus existing compact exports (PageShell, PageHeader, PageToolbar, CompactSection, CompactStat, CompactLinkGrid). Verify `npx tsc --noEmit`.

## Phase 3 — Mechanical adoption (Tasks 9–14 parallel; disjoint directories)

Shared checklist for every Phase 3 task, applied ONLY within the task's directory scope:
(a) Replace hand-copied page wrappers (`overflow-y-auto h-full bg-canvas p-3 md:p-4 font-sans text-gray-900 text-[13px]` or the old `bg-[#f3f4f6]` string) with `PageShell` from `@/components/ui`.
(b) Migrate hand-rolled `fixed inset-0` modals to `ModalShell` (+ `ModalHeader`/`ModalFooter`). Choose size by content (`sm` confirm, `md`/`lg` forms, `xl` multi-column).
(c) Delete page-local toast state/markup (`fixed bottom-6 right-6 …`); use the global toast store (`@/components/Toaster` — check its exported API, e.g. `useToastStore`/`toast`) instead.
(d) Replace raw primary/secondary `<button>`s that duplicate Button's job with `Button` from `@/components/ui` (only obvious cases; skip complex bespoke buttons).
(e) Replace ad-hoc status pills with `StatusBadge` where the mapping is obvious.
(f) New/edited class strings follow global constraints (tokens, radius, no font-black).
Do not redesign layouts; this phase is mechanical adoption. Run tsc + related jest tests.

### Task 9: settings/*
Scope: `apps/frontend/src/app/(app)/settings/**`. (~12 wrapper copies, local toasts, `border-gray-300` inputs → `Input`/`Field` where forms are simple.)

### Task 10: admin/* + platform components
Scope: `apps/frontend/src/app/(app)/admin/**`, `apps/frontend/src/components/admin/**`, `apps/frontend/src/components/platform/**`. (23 wrapper copies, all modals hand-rolled, indigo accents left for Phase 4 — but wrappers/modals/toasts now.)

### Task 11: sales/* (excluding POS)
Scope: `apps/frontend/src/app/(app)/sales/**` EXCEPT `sales/pos/**`. Includes AddCustomerModal, CreateOrderModal, IssueReturnModal etc. already on ModalShell — normalize their headers/footers to ModalHeader/ModalFooter; migrate inline dialogs (loyalty, delivery).

### Task 12: purchases/* + inventory/*
Scope: `apps/frontend/src/app/(app)/purchases/**`, `apps/frontend/src/app/(app)/inventory/**`. (CreatePurchaseModal, AddProductModal normalize; brands/suppliers inline dialogs → ModalShell; wrappers.)

### Task 13: hr/* + manufacturing + support + team + profile + notifications + billing + referrals + ai-credits + sms-credits + help + status
Scope: those directories under `apps/frontend/src/app/(app)/`. (hr modals, manufacturing page dialogs, profile/team toasts, wrappers.)

### Task 14: crm/* + import-dialog
Scope: `apps/frontend/src/app/(app)/crm/**`, `apps/frontend/src/components/import-dialog.tsx`. Additionally: replace `alert()` validation in lead forms with inline `Field` errors (per-field, using existing `validateLeadForm` error codes); remove the duplicate external search box on leads (keep server-side filter selects, drop the redundant text search or wire it to DataTable's single search); import-dialog → ModalShell with wizard steps intact.

## Phase 4 — Color normalization (Tasks 15–18 parallel; disjoint directories)

Rule: interactive/primary accents → `primary`; success/positive-money stays `success`; destructive → `danger`; warnings → `warning`. Green→emerald, rose→red equivalents. Decorative per-module accents die. Icon tints on module-hub/settings-hub cards MAY stay for wayfinding.

### Task 15: CRM violet → primary
Scope: `apps/frontend/src/app/(app)/crm/**`. All violet-* classes.

### Task 16: dashboard indigo → tokens
Scope: `apps/frontend/src/app/(app)/dashboard/**`, `apps/frontend/src/components/dashboard/**`. `#6366f1` → primary (`#2563eb`) in DashboardHeader/Sparkline; `#16a34a`/`#dc2626` delta colors → success/danger tokens; donut palette → defined categorical list starting with primary; delete unused `KpiTile.tsx` (verify zero imports first).

### Task 17: admin indigo/rounded-3xl/space-y-8 → compact
Scope: `apps/frontend/src/app/(app)/admin/**`, `apps/frontend/src/components/admin/**`. indigo → primary; `rounded-3xl` cards → `rounded-lg`; `space-y-8` → `space-y-4`; StatCard/QuickLink restyle to compact (`CompactStat`/`CompactLinkGrid` where drop-in).

### Task 18: purchases/expenses/sales accents
Scope: `apps/frontend/src/app/(app)/purchases/**`, `apps/frontend/src/app/(app)/accounting/**`, `apps/frontend/src/app/(app)/sales/**` (excl. pos). Emerald primary-action buttons → `primary` (emerald stays only on money-positive VALUES/badges); rose → danger; `shadow-blue-200`/`shadow-emerald-200` + `hover:-translate-y-0.5` removed; green-*→emerald equivalents, rose-*→red equivalents on status tints.

## Phase 5 — Surface polish (Tasks 19–22; 19+20 parallel, then 21+22 parallel)

### Task 19: Feedback out of floating dock
Scope: `apps/frontend/src/app/(app)/layout.tsx`, `apps/frontend/src/components/{FloatingAssistDock,FeedbackWidget}.tsx` + tests.
- FeedbackWidget becomes a header icon button (MessageSquare icon, next to NotificationBell, same icon-button style `rounded-md p-2 hover:bg-gray-100`) opening the same panel as a header dropdown (`absolute right-0 top-full mt-2 w-80 … z-50`), matching NotificationBell's pattern incl. outside-click/Escape close. Mobile: include it in AppHeaderMobileMenu if header space is tight, else keep icon visible. Delete FloatingAssistDock. Keep the `platformFeatures.feedback` gate.

### Task 20: POS fixes
Scope: `apps/frontend/src/app/(app)/sales/pos/**`.
- `${product.price}` literals → `formatBDT(...)` (lines ~629, ~846 and any others).
- Mobile cart FAB → persistent bottom summary bar (`fixed bottom-0 inset-x-0 md:hidden`, safe-area padding, item count + total + "View cart" button opening the existing sheet); scroll container gets matching bottom padding.
- POS-local toast stack → global Toaster; rogue `z-[100]`/`z-30` → ladder tokens.
- Leave POS's overall two-pane layout and boutique card styling otherwise intact EXCEPT `rounded-3xl` → `rounded-xl` and `font-black uppercase tracking-widest` micro-labels → `text-xs font-semibold` (mechanical).

### Task 21: Detail-page compact headers
Scope: `apps/frontend/src/app/(app)/crm/leads/[id]/page.tsx`, `apps/frontend/src/app/(app)/hr/employees/[id]/page.tsx`.
- Replace `p-8 rounded-3xl` hero cards with compact identity band: `rounded-lg border border-gray-100 bg-white p-4` — 40px avatar, name `text-base font-semibold`, StatusBadges inline, actions (Button) right, meta row `text-xs text-gray-500`. Sub-cards → `rounded-lg p-4`; section headers → `text-sm font-semibold text-gray-900`.

### Task 22: Quick wins
Scope: `apps/frontend/src/lib/branding.tsx`, `apps/frontend/src/components/{FeedbackWidget,VoiceNavWidget,AppHeaderMobileMenu,NotificationBell}.tsx`, new `apps/frontend/src/hooks/useDismissable.ts`.
- New `useDismissable(ref, onClose, enabled)` hook (outside mousedown + Escape, with the setTimeout(0) guard); adopt in the four widgets.
- Remove dead `--color-primary`/`--color-primary-dark` writes from branding.tsx (keep the rest of BrandingProvider), and the settings/branding page's use if it becomes dead — if the page exposes a color picker, leave the picker but note it in the report.

## Phase 6 — Docs & ratification

### Task 23: Docs
Scope: `docs/front-end-spec.md`, `docs/ui-design-guidelines.md`, `TODO.md`.
- `front-end-spec.md`: prepend a SUPERSEDED banner pointing to `docs/ui-design-guidelines.md`; replace its Color Palette/Typography/Button sections with pointers (keep UX-goals content).
- `ui-design-guidelines.md`: status PROPOSED → ADOPTED (2026-07-14); update Part 1 notes that describe now-fixed issues to past tense where phases landed.
- `TODO.md`: check off the six phase items + quick wins under "UI Design System", move to COMPLETED with date.

## Verification gates

- After each phase: `npx tsc --noEmit` clean (modulo pre-existing known errors), jest suite for touched areas green.
- After Phase 3 and Phase 5: full `npm run build` in `apps/frontend` must succeed.
- Final: whole-branch code review, then full build + jest.
