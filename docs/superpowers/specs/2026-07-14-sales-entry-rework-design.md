# Sales Entry Rework — Design

**Date:** 2026-07-14
**Status:** Approved (design)

## Goal

Reshape how a sale is created and dated:

1. Remove the **"New Sales Entry"** submenu from the Sales sidebar menu.
2. On the Sales page, drop the **POS** button and surface **"New Sales Entry"** (linking the new-sales UI, not POS) instead.
3. On the New Sales Entry / Edit page:
   - allow changing the sale **date/time**, persisted separately from `created_at`;
   - drive payment options from the **payment-methods list**, showing only methods flagged for the entry UI and letting the user add more on demand.

## Non-goals

- POS is not removed; it stays reachable from the sidebar when `posEnabled`.
- Sales **returns** are not given an editable date (scope is sales entry only).
- The sales **list ordering** stays keyed off `created_at`/`id` for cursor-pagination stability. Only reports/aggregations move to `sale_date`.

---

## Part 1 — Sidebar: remove "New Sales Entry" submenu

- `packages/shared-types/navigation.ts` — remove `layoutNode('sales.new', 'sales', 5)` from `DEFAULT_NAV_LAYOUT` (line ~246). Re-number/leave sibling sort orders as-is (gaps are fine).
- **Keep** the `sales.new` registry entry (line ~62) — the `/sales/new` route is still used by the new buttons (Part 2) and voice-nav.
- Rebuild `packages/shared-types` dist if the app consumes the compiled `dist/navigation.js`.

## Part 2 — Sales page: POS → New Sales Entry (both surfaces)

Both current POS surfaces are replaced by a "New Sales Entry" affordance pointing at `routes.sales.new` (`/sales/new`):

- **Sales list header** — `apps/frontend/src/app/(app)/sales/list/page.tsx:232-240`: change the `Link` `href` from `routes.sales.pos` to `routes.sales.new`, label to `t.sidebar.items.newSalesEntry`, icon to `FileText` (or `Plus`), and remove the `posEnabled` conditional so the button always renders.
- **Sales hub tile** — `apps/frontend/src/app/(app)/sales/page.tsx:39`: replace the `{ key: 'pos', href: routes.sales.pos, ... }` tile with a `newEntry` tile (`href: routes.sales.new`, icon `FileText`). Remove the `pos`-filtering `posEnabled` branch (lines ~113-120) since the tile no longer references POS. Add `newEntry` copy to `linkCopy`.
- Copy: reuse `sidebar.items.newSalesEntry` ("New Sales Entry", `en/core.ts:258`) plus bn/ms equivalents; add a hub-link description string if the hub tile needs one.

## Part 3 — Payment methods: "Show on Entry UI" + Serial

- **Prisma** (`packages/database/prisma/schema.prisma`, model `PaymentMethod`): add
  `show_on_entry Boolean @default(true)`. Migration backfills existing rows to `true`
  (default covers it) so nothing vanishes from current entry screens. "Serial" reuses the
  existing `sort_order Int @default(0)` field.
- **Backend DTOs** (`apps/backend/src/payment-methods/payment-methods.dto.ts`): add
  `@IsOptional() @IsBoolean() show_on_entry?: boolean` to `CreatePaymentMethodDto` and
  `UpdatePaymentMethodDto`; add `show_on_entry: boolean` to `PaymentMethodResponseDto`.
  Service create/update pass the field through.
- **Settings form** (`apps/frontend/src/app/(app)/settings/payment-methods/page.tsx`):
  - Add a **"Show on Entry UI"** toggle (bound to `show_on_entry`).
  - Add a **"Serial"** number input (bound to `sort_order`).
  - Sort the methods list by `sort_order` ascending, then name.

## Part 4 — Sales-entry payment picker (New + Edit)

Target: `apps/frontend/src/app/(app)/sales/new/components/PaymentSection.tsx` and the
separate payment editor on `apps/frontend/src/app/(app)/sales/[id]/page.tsx` (edit mode).

- Extend the fetched `DefinedMethod` shape with `show_on_entry`.
- **Default-visible** rows = methods where `show_on_entry && is_active`, sorted by `sort_order`.
- Replace the current "Other methods" collapsible with an **"Add method"** dropdown:
  - lists active methods **not already shown** (hide already-added);
  - selecting one appends a payment row;
  - added rows can be removed (return to the dropdown).
- **Fallback:** when the tenant has **zero** defined payment methods, keep the current
  generic Cash/Wallet/Card/Bank list so a fresh tenant can still take payment.
- Preserve the existing accounting canonicalization (`TYPE_TO_CANONICAL` / `canonicalFor`)
  and `accountId` wiring — the submitted `method` string must stay canonical.

## Part 5 — Editable, persisted sale date

### Data model
- `packages/database/prisma/schema.prisma`, model `Sale`: add
  `sale_date DateTime @default(now())` and `@@index([tenant_id, sale_date])`.
- Migration backfills `sale_date = created_at` for existing rows.
- `created_at` remains the immutable audit timestamp.

### Backend
- `apps/backend/src/sales/sale.dto.ts`:
  - `CreateSaleDto`: add `@IsOptional() @IsDateString() saleDate?: string`.
  - `UpdateSaleDto`: add `@IsOptional() @IsDateString() saleDate?: string`.
- `apps/backend/src/sales/sales.service.ts`:
  - create: set `sale_date: dto.saleDate ? new Date(dto.saleDate) : new Date()`.
  - update: set `sale_date` when `dto.saleDate` provided.

### Reports switch to `sale_date`
Switch every **Sale** date filter / grouping / reporting order from `created_at` to
`sale_date` (inventory below). `created_at` stays only where it is a true audit timestamp.

- `apps/backend/src/sales-reports/sales-reports.service.ts`
  - `buildDateWindow()` (~600-614) is the dominant helper, spread into ~15 report sites
    (lines 10, 111, 199, 256, 364, 423, 541) **and** into `salesReturn` queries (25-31, 437-440).
    **Split it**: a Sale window on `sale_date` and a Return window on `created_at` (or make the
    field a parameter) so returns keep `created_at`.
  - Daily/monthly buckets keyed off `sale.created_at` (58, 73, 495, 567) → `sale.sale_date`;
    `select`/`orderBy created_at` for Sale (22-23, 38, 436, 554, 557) → `sale_date`.
- `apps/backend/src/customers/customers.service.ts`
  - `getSales` (238-247): date range + `orderBy` → `sale_date`.
  - `getAnalytics` (339-357): last-purchase `findFirst orderBy/select` → `sale_date`.
- `apps/backend/src/customers/segments.service.ts`
  - `sale.groupBy _max: { created_at }` (60-66) → `_max: { sale_date }`.
- `apps/backend/src/expenses/expenses.service.ts`
  - `buildSaleDateWhere()` (286-303) → `sale_date`; `getSummary` aggregate (200-203) inherits it.
- `apps/backend/src/notifications/notifications.service.ts`
  - `generateSalesReport` (390-395) date range + buckets (447, 458) → `sale_date`.
    (Line 429 `customer.count` is not a Sale — leave.)

### Explicitly unchanged
- `sales/sales.service.ts:410-420` `findAll` — keep `orderBy created_at desc` and id-cursor
  pagination (working list, not a report; avoids destabilizing the cursor).
- `sales/sales.service.ts:734-741` invoice-number generation — already not date-filtered.
- Customer credit ledger / due-aging (`customers.service.ts` getCreditLedger, listCreditPayments,
  getDueAgingReport) — these read `customerCreditTransaction.created_at`, not Sale; leave.

### Frontend
- New sale (`sales/new`): make the date read-only display in
  `components/SalesHeader.tsx` an editable date-time input (default = now); thread the value
  into `page.tsx` `saleData.saleDate`.
- Edit (`sales/[id]?edit=true`): show/edit `sale.sale_date`; include `saleDate` in the
  `updateSale` payload.

---

## Testing

- **Nav:** unit assertion that `sales.new` is absent from the default layout / rendered sidebar
  children; voice-nav for `/sales/new` still resolves.
- **Sales page:** list header + hub tile link to `/sales/new`, not `/sales/pos`.
- **Payment methods:** DTO/service accept `show_on_entry`; settings form round-trips the toggle
  and Serial; list sorts by Serial.
- **PaymentSection:** only `show_on_entry && is_active` methods show by default (sorted);
  "Add method" adds a hidden active method and removes it from the dropdown; zero-methods tenant
  falls back to generics; canonical method/accountId preserved on submit.
- **Sale date:** create with explicit `saleDate` persists `sale_date` and leaves `created_at`
  as insert time; update changes `sale_date` only; omitted `saleDate` defaults to now.
- **Reports:** a sale whose `sale_date` and `created_at` fall in different report windows lands
  in the `sale_date` window for summary/by-product/by-customer/branch/monthly, expenses summary,
  segment last-purchase, and the scheduled notification report; a **return** in that same split
  still keys off `created_at`.

## Rollout / phasing

Implementable and committable in phases:
1. Prisma migration (`sale_date`, `show_on_entry`) + regenerate client.
2. Backend: sale DTO/service `saleDate`; payment-method DTO/service `show_on_entry`.
3. Backend reports migration to `sale_date` (+ split `buildDateWindow`).
4. Frontend: nav removal, Sales page buttons, settings form, PaymentSection, sale-date inputs.

Migration + client regen land first so backend/report changes compile against the new fields.
