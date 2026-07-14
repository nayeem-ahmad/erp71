# Sales Entry Rework Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the "New Sales Entry" sidebar submenu, replace the POS button on the Sales page with a "New Sales Entry" link, curate the payment methods shown on the sales-entry UI (with an "add method" picker), and make the sale date/time editable and persisted in a new `sale_date` field that all sales reports key off.

**Architecture:** Backend is NestJS + Prisma (PostgreSQL); frontend is Next.js 15 (App Router) with a data-driven nav registry in `packages/shared-types`. We add two Prisma columns (`Sale.sale_date`, `PaymentMethod.show_on_entry`), thread them through DTOs/services, switch sales-report date logic from `created_at` to `sale_date`, and update three frontend surfaces (nav, Sales page, payment/date UI).

**Tech Stack:** NestJS, Prisma, Next.js 15, React, TypeScript, Jest, Tailwind.

## Global Constraints

- All business queries scoped to `tenantId` (enforced by `TenantInterceptor`) — never drop the tenant filter.
- UI rules: `blue-600` accent only; money via `formatBDT()`; no `alert()` (use `toast`); inline field validation; shared `@/components/ui` primitives; no `rounded-2xl/3xl`, no arbitrary hex.
- Prisma migrations live in `packages/database`; run `npm run db:migrate` there. Migration names are kebab-case.
- Backend tests: from `apps/backend`, `npx jest <path>`. Frontend tests: from `apps/frontend`, `npx jest <path>`.
- `created_at` stays the immutable audit timestamp. Only **Sale** reporting/date-filter code moves to `sale_date`. **SalesReturn** keeps `created_at`.
- After completing work, update `TODO.md` per `CLAUDE.md`.
- Development happens on `dev`. Do not commit to `main`.

---

## Phase 1 — Data model

### Task 1: Add `sale_date` to Sale and `show_on_entry` to PaymentMethod

**Files:**
- Modify: `packages/database/prisma/schema.prisma` (model `Sale`, model `PaymentMethod`)
- Create: `packages/database/prisma/migrations/<timestamp>_add_sale_date_and_show_on_entry/migration.sql` (generated)

**Interfaces:**
- Produces: `Sale.sale_date: DateTime` (default now, indexed by `[tenant_id, sale_date]`); `PaymentMethod.show_on_entry: Boolean` (default true).

- [ ] **Step 1: Add `sale_date` to the `Sale` model**

In `packages/database/prisma/schema.prisma`, model `Sale`, add the field next to `created_at`:

```prisma
  created_at     DateTime @default(now())
  sale_date      DateTime @default(now())
```

And add an index alongside the existing `@@index([tenant_id, created_at])`:

```prisma
  @@index([tenant_id, created_at])
  @@index([tenant_id, sale_date])
```

- [ ] **Step 2: Add `show_on_entry` to the `PaymentMethod` model**

In the same file, model `PaymentMethod`, add after `is_active`:

```prisma
  is_active     Boolean  @default(true)
  show_on_entry Boolean  @default(true)
```

- [ ] **Step 3: Create the migration and backfill**

Run: `cd packages/database && npm run db:migrate -- --name add_sale_date_and_show_on_entry`
Expected: a new migration folder is created and applied; Prisma Client regenerates.

- [ ] **Step 4: Backfill `sale_date` from `created_at` for existing rows**

Edit the generated `migration.sql` and append (so historical sales keep their real date):

```sql
UPDATE "Sale" SET "sale_date" = "created_at";
```

Re-apply if needed: `cd packages/database && npx prisma migrate reset --skip-seed` is destructive — instead, for an already-applied dev migration, run the UPDATE once via `npx prisma db execute --stdin` piping the statement, or include it before first apply. For a fresh migration, add the UPDATE line **before** running Step 3 by editing the draft. (`show_on_entry` needs no backfill — the `@default(true)` covers existing rows.)

- [ ] **Step 5: Verify the client picked up the fields**

Run: `cd packages/database && npx prisma generate`
Expected: success. Confirm `sale_date` and `show_on_entry` appear in `node_modules/.prisma/client/index.d.ts` (grep them).

- [ ] **Step 6: Commit**

```bash
git add packages/database/prisma/schema.prisma packages/database/prisma/migrations
git commit -m "feat(db): add Sale.sale_date and PaymentMethod.show_on_entry"
```

---

## Phase 2 — Backend: sale date + payment-method flag

### Task 2: Accept and persist `saleDate` on create/update

**Files:**
- Modify: `apps/backend/src/sales/sale.dto.ts` (`CreateSaleDto`, `UpdateSaleDto`)
- Modify: `apps/backend/src/sales/sales.service.ts` (create ~line 124-155 area; update method)
- Test: `apps/backend/src/sales/sales.service.spec.ts`

**Interfaces:**
- Consumes: `Sale.sale_date` from Task 1.
- Produces: create sets `sale_date` (from `dto.saleDate` or now); update sets `sale_date` when provided.

- [ ] **Step 1: Add `saleDate` to the DTOs**

In `apps/backend/src/sales/sale.dto.ts`, add `IsDateString` to the imports from `class-validator`, then add to both `CreateSaleDto` and `UpdateSaleDto`:

```typescript
    @IsOptional()
    @IsDateString()
    saleDate?: string;
```

- [ ] **Step 2: Write the failing test for create**

In `apps/backend/src/sales/sales.service.spec.ts`, add a test asserting a passed `saleDate` is written to `sale_date` on the created record. Model it on the existing create tests (reuse their mock setup); the key assertion:

```typescript
it('persists a provided saleDate into sale_date', async () => {
  // ...existing arrange/mocks for a minimal valid sale...
  await service.create(tenantId, { ...validDto, saleDate: '2026-01-15T10:00:00.000Z' });
  const createArg = saleCreateMock.mock.calls[0][0];
  expect(createArg.data.sale_date).toEqual(new Date('2026-01-15T10:00:00.000Z'));
});
```

- [ ] **Step 3: Run it and confirm it fails**

Run: `cd apps/backend && npx jest src/sales/sales.service.spec.ts -t "persists a provided saleDate"`
Expected: FAIL (`sale_date` is `undefined` / not set).

- [ ] **Step 4: Set `sale_date` in the create data**

In `apps/backend/src/sales/sales.service.ts`, in the `tx.sale.create({ data: {...} })` call, add:

```typescript
        sale_date: dto.saleDate ? new Date(dto.saleDate) : new Date(),
```

- [ ] **Step 5: Set `sale_date` in the update path**

In the update method's `data` object, add:

```typescript
        ...(dto.saleDate ? { sale_date: new Date(dto.saleDate) } : {}),
```

- [ ] **Step 6: Run the test to confirm pass**

Run: `cd apps/backend && npx jest src/sales/sales.service.spec.ts -t "persists a provided saleDate"`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/backend/src/sales/sale.dto.ts apps/backend/src/sales/sales.service.ts apps/backend/src/sales/sales.service.spec.ts
git commit -m "feat(sales): accept and persist editable saleDate"
```

### Task 3: Add `show_on_entry` to payment-method DTOs and service

**Files:**
- Modify: `apps/backend/src/payment-methods/payment-methods.dto.ts`
- Modify: `apps/backend/src/payment-methods/payment-methods.service.ts` (create ~42-51, update ~124-133, `mapToResponse` ~203-214)
- Test: `apps/backend/src/payment-methods/payment-methods.service.spec.ts` (create if absent)

**Interfaces:**
- Consumes: `PaymentMethod.show_on_entry` from Task 1.
- Produces: create/update accept `show_on_entry?: boolean`; response includes `show_on_entry`.

- [ ] **Step 1: Add `show_on_entry` to the DTOs**

In `payment-methods.dto.ts`, add to `CreatePaymentMethodDto` and `UpdatePaymentMethodDto`:

```typescript
  @IsOptional()
  @IsBoolean()
  show_on_entry?: boolean;
```

And add to `PaymentMethodResponseDto`:

```typescript
  show_on_entry: boolean;
```

- [ ] **Step 2: Write the failing test**

Create/extend `apps/backend/src/payment-methods/payment-methods.service.spec.ts` with a test that create passes `show_on_entry` through and defaults to `true` when omitted:

```typescript
it('defaults show_on_entry to true on create when omitted', async () => {
  await service.create(tenantId, { type: PaymentMethodType.CASH, name: 'Till' } as any);
  expect(createMock.mock.calls[0][0].data.show_on_entry).toBe(true);
});
```

- [ ] **Step 3: Run it and confirm it fails**

Run: `cd apps/backend && npx jest src/payment-methods/payment-methods.service.spec.ts`
Expected: FAIL.

- [ ] **Step 4: Thread the field through create/update/mapToResponse**

In `payment-methods.service.ts` create `data`:

```typescript
        show_on_entry: dto.show_on_entry ?? true,
```

In update `data`:

```typescript
        show_on_entry: dto.show_on_entry ?? paymentMethod.show_on_entry,
```

In `mapToResponse`:

```typescript
      show_on_entry: pm.show_on_entry,
```

- [ ] **Step 5: Run the test to confirm pass**

Run: `cd apps/backend && npx jest src/payment-methods/payment-methods.service.spec.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/backend/src/payment-methods
git commit -m "feat(payment-methods): add show_on_entry flag"
```

---

## Phase 3 — Backend: reports move to `sale_date`

### Task 4: Split `buildDateWindow` and switch sales reports to `sale_date`

**Files:**
- Modify: `apps/backend/src/sales-reports/sales-reports.service.ts`
- Test: `apps/backend/src/sales-reports/sales-reports.service.spec.ts` (create if absent)

**Interfaces:**
- Consumes: `Sale.sale_date`.
- Produces: `buildSaleDateWindow(from?, to?)` filters on `sale_date`; a `buildReturnDateWindow(from?, to?)` (renamed from the old `buildDateWindow`) still filters on `created_at`.

- [ ] **Step 1: Write the failing test for the helper split**

In `sales-reports.service.spec.ts` add:

```typescript
import { buildSaleDateWindow, buildReturnDateWindow } from './sales-reports.service';
// If the helpers are not exported, export them from the module for testing.

it('builds a sale_date window for sales', () => {
  expect(buildSaleDateWindow('2026-01-01', '2026-01-31')).toEqual({
    sale_date: { gte: new Date('2026-01-01'), lte: new Date('2026-01-31') },
  });
});
it('keeps created_at window for returns', () => {
  expect(buildReturnDateWindow('2026-01-01', undefined)).toEqual({
    created_at: { gte: new Date('2026-01-01') },
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `cd apps/backend && npx jest src/sales-reports/sales-reports.service.spec.ts`
Expected: FAIL (helpers undefined / not exported).

- [ ] **Step 3: Replace the single helper with two exported helpers**

At the bottom of `sales-reports.service.ts`, replace `buildDateWindow` (lines ~600-614) with:

```typescript
export function buildSaleDateWindow(from?: string, to?: string) {
    return buildWindow('sale_date', from, to);
}

export function buildReturnDateWindow(from?: string, to?: string) {
    return buildWindow('created_at', from, to);
}

function buildWindow(field: 'sale_date' | 'created_at', from?: string, to?: string) {
    const where: Record<string, any> = {};
    if (from || to) {
        where[field] = {};
        if (from) {
            const date = new Date(from);
            if (!Number.isNaN(date.getTime())) where[field].gte = date;
        }
        if (to) {
            const date = new Date(to);
            if (!Number.isNaN(date.getTime())) where[field].lte = date;
        }
    }
    return where;
}
```

- [ ] **Step 4: Point Sale queries at `buildSaleDateWindow`, returns at `buildReturnDateWindow`**

In `sales-reports.service.ts`, at each site that previously called `buildDateWindow`:
- **Sale** queries (lines ~10, 111, 199, 256, 364, 423, 541) → `buildSaleDateWindow(from, to)`.
- **SalesReturn** queries (the `salesReturn.findMany` at ~25-31 and ~437-440) → `buildReturnDateWindow(from, to)`.

- [ ] **Step 5: Switch Sale `select`/`orderBy`/bucket keys from `created_at` to `sale_date`**

In the same file, change these Sale-only references (leave SalesReturn's `created_at` selects at 31 alone):
- `select: { ..., created_at: true }` on Sale queries (lines ~22, 38, 436, 554) → `sale_date: true`.
- `orderBy: { created_at: 'asc' }` on Sale queries (lines ~23, 557) → `{ sale_date: 'asc' }`.
- Daily/monthly bucket keys reading `sale.created_at` / `item.sale.created_at` (lines ~58, 73, 495, 567) → `.sale_date`.

- [ ] **Step 6: Write a behavioral test — a sale lands in its `sale_date` window**

Add a test (using the service's DB mock) asserting `getSalesSummary` passes a `sale_date` filter (not `created_at`) to `sale.findMany`:

```typescript
it('filters sales summary by sale_date', async () => {
  await service.getSalesSummary(tenantId, { from: '2026-01-01', to: '2026-01-31' } as any);
  const whereArg = saleFindManyMock.mock.calls[0][0].where;
  expect(whereArg).toHaveProperty('sale_date');
  expect(whereArg).not.toHaveProperty('created_at');
});
```

- [ ] **Step 7: Run tests to confirm pass**

Run: `cd apps/backend && npx jest src/sales-reports/sales-reports.service.spec.ts`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/backend/src/sales-reports
git commit -m "feat(sales-reports): key sales reporting off sale_date, keep returns on created_at"
```

### Task 5: Switch remaining Sale-date consumers to `sale_date`

**Files:**
- Modify: `apps/backend/src/customers/customers.service.ts` (getSales ~238-247; getAnalytics ~339-357)
- Modify: `apps/backend/src/customers/segments.service.ts` (~60-66)
- Modify: `apps/backend/src/expenses/expenses.service.ts` (`buildSaleDateWhere` ~286-303)
- Modify: `apps/backend/src/notifications/notifications.service.ts` (generateSalesReport ~390-458)
- Test: co-located `.spec.ts` for each where one exists

**Interfaces:**
- Consumes: `Sale.sale_date`.
- Produces: customer purchase history, RFM last-purchase, expense revenue window, and scheduled sales report all key off `sale_date`.

- [ ] **Step 1: customers.service.ts — getSales**

In `getSales`, change the `where.created_at` date-range (lines ~238-240) to `where.sale_date`, and the `orderBy: { created_at: 'desc' }` (line ~247) to `{ sale_date: 'desc' }`.

- [ ] **Step 2: customers.service.ts — getAnalytics last purchase**

In `getAnalytics`, change the `sale.findFirst` `orderBy: { created_at: 'desc' }` and `select: { created_at: true }` (lines ~341-342) to `sale_date`, and update the downstream `last_purchase_date`/`days_since_last_purchase` reads (lines ~349, 357) to use `sale.sale_date`.

- [ ] **Step 3: segments.service.ts — RFM last purchase**

Change `sale.groupBy` `_max: { created_at: true }` (line ~66) to `_max: { sale_date: true }` and its consumer (line ~72) to read `_max.sale_date`.

- [ ] **Step 4: expenses.service.ts — buildSaleDateWhere**

In `buildSaleDateWhere` (lines ~286-303), change `where.created_at` (291/294/298) to `where.sale_date`. `getSummary`'s aggregate (200-203) inherits it.

- [ ] **Step 5: notifications.service.ts — scheduled sales report**

In `generateSalesReport`, change the Sale `where: { created_at: { gte, lte } }` and `select: { created_at }` (lines ~390-395) to `sale_date`, and the daily/weekly bucket keys (447, 458) to `sale.sale_date`. Leave line ~429 (`customer.count` on `created_at`) unchanged.

- [ ] **Step 6: Run the affected suites**

Run: `cd apps/backend && npx jest src/customers src/expenses src/notifications`
Expected: PASS (fix any spec that asserted `created_at` on a Sale query — update it to `sale_date`).

- [ ] **Step 7: Typecheck the backend**

Run: `cd apps/backend && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add apps/backend/src/customers apps/backend/src/expenses apps/backend/src/notifications
git commit -m "feat: key customer/expense/notification sales aggregates off sale_date"
```

---

## Phase 4 — Frontend: nav + Sales page

### Task 6: Remove "New Sales Entry" from the sidebar default layout

**Files:**
- Modify: `packages/shared-types/navigation.ts` (`DEFAULT_NAV_LAYOUT`, ~line 246)
- Test: `apps/frontend/src/lib/nav-resolver.test.ts` (or add an assertion in `sidebar-nav-filter.test.ts`)

**Interfaces:**
- Consumes: nav registry.
- Produces: `sales.new` absent from default sidebar children; `/sales/new` route + registry entry retained.

- [ ] **Step 1: Write the failing test**

In `apps/frontend/src/lib/nav-resolver.test.ts`, add:

```typescript
it('does not include sales.new in the default sales children', () => {
  const sales = buildNavModulesFromLayout(DEFAULT_NAV_LAYOUT, messagesFixture)
    .find((m) => m.key === 'sales');
  const hrefs = (sales?.children ?? []).flatMap((c) =>
    'children' in c && c.children ? c.children.map((l) => l.href) : [c.href]);
  expect(hrefs).not.toContain('/sales/new');
});
```

Use the existing imports/fixtures in that test file (mirror how other tests build the fixture).

- [ ] **Step 2: Run it and confirm it fails**

Run: `cd apps/frontend && npx jest src/lib/nav-resolver.test.ts`
Expected: FAIL (`/sales/new` present).

- [ ] **Step 3: Remove the layout node**

In `packages/shared-types/navigation.ts`, delete the line:

```typescript
  layoutNode('sales.new', 'sales', 5),
```

Leave `sales.pos` at sortOrder 4 and the following nodes as-is (gap in ordering is harmless). Keep the `sales.new` registry entry (line ~62).

- [ ] **Step 4: Rebuild shared-types if the app consumes `dist`**

Run: `cd packages/shared-types && npm run build` (only if a `dist/` is committed/consumed; skip if the app imports the `.ts` source directly).

- [ ] **Step 5: Run the test to confirm pass**

Run: `cd apps/frontend && npx jest src/lib/nav-resolver.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/shared-types/navigation.ts packages/shared-types/dist 2>/dev/null; git add packages/shared-types/navigation.ts
git commit -m "feat(nav): remove New Sales Entry from sidebar default layout"
```

### Task 7: Replace POS with "New Sales Entry" on the Sales list header and hub tile

**Files:**
- Modify: `apps/frontend/src/app/(app)/sales/list/page.tsx` (~232-240)
- Modify: `apps/frontend/src/app/(app)/sales/page.tsx` (tile ~39; posEnabled filter ~113-120; linkCopy ~106-109)
- Test: `apps/frontend/src/app/(app)/sales/list/page.test.tsx`

**Interfaces:**
- Consumes: `routes.sales.new`, `t.sidebar.items.newSalesEntry`.
- Produces: both surfaces link to `/sales/new`; neither references `/sales/pos`.

- [ ] **Step 1: Write the failing test for the list header**

In `sales/list/page.test.tsx`, add (mirroring existing render setup):

```typescript
it('shows a New Sales Entry action linking to /sales/new (not POS)', async () => {
  renderPage(); // however the file renders it
  const link = await screen.findByRole('link', { name: /new sales entry/i });
  expect(link).toHaveAttribute('href', '/sales/new');
  expect(screen.queryByRole('link', { name: /^POS$/i })).toBeNull();
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `cd apps/frontend && npx jest "src/app/(app)/sales/list/page.test.tsx"`
Expected: FAIL.

- [ ] **Step 3: Update the list header button**

In `sales/list/page.tsx` (~232-240), change the POS `Link` to New Sales Entry and drop the `posEnabled` guard so it always renders. Use the `FileText` icon (add to the `lucide-react` import if needed):

```tsx
<Link
    href={routes.sales.new}
    className="/* keep the existing button classes */"
>
    <FileText className="w-4 h-4" />
    {t.sidebar.items.newSalesEntry}
</Link>
```

- [ ] **Step 4: Update the hub tile**

In `sales/page.tsx`, replace the `pos` tile (line ~39) with:

```tsx
{ href: routes.sales.new, key: 'newEntry', icon: FileText, accent: 'bg-blue-50 text-blue-700 border-blue-100' },
```

Import `FileText` from `lucide-react` (already imported — reuse). Remove the `posEnabled` filtering branch (lines ~113-120) and the now-unused `posEnabled` state / `isPosEnabled` import / `getSalesSettings` call if nothing else uses them. Add hub copy for `newEntry` to `linkCopy` (fall back to the sidebar label):

```tsx
    const linkCopy = useMemo(() => ({
        ...hub.links,
        overview: { title: t.sidebar.items.overview, description: hub.subtitle },
        newEntry: { title: t.sidebar.items.newSalesEntry, description: hub.links.newEntry?.description ?? 'Create a new sale' },
    }), [hub.links, hub.subtitle, t.sidebar.items.overview, t.sidebar.items.newSalesEntry]);
```

- [ ] **Step 5: Run the test to confirm pass**

Run: `cd apps/frontend && npx jest "src/app/(app)/sales/list/page.test.tsx"`
Expected: PASS.

- [ ] **Step 6: Sanity-check the hub page test still passes**

Run: `cd apps/frontend && npx jest "src/app/(app)/sales/page.test.tsx"`
Expected: PASS (update any POS-tile assertion to `newEntry` if present).

- [ ] **Step 7: Commit**

```bash
git add "apps/frontend/src/app/(app)/sales/list/page.tsx" "apps/frontend/src/app/(app)/sales/page.tsx" "apps/frontend/src/app/(app)/sales/list/page.test.tsx"
git commit -m "feat(sales): replace POS with New Sales Entry on list header and hub tile"
```

---

## Phase 5 — Frontend: payment methods settings

### Task 8: Add "Show on Entry UI" toggle and "Serial" field to the settings form

**Files:**
- Modify: `apps/frontend/src/app/(app)/settings/payment-methods/page.tsx` (`PaymentMethod` interface, `MethodForm` ~50-142, list ~266-289)
- Test: `apps/frontend/src/app/(app)/settings/payment-methods/page.test.tsx` (create if absent)

**Interfaces:**
- Consumes: `api.createPaymentMethod`/`updatePaymentMethod` (accept `show_on_entry`, `sort_order`).
- Produces: form round-trips `show_on_entry` and `sort_order` (Serial); list sorted by Serial.

- [ ] **Step 1: Extend the local `PaymentMethod` type and form state**

In `page.tsx`, add `show_on_entry: boolean;` and `sort_order: number;` to the `PaymentMethod` interface. In `MethodForm`, add state:

```tsx
    const [showOnEntry, setShowOnEntry] = useState(initial?.show_on_entry ?? true);
    const [serial, setSerial] = useState<number>(initial?.sort_order ?? 0);
```

- [ ] **Step 2: Include the fields in the save payload**

In `MethodForm`'s `handleSubmit` `onSave({...})`, add:

```tsx
                show_on_entry: showOnEntry,
                sort_order: Number(serial) || 0,
```

- [ ] **Step 3: Render the Serial input and the Show-on-Entry toggle**

Add a Serial field inside the grid (after Type):

```tsx
                <Field label="Serial">
                    <Input
                        type="number"
                        min={0}
                        value={serial}
                        onChange={(e) => setSerial(parseInt(e.target.value, 10) || 0)}
                        placeholder="e.g. 1"
                    />
                </Field>
```

Add a "Show on Entry UI" toggle mirroring the existing Active toggle (same markup, `showOnEntry`/`setShowOnEntry`, label "Show on Entry UI").

- [ ] **Step 4: Sort the list by Serial**

Where `methods` is rendered (map at ~268), sort first:

```tsx
{[...methods].sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name)).map((method) => (
```

- [ ] **Step 5: Write the test**

In `page.test.tsx`, mock `api.createPaymentMethod`, open the create form, toggle "Show on Entry UI" off, set Serial to 3, submit, and assert the payload:

```tsx
expect(api.createPaymentMethod).toHaveBeenCalledWith(
  expect.objectContaining({ show_on_entry: false, sort_order: 3 }),
);
```

- [ ] **Step 6: Run the test**

Run: `cd apps/frontend && npx jest "src/app/(app)/settings/payment-methods/page.test.tsx"`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add "apps/frontend/src/app/(app)/settings/payment-methods"
git commit -m "feat(settings): payment method Show on Entry toggle and Serial ordering"
```

---

## Phase 6 — Frontend: sales-entry payment picker + editable date

### Task 9: Curate PaymentSection to `show_on_entry` methods with an "Add method" picker

**Files:**
- Modify: `apps/frontend/src/app/(app)/sales/new/components/PaymentSection.tsx`
- Test: `apps/frontend/src/app/(app)/sales/new/components/PaymentSection.test.tsx`

**Interfaces:**
- Consumes: `api.getPaymentMethods()` returning items with `is_active`, `sort_order`, `show_on_entry`.
- Produces: default rows = `show_on_entry && is_active` sorted by `sort_order`; "Add method" dropdown appends hidden active methods; generic fallback only when zero methods defined.

- [ ] **Step 1: Extend `DefinedMethod` and `toPick`**

Add `show_on_entry: boolean;` to the `DefinedMethod` interface. Keep `sort_order`.

- [ ] **Step 2: Replace visibility logic**

Replace the `activeMethods`/`inactiveMethods`/`visibleMethods`/`otherMethods` block (~92-112) with:

```tsx
    const [added, setAdded] = useState<string[]>([]); // ids explicitly added via picker

    const activeSorted = useMemo(
        () => definedMethods
            .filter((m) => m.is_active)
            .slice()
            .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
            .map(toPick),
        [definedMethods],
    );
    const defaultVisible = useMemo(
        () => definedMethods
            .filter((m) => m.is_active && m.show_on_entry)
            .slice()
            .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
            .map(toPick),
        [definedMethods],
    );
    const hasDefined = definedMethods.length > 0;
    const visibleMethods = useMemo(() => {
        if (!hasDefined) return genericPicks; // fresh tenant fallback
        const base = defaultVisible;
        const extra = activeSorted.filter((m) => added.includes(m.key) && !base.some((b) => b.key === m.key));
        return [...base, ...extra];
    }, [hasDefined, defaultVisible, activeSorted, added]);
    const addableMethods = useMemo(
        () => activeSorted.filter((m) => !visibleMethods.some((v) => v.key === m.key)),
        [activeSorted, visibleMethods],
    );
    const allMethods = useMemo(() => (hasDefined ? activeSorted : genericPicks), [hasDefined, activeSorted]);
```

- [ ] **Step 3: Replace the "Other methods" collapsible with an "Add method" dropdown**

Replace the `otherMethods` JSX block (~190-206) with a dropdown that appends the chosen method id to `added`:

```tsx
            {addableMethods.length > 0 && (
                <div>
                    <select
                        aria-label="Add payment method"
                        value=""
                        onChange={(e) => { if (e.target.value) setAdded((a) => [...a, e.target.value]); }}
                        className="w-full px-2 py-1.5 border rounded text-sm text-gray-600"
                    >
                        <option value="">+ Add method…</option>
                        {addableMethods.map((m) => (
                            <option key={m.key} value={m.key}>{m.name}</option>
                        ))}
                    </select>
                </div>
            )}
```

Delete the now-unused `showOther` state, the `inactiveMethods`/`otherMethods` memos, and the `ChevronDown` import if unused.

- [ ] **Step 4: Update the failing test**

In `PaymentSection.test.tsx`, set the `getPaymentMethods` mock to return methods with mixed `show_on_entry`, and assert only `show_on_entry` ones render by default and an "Add method" pick reveals a hidden active one:

```tsx
getPaymentMethods: jest.fn().mockResolvedValue([
  { id: '1', name: 'Cash', type: 'Cash', is_active: true, show_on_entry: true, sort_order: 1 },
  { id: '2', name: 'bKash', type: 'Mobile Wallet', is_active: true, show_on_entry: false, sort_order: 2 },
]),
// after render: 'Cash' amount input present, 'bKash' absent until picked from the "Add payment method" select
```

- [ ] **Step 5: Run tests**

Run: `cd apps/frontend && npx jest "src/app/(app)/sales/new/components/PaymentSection.test.tsx"`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add "apps/frontend/src/app/(app)/sales/new/components/PaymentSection.tsx" "apps/frontend/src/app/(app)/sales/new/components/PaymentSection.test.tsx"
git commit -m "feat(sales): curate entry payment methods with Add method picker"
```

### Task 10: Editable date/time on the New Sale page

**Files:**
- Modify: `apps/frontend/src/app/(app)/sales/new/components/SalesHeader.tsx`
- Modify: `apps/frontend/src/app/(app)/sales/new/page.tsx` (state + `saleData`)
- Test: `apps/frontend/src/app/(app)/sales/new/page.test.tsx` (create if absent) or a `SalesHeader.test.tsx`

**Interfaces:**
- Consumes: none new.
- Produces: `SalesHeader` exposes an editable local `datetime-local` value via `saleDate`/`setSaleDate` props; `page.tsx` sends `saleDate` (ISO) in `createNewSale`.

- [ ] **Step 1: Make the date editable in SalesHeader**

Change `SalesHeaderProps` to add `saleDate: string; setSaleDate: (v: string) => void;` (value is a `datetime-local` string, `yyyy-MM-ddTHH:mm`). Replace the read-only Date `<span>` (lines ~47-50) with:

```tsx
            <label className="flex items-center gap-1">
                <span className="font-semibold uppercase tracking-wide text-[10px] text-gray-400">Date</span>
                <input
                    type="datetime-local"
                    value={saleDate}
                    onChange={(e) => setSaleDate(e.target.value)}
                    className="px-1.5 py-0.5 border rounded text-xs focus:ring-1 focus:ring-blue-500 focus:border-transparent"
                />
            </label>
```

Keep the `formatNow` helper (reused to seed the default value in the page). Remove the internal `now` state if it is no longer used here.

- [ ] **Step 2: Hold the date in the page and pass it down**

In `page.tsx`, add state seeded to now (local):

```tsx
    const [saleDate, setSaleDate] = useState<string>(() => {
        const d = new Date();
        const pad = (n: number) => String(n).padStart(2, '0');
        return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
    });
```

Pass `saleDate={saleDate} setSaleDate={setSaleDate}` to `<SalesHeader />`.

- [ ] **Step 3: Send `saleDate` in the create payload**

In `handleSubmit`'s `saleData`, add (convert local `datetime-local` to ISO):

```tsx
                saleDate: saleDate ? new Date(saleDate).toISOString() : undefined,
```

Also use `saleDate` for the printed receipt date instead of `new Date()` (line ~111): `date: new Date(saleDate).toLocaleDateString('en-BD')`.

- [ ] **Step 4: Write/adjust the test**

Add a test that changing the date input and submitting calls `api.createNewSale` with a matching `saleDate`:

```tsx
expect(api.createNewSale).toHaveBeenCalledWith(
  expect.objectContaining({ saleDate: expect.stringContaining('2026-01-15') }),
);
```

- [ ] **Step 5: Run tests**

Run: `cd apps/frontend && npx jest "src/app/(app)/sales/new"`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add "apps/frontend/src/app/(app)/sales/new"
git commit -m "feat(sales): editable sale date/time on New Sale page"
```

### Task 11: Editable date + curated payment picker on the Edit page

**Files:**
- Modify: `apps/frontend/src/app/(app)/sales/[id]/page.tsx` (edit state ~44-90; payment editor; save payload)
- Test: `apps/frontend/src/app/(app)/sales/[id]/page.test.tsx`

**Interfaces:**
- Consumes: `sale.sale_date` from `api.getSale`; `api.updateSale`.
- Produces: edit mode shows/edits `sale_date` and includes `saleDate` in the update payload; payment editor honors `show_on_entry` default + add-method (reuse the Task 9 approach).

- [ ] **Step 1: Add editable date state in edit mode**

Add `const [editSaleDate, setEditSaleDate] = useState('');` and, in the populate-from-sale effect (~72-90), seed it from `sale.sale_date` formatted as `datetime-local` (reuse the same pad helper as Task 10 — extract it to `@/lib/format` as `toDatetimeLocal(date)` and import it in both pages to stay DRY).

- [ ] **Step 2: Extract `toDatetimeLocal` helper (DRY)**

In `apps/frontend/src/lib/format.ts`, add and export:

```typescript
export function toDatetimeLocal(date: Date): string {
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
```

Use it in Task 10's `page.tsx` seed and `SalesHeader`, and here.

- [ ] **Step 3: Render the date input in edit mode**

Near the other edit fields, add a `datetime-local` input bound to `editSaleDate`/`setEditSaleDate` with a "Date" label, matching the page's existing edit-field styling.

- [ ] **Step 4: Include `saleDate` in the update payload**

Where `api.updateSale(id, {...})` is called on save, add:

```tsx
        saleDate: editSaleDate ? new Date(editSaleDate).toISOString() : undefined,
```

- [ ] **Step 5: Apply the curated payment picker**

If the edit payment editor lists methods, apply the same `show_on_entry`-default + "Add method" behavior as Task 9 (or, if the editor is a distinct simpler UI, at minimum sort by `sort_order` and default to `show_on_entry` methods). Keep the existing accounting/`accountId` wiring intact.

- [ ] **Step 6: Write the test**

In `[id]/page.test.tsx`, enter edit mode (`?edit=true`), change the date input, save, and assert `api.updateSale` was called with a matching `saleDate`.

- [ ] **Step 7: Run tests**

Run: `cd apps/frontend && npx jest "src/app/(app)/sales/[id]/page.test.tsx"`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add "apps/frontend/src/app/(app)/sales/[id]" apps/frontend/src/lib/format.ts
git commit -m "feat(sales): editable sale date and curated payments on edit page"
```

---

## Phase 7 — Verification

### Task 12: Full typecheck, test sweep, and TODO update

- [ ] **Step 1: Backend typecheck + tests**

Run: `cd apps/backend && npx tsc --noEmit && npx jest src/sales src/sales-reports src/payment-methods src/customers src/expenses src/notifications`
Expected: PASS.

- [ ] **Step 2: Frontend typecheck + affected tests**

Run: `cd apps/frontend && npx tsc --noEmit && npx jest "src/app/(app)/sales" "src/app/(app)/settings/payment-methods" src/lib/nav-resolver.test.ts`
Expected: PASS.

- [ ] **Step 3: Drive the flow (verify skill)**

Use the `verify` skill (or `run`) to exercise: create a sale with a back-dated date + a picked non-default payment method; confirm it appears in a sales report window matching the chosen date, not today. Confirm the sidebar no longer shows "New Sales Entry" and the Sales page button/tile open `/sales/new`.

- [ ] **Step 4: Update TODO.md**

Move completed items to `## COMPLETED` with today's date per `CLAUDE.md`.

- [ ] **Step 5: Commit**

```bash
git add TODO.md
git commit -m "docs: log sales entry rework completion"
```

---

## Self-Review Notes

- **Spec coverage:** Part 1 → Task 6; Part 2 → Task 7; Part 3 → Tasks 1, 3, 8; Part 4 → Tasks 9, 11; Part 5 → Tasks 1, 2, 4, 5, 10, 11. All spec sections map to tasks.
- **`sale_date` consumers:** every site in the spec's inventory is covered (Task 4 = sales-reports incl. the buildDateWindow split; Task 5 = customers/segments/expenses/notifications). Sales list ordering and returns intentionally excluded per spec.
- **Type consistency:** `saleDate` (DTO/payload, camelCase) ↔ `sale_date` (DB, snake_case); `show_on_entry` used consistently across DTO, service, settings form, and PaymentSection; `toDatetimeLocal` shared helper defined once in `lib/format.ts`.
