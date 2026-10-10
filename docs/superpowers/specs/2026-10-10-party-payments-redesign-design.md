# Customer & supplier payments redesign — design

Status: **approved 2026-10-10** (mockups in `.superpowers/brainstorm/18309-1791604256/content/`,
screens `01-page-direction.html` and `02-entry-panel.html`).

Asked as "enhance the UI design of customer payment, supplier payment
significantly". Scope chosen: frontend redesign **plus** a payment method on
both kinds of payment, which needs a backend change. This carves the
"customer and supplier payments" slice out of Phase 4 of
`docs/dynamic-payment-methods-plan.md`; Phases 1–3 of that plan are not needed
for it and stay open.

## 1. What is wrong today

- `/sales/customer-payments` (974 lines) and `/purchases/supplier-payments`
  (1,082 lines) are ~95% copies; every fix lands twice.
- They break the UI rules: purple/orange/teal accents, `uppercase
  tracking-widest` labels, raw `rounded-xl` inputs, a page-local toast banner,
  `confirm()` for delete.
- The only summary is one green "Net total" that nets money in against money
  out, so a period of refunds reads as income.
- Direction is a `<select>`, though it changes the meaning of every field below.
- The form shows the party's due but never what it will be after this payment.
- Five coloured icon buttons on every row; no row click.
- Supplier bill allocation is a cramped list of 96px inputs below the notes,
  with no oldest-first fill.
- No payment method: every payment posts to Cash in Hand.

## 2. The page (both parties, same layout)

```
PageShell
  PageHeader  title · subtitle · breadcrumbs · [Print list] [+ Receive payment]
  KPI strip   Received | Paid out | Discount | Net      (4 tiles, one row)
              └ by-method bar + legend under the primary tile
  ┌ DataTable ───────────────────────────────┐ ┌ Panel (docked ≥1280px) ┐
  │ toolbar: date range · In/Out · method ·  │ │ create / view / edit / │
  │          party · search                  │ │ allocate               │
  │ Serial Date Party Method Amount DueAfter │ │                        │
  │ By [⎙]                                   │ │                        │
  └──────────────────────────────────────────┘ └────────────────────────┘
```

Labels per party:

| | Customer | Supplier |
|---|---|---|
| Primary direction | receive (money in) | pay (money out) |
| Primary action | + Receive payment | + Pay supplier |
| KPI tiles | Received · Paid out (refunds) · Discount allowed · Net collected (in − out) | Paid · Refunds received · Discount received · Net paid (out − in) |
| Discount | on receive only | on pay only |
| Bills | — | on pay only |

The API's `direction` is already money-flow for both: `receive` = money in,
`pay` = money out (customer receive → `PAYMENT`, supplier receive → `PAYOUT`).
The redesign keeps that and derives everything else from it.

### 2.1 KPI strip

Computed client-side from the loaded rows (the list already fetches every page
in the range via `fetchAllPages`).

- In, Out, Discount (sum of `discount_amount` on primary-direction rows), Net.
- Counts under each tile.
- Under the primary tile: a stacked bar by method name (from
  `payment_method_name`; null → "Not recorded"), legend with compact amounts.
  Colours come from a fixed categorical list in the component, not per-method
  brand colours (UI rule: one accent).

### 2.2 Table

- Columns: Serial (mono) · Date (`createdAtColumn`) · Party (name + phone) ·
  Method (neutral `StatusBadge`-style pill; "—" when null) · Amount (in = `+`
  emerald, out = `−` red, discount as a sub-line) · Due after (`hideOnMobile`)
  · By (`hideOnMobile`) · Print icon.
- Due after and By are dropped while the panel is docked.
- Notes leave the table (search still matches them; the details view shows them).
- Row click opens the details view; the selected row is highlighted.
- Toolbar (server filters): `CreatedRangeFilter`, In/Out/All segmented control,
  method select, party `IdSearchSelect`. DataTable's own search stays.

### 2.3 The panel

One component, four modes:

| Mode | Opened by | Content |
|---|---|---|
| `create` | header button, `?new=1`, Duplicate | entry form |
| `view` | row click | details |
| `edit` | Edit in details | entry form, party fixed |
| `allocate` | "Allocate advance" in supplier details | bill allocation for the unapplied amount |

Placement: docked beside the table at `min-width: 1280px`
(`useMediaQuery`); below that it is `ModalShell variant="drawer"`, which is
already a bottom sheet below `sm`. Close (✕ / Escape in drawer) returns the
table to full width.

**Entry form**, top to bottom:

1. Direction: full-width segmented control (`↓ Receive` / `↑ Pay out (refund)`;
   supplier `↑ Pay` / `↓ Refund received`).
2. Serial · date as one line (`CPY-000248 · Now · Change`). *Change* (or any
   serial/date error) expands the existing `PaymentSerialDateFields`.
3. Duplicate notice (`Alert`, info) when opened as a copy.
4. Party: `IdSearchSelect`; once chosen, a card with name, phone/code, a
   *Ledger ↗* link, and **due now → due after** with a progress bar of how much
   this payment clears. Advance balances read as "Advance".
5. Amount: large input; *Full due ৳X* quick-fill when there is a due in the
   payment's favour.
6. Method chips (§3). Under them: "Posts to **Account · code**", or an amber
   note when the method has no linked account ("posts to Cash in Hand").
7. Discount (primary direction only): existing `PaymentDiscountField`.
8. Supplier pay only: **Settle bills** — open bills oldest first, each with a
   checkbox and an amount; typing the amount auto-fills oldest first until the
   operator edits an allocation by hand (then auto-fill stops). Footer line:
   "All ৳X goes to bills" / "৳X stays as advance" / over-allocation error.
9. Note (textarea, 2 rows).
10. Footer: `Save` (secondary) · `Save & print` (primary). Edit: `Cancel` ·
    `Duplicate` · `Save changes`.

After a create the panel stays open, resets, and refocuses the party field; the
new row is highlighted green for a few seconds. Confirmation goes through the
global toast with a *Print receipt* action.

**Details**: header serial + direction badge; big signed amount, method badge,
date and recorded-by; party card with due before → after (`balance_after` and
`balance_after ± settled`); key/values for discount, voucher (link to
`/accounting/vouchers/<id>` when `voucher_id`), discount voucher, unapplied
amount (supplier), note. Footer: **Print receipt** (primary, full width) ·
Edit · Duplicate · Delete (danger, via `ConfirmDialog`) · *Allocate advance*
(supplier, when `unapplied_amount > 0`).

### 2.4 UI-rule fixes that come with it

- Global `toast` only (extended with an optional action button).
- `ConfirmDialog` instead of `globalThis.confirm`.
- Shared `Button`/`Field`/`Input`/`Select`/`Textarea`/`Alert`; `blue-600`
  (`primary`) is the only accent; emerald/amber/red only as semantic colours.
- Header icon tint removed; no `uppercase tracking-widest`.

## 3. Payment method

### 3.1 Backend

- **Schema** (`CustomerCreditTransaction`, `SupplierCreditTransaction`), additive:
  ```prisma
  payment_method_id   String?  // FK → PaymentMethod, onDelete: SetNull
  payment_method_name String?  // name at save time, for receipts and history
  ```
  plus the back-relations on `PaymentMethod` and a migration. Additive, so the
  production `db push --accept-data-loss` drops nothing.
- **DTOs**: `paymentMethodId?: string` (`@IsOptional() @IsUUID()`) on the record
  and update DTOs of both parties. Ships with the client in the same branch
  (`forbidNonWhitelisted`).
- **Resolution**: a shared helper loads the method tenant-scoped; unknown,
  foreign or inactive → `400`. Its `name` is snapshotted; its `account_id`, when
  set, becomes the cash leg's override:

  | Payment | Rule legs | Override |
  |---|---|---|
  | customer receive | Dr Cash / Cr Receivable | `overrideDebitAccountId` |
  | customer pay (refund) | Dr Receivable / Cr Cash | `overrideCreditAccountId` |
  | supplier pay | Dr Payable / Cr Cash | `overrideCreditAccountId` |
  | supplier receive (refund) | Dr Cash / Cr Payable | `overrideDebitAccountId` |

  The discount leg is untouched. Without an id nothing changes (customer detail
  page, imports, legacy callers).
- **Update**: an omitted `paymentMethodId` keeps the stored method; the existing
  void-and-repost then re-resolves its *current* account link. A new id
  replaces method and name and reposts to its account.
- **`GET /payment-methods`** gains `account: { id, code, name } | null` per row
  (additive) for the "Posts to" line.
- Rows returned by list/get/record/update carry the two new columns as-is.

### 3.2 Frontend

- `usePaymentMethods()` loads `GET /payment-methods` once per mount.
- Chips: active methods with `show_on_entry`, in `sort_order`; the remaining
  active ones under **+ More** (a small menu). The first chip is preselected on
  create; edit preselects the stored method (or none for legacy rows).
- No methods at all → no chip row; the payment posts as today.
- Receipts (`customer-payment-receipt.ts`, `supplier-payment-receipt.ts`) print
  a Method line when the payment has one.

## 4. Code structure

New module `apps/frontend/src/components/payments/party-payments/`:

| File | Job |
|---|---|
| `types.ts` | `PartyPayment`, `PartyOption`, `OpenBill`, `PartyPaymentsAdapter` |
| `customer-adapter.ts`, `supplier-adapter.ts` | copy, API calls, print, party fields, breadcrumbs |
| `PartyPaymentsWorkspace.tsx` | page body: data loading, filters, table, panel state |
| `payment-kpis.ts` + `PaymentKpiStrip.tsx` | pure totals + tiles |
| `PaymentFilters.tsx` | toolbar |
| `PaymentPanel.tsx` | docked vs drawer host |
| `PaymentEntryForm.tsx` | create/edit form and its validation |
| `PaymentDetails.tsx` | view mode |
| `PaymentMethodChips.tsx`, `usePaymentMethods.ts` | method picker |
| `DueFlowCard.tsx` | due now → after |
| `bill-allocation.ts` + `BillAllocationField.tsx` | oldest-first fill + list |
| `AllocateAdvance.tsx` | supplier `allocate` mode |

Shared-primitive extensions: `DataTable` gets `onRowClick` and
`highlightedRowId`; `lib/toast.ts` + `Toaster` get an optional
`action: { label, onClick }`.

Each page becomes ~40 lines: `PageShell` + `PartyPaymentsWorkspace adapter=…`.
i18n: new keys go under `customerPayments` / `supplierPayments` in every
locale file, following how those files are already typed.

## 5. Testing

- Backend unit: account override per direction (4), name snapshot, foreign /
  inactive method → 400, no method → unchanged, update with a new method
  reposts to its account, update without one keeps the stored method;
  `GET /payment-methods` returns the account.
- Frontend unit: `payment-kpis`, `bill-allocation`, `PaymentMethodChips`,
  `PaymentEntryForm` (direction toggle, due flow, discount, method sent,
  serial errors), `PaymentDetails`, both pages' existing suites rewritten
  against the workspace, `DataTable` row click, toast action.
- `tsc` both apps, `next lint --quiet`.
- No local browser check: local login 500s against the drifted dev DB.

## 6. Out of scope

Per-side visibility and creating a method mid-entry (Phases 1 and 3 of the
payment-methods plan); the customer detail page's payment form; server
pagination for these lists (TODO already tracks it).
