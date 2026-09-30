# Daily Report — print-ready and WhatsApp-friendly

**Date:** 2026-10-01
**Status:** Draft pending review
**Asked as:** a Daily Report that summarises what happened in a small shop
through one whole day; then “keep both options: print-ready, whatsapp-friendly”;
then tap-to-share in v1 with scheduled nightly send later.

---

## Problem

A shop owner closing for the night (or checking from a phone) has to open
Sales Summary, Cashier Sessions, purchases, expenses, dues, and low-stock
separately. The live dashboard answers “how are we doing right now” across a
chosen range. A cashier session answers “what should this till hold.” Nothing
answers “what happened today in this shop” as one snapshot they can file on
A4 and paste into WhatsApp.

## Goals

- One **calendar-day snapshot** for one branch that an owner can read in about
  two minutes.
- **Print** on tenant letterhead through the existing `openPrintWindow` path
  (Bangla fonts in a real browser window).
- **WhatsApp** as a short, tap-to-share message from the same numbers. The
  owner picks the chat (themselves, a partner, a group).
- Numbers on the page, the printout, and the WhatsApp text come from **one
  payload**. The chat cannot drift from the page.

## Non-goals (v1)

- Scheduled / automatic nightly WhatsApp or SMS.
- A “close the day” lock that refuses further postings.
- PDF attached in the chat (the message is the WhatsApp artefact).
- All-branches roll-up or compare-branches (active branch only).
- P&L, balance sheet, hourly sparkline, salesperson league, named overdue
  list, CRM, HR, manufacturing.
- Changing cashier session close, existing module reports, or the live
  dashboard’s job.

Those stay later work. A later scheduled send reuses `whatsappText`; a later
day-close lock reuses `asOf`.

---

## Who it is for

Anyone with `VIEW_FINANCIAL_REPORTS`. OWNER always passes. A cashier closes
their own till on **Sales → Cashier Sessions**. The HTTP gate is
`VIEW_FINANCIAL_REPORTS` only (`SALES_READ` includes `CREATE_SALE` and would
open this page at the till).

---

## Placement

| Surface | Detail |
|---|---|
| Route | `/sales/daily-report` |
| Nav | Registry id `sales.daily-report`, parent `sales`, **outside** `sales.reports` (that subgroup is `advancedOnly`). BASIC shops see it. Same idea as `sales.mushak`. |
| Default layout | `layoutNode('sales.daily-report', 'sales', 10)` and bump `sales.reports` / `sales.setup` one slot. Saved layouts pick it up with `npx tsx prisma/sync-nav-layout.ts --nodes=sales.daily-report`. |
| Permission map | `'sales.daily-report': ['VIEW_FINANCIAL_REPORTS']` (OWNER always passes). |
| Dashboard | **Today’s report** on `RetailDashboard` only, linking to `/sales/daily-report` with today’s local date. Accounting / CRM / Projects landing variants skip the button. |

Plan gate: `@RequiresPlan('BASIC')`, same as sales reports.

---

## Architecture

One new backend module. No new tables.

```
GET /daily-report?date=YYYY-MM-DD&storeId=
        │
        ▼
DailyReportService  (compose existing services, settle independently)
        │
        ├── sale.findMany over the tenant-local day (required: gross, tenders, top products, new dues)
        ├── sale.findMany previous local day (vsPreviousPct; settled)
        ├── sales returns that local day
        ├── cashier-sessions (sessions overlapping the day + getSessionSummary)
        ├── purchase-reports
        ├── expenses.getSummary
        ├── suppliers (payments that day)
        ├── customers (PAYMENT credit transactions that day)
        ├── accounting dashboard overview (AR / AP *position*)
        └── inventory (low stock / zero / shrinkage that day)
        │
        ▼
JSON snapshot including whatsappText
        │
        ├── Screen  /sales/daily-report
        ├── Print   openPrintWindow + PrintDocType.DAILY_REPORT
        └── Share   MessageShareModal → Copy / wa.me/?text=
```

The aggregator calls existing service methods in-process. It does not fan the
browser out to eight report endpoints.

`ShareModal` stays URL-shaped (quotations, products). Daily Report shares a
**message**, so v1 adds a sibling `MessageShareModal`: editable preview,
WhatsApp, Copy. No short link, no revoke. Editing the preview changes only
what goes in the chat.

---

## API

```
GET /daily-report?date=YYYY-MM-DD&storeId=
```

- Auth: JWT + tenant interceptor + `VIEW_FINANCIAL_REPORTS`.
- `date` optional, default today in `tenant.timezone`. Date-only. Parsed as
  local midnight..end via `zonedDayStart` (a 1am Dhaka sale belongs to that
  Dhaka date). `SalesReportsService.getSalesSummary` uses a UTC calendar
  window and is not this source.
- `storeId` optional, default the caller’s active store. A store outside the
  tenant → 404. v1 does not accept “all stores.”
- Future `date` → 400.
- Money fields: number, 2 decimal places.
- Empty optional blocks are JSON `null`. The UI unmounts them.

Sales is required. If the sales query throws, the endpoint returns 502 and
the page shows the error. Purchases, expenses, till, dues, stock, and
supplier/customer receipts each settle independently; a failure becomes
`null` for that block.

### Payload

```ts
type DailyReport = {
  tenantName: string;
  storeName: string;
  date: string;            // YYYY-MM-DD, local
  timezone: string;
  generatedAt: string;     // ISO
  asOf: string;            // ISO; equals generatedAt in v1
  firstSaleAt: string | null;
  lastSaleAt: string | null;

  headlines: {
    netSales: number;
    cashMovement: number;
    newDues: number;
    vsPreviousPct: number | null; // null when previous-day net is 0
  };

  sales: {
    bills: number;
    gross: number;
    returnsAmount: number;
    returnsCount: number;
    net: number;
    avgBill: number;
  };

  tenders: Array<{ method: string; amount: number }>;
  // Payment-method rows first. If gross − sum(those rows) > 0, append
  // { method: 'Credit', amount } so the invariant holds by construction.

  till: {
    sessions: Array<{
      sessionId: string;
      counterName: string;
      cashierName: string;
      status: 'OPEN' | 'CLOSED';
      openingCash: number;
      cashTakings: number;
      refunds: number;
      cashIn: number;
      cashOut: number;
      expectedCash: number;
      closingCash: number | null;
      variance: number | null;
    }>;
    rollup: {
      openingCash: number;
      cashTakings: number;
      refunds: number;
      cashIn: number;
      cashOut: number;
      expectedCash: number;
      closingCash: number | null; // null if any session still OPEN
      variance: number | null;    // null if any session still OPEN
    };
    openSessionCount: number;
    unassignedSalesCount: number;
  } | null;

  moneyOut: {
    purchases: { count: number; net: number } | null;
    paidToSuppliers: number | null;
    expenses: { count: number; amount: number } | null;
  } | null; // null only when every side failed to load

  dues: {
    newDues: number;
    collected: number;
    accountsReceivable: number | null;
    accountsPayable: number | null;
  } | null;

  topProducts: Array<{ name: string; units: number; revenue: number }>; // max 5

  returns: {
    rows: Array<{ label: string; amount: number }>; // max 5
    moreCount: number;
  };

  stock: {
    reorder: Array<{ name: string; onHand: number; level: number }>; // max 5
    reorderCount: number;
    zeroCount: number;
    shrinkageCount: number;
    shrinkageAmount: number;
  } | null;

  checklist: Array<{
    code: 'OPEN_TILL' | 'REORDER' | 'PENDING_DELIVERY';
    count: number;
    href: string;
  }>; // only codes with count > 0; empty array when nothing is outstanding

  whatsappText: string;
};
```

No separate discounts line. Invoice `total_amount` already includes line
discounts; a second figure would disagree with the till.

---

## Sources and rules

Reuse the services that already define these numbers. Do not reimplement
margin or till math.

| Block | Source |
|---|---|
| Sales | `sale.findMany` for `COMPLETED` rows whose `sale_date` is in the tenant-local `[start, end)` window (`zonedDayStart(date)` .. `zonedDayStart(date+1)`). Gross = sum of `total_amount`; net = gross − that day’s return refunds. Do not call `SalesReportsService.getSalesSummary` (its date window is UTC). |
| Tenders | `Sale.payments` on those same rows. **Credit** = `gross − sum(those methods)`, omitted when 0 |
| Top products | line items on those same rows, grouped by product name, sort by revenue, take 5 |
| Returns list | sales returns with local `created_at` on `date`, cap 5 |
| Till sessions | cashier sessions that **overlap** the local day: `opened_at < endOfDay` AND (`closed_at` is null OR `closed_at >= startOfDay`). Each row is `getSessionSummary`. |
| Unassigned sales | completed sales that day with `session_id` null. They count in Sales and Tenders. They do not enter expected cash. |
| Purchases | `PurchaseReportsService.getPurchaseSummary` for the day |
| Expenses | `ExpensesService.getSummary` for the day |
| Paid to suppliers | supplier payments with direction pay and local date = `date` |
| Collected | `CustomerCreditTransaction` with `type = 'PAYMENT'` and local `created_at` on `date`. Checkout tenders live on `Sale.payments`; they are not this field. |
| AR / AP position | `getAccountingDashboardOverview` `position.accounts_receivable` / `accounts_payable` as of `date`. Period-movement financial KPIs stay off this page. |
| Stock | current on-hand vs reorder (same count the dashboard uses) plus shrinkage documents posted that day |
| Pending deliveries | completed-pipeline probe already used by `RetailDashboard` (`DELIVERY_PENDING` / `AWAITING_DELIVERY` / `PENDING_DELIVERY`) |
| Previous day | settled `sale.findMany` for the previous local `[start, end)`; `vsPreviousPct` is null when that query fails or yesterday’s completed-sale total is 0 |

**Cash movement headline.** If `till` loaded and has at least one session:
`cashTakings − refunds + cashIn − cashOut` on the roll-up. If `till` is
null (query failed) or `sessions` is empty: cash tender total on the day’s
sales minus cash refunds on the day’s returns.

**Till object.** Null only when the cashier-session query throws. Zero
overlapping sessions → `till` with `sessions: []`, zeroed roll-up, and
`unassignedSalesCount` still set.

**Till still open.** `closingCash` and `variance` on the roll-up are `null`
when any overlapping session is `OPEN`. The print footer and the last
WhatsApp line then use `asOf` (“figures as of HH:mm”).

**vsPreviousPct.** `(todayNet − yesterdayNet) / yesterdayNet × 100`. Null
when yesterday’s net is 0.

**newDues.** `sum(max(0, total_amount − amount_paid))` on that day’s
completed sales. Same figure as `headlines.newDues` and `dues.newDues`.

**Plan / module holes.** Accounting off the plan → `dues` is `null`.
Inventory off the plan → `stock` is `null`. Each `moneyOut` side is `null`
when that query fails; the parent is `null` only when every side failed.
A successful side with zeros is a loaded empty (UI hides the section).

**Checklist hrefs.** `OPEN_TILL` → `/sales/cashier-sessions`. `REORDER` →
`/inventory/reports/reorder`. `PENDING_DELIVERY` → `/sales/delivery`.

---

## Invariants

1. `sales.net === sales.gross − sales.returnsAmount`
2. `sum(tenders.amount) === sales.gross` (Credit row is the remainder, omitted at 0)
3. `headlines.netSales === sales.net`
4. `headlines.newDues === dues.newDues` when `dues` is non-null
5. Till `expectedCash` on each row equals `getSessionSummary.expectedCash` for
   that session
6. `whatsappText` is formatted from this payload on the server. The screen
   preview defaults to that string.

---

## Print

New `PrintDocType.DAILY_REPORT`. Keep these in lockstep, same as purchase
invoice:

- `apps/backend/src/print-templates/print-templates.dto.ts`
- `apps/frontend/src/lib/print/types.ts`
- `HeaderEditor.tsx` `DOC_TYPES`
- `settingsExtras.docTypes` labels (every locale that already lists PAYSLIP)

Print uses `openPrintWindow` + `renderHeaderHtml` for the assigned template.
No jsPDF. Repeat the letterhead on page 2, same as other long reports. Paper
size and skip-preview follow existing print prefs.

Section order on paper (and on screen):

1. Header — shop, branch, date, first/last sale, printed-at
2. Four headlines
3. Sales + tender mix
4. Till roll-up (open sessions called out)
5. Money out
6. Dues position
7. Top products + returns
8. Stock exceptions (omit if `stock` is null or all counts 0)
9. Checklist
10. Footer — who printed, `asOf` line while any till is open

A quiet day is one page; long lists may run to two. Hide a section when its
payload is `null` or empty.

---

## WhatsApp

`whatsappText` is built by a pure formatter (`formatDailyReportWhatsApp`)
from the payload and the request locale (frontend sends the current i18n
locale). Hard cap ~700 characters, about 8 lines, one chat bubble.

```
{shop} · {branch} · {d MMM}
Sales ৳{net} ({bills} bills{, N returns})
Paid: cash {n} · bKash {n} · … · due {n}
Cash {+n} · till {variance or “open”}
Out: purchases {n} · expenses {n}     ← only when either is non-zero
Dues now ৳{ar} · suppliers ৳{ap}
Top: {name} ×{units}
Need: {at most two checklist items}
As of {h:mm a}
```

Rules:

- Drop a line when that block is null or zero.
- Tender line lists non-zero methods only, compact thousands (`38k`) when it
  saves the cap.
- Checklist: two items; if more, the second line ends `+N more on the full report`.
- Zero-activity day: shop, date, `No sales`, `As of …` — still shareable.
- Bangla uses the same formatter with catalog strings and existing BDT
  formatting.

`MessageShareModal`: textarea defaults to `whatsappText`, **WhatsApp** opens
`https://wa.me/?text=` with the (possibly edited) body, **Copy** writes that
body. Editing does not PATCH the report.

v1 does not call Meta Cloud API or SMS. That is the scheduled-send follow-up,
and it needs an approved template for a business-initiated thread.

---

## Screen

```
[ date ▾ ]  [ branch name, read-only in v1 ]          [ Print ]  [ Share ]
```

Date picker defaults to today. Branch is the active store (the API default);
v1 does not ship a compare-branches bar.

Below the chrome, the same sections as print. Empty blocks unmount. An open
till renders an amber callout on the till block and on the checklist.

---

## Errors

| Case | Behaviour |
|---|---|
| Future `date` | 400 |
| `storeId` unknown / other tenant | 404 |
| Missing `VIEW_FINANCIAL_REPORTS` | 403 (page does not load) |
| Sales query fails | 502; page error banner |
| Other block fails | that key is `null`; page renders |
| No letterhead assigned | shop-name header, same as other docs |
| Clipboard / `wa.me` blocked | toast; modal stays open |

---

## Tests

Backend (compose with stubbed module services):

- Tender mix including Credit equals gross.
- Net = gross − returns.
- Till expected cash matches rolled-up `getSessionSummary`; unassigned cash
  sales increment `unassignedSalesCount` and stay out of expected cash.
- A 01:00 Asia/Dhaka sale is on that Dhaka date, not the previous UTC date.
- `whatsappText` omits a zero purchases line and includes till variance.
- Cashier without `VIEW_FINANCIAL_REPORTS` → 403.
- Stock query rejected → `stock` is null, `sales` present.
- Future date → 400.

Frontend:

- Empty / null blocks unmount.
- Print calls `openPrintWindow`.
- Share preview defaults to `whatsappText`.
- Nav link is visible on a BASIC plan (not hidden by `advancedOnly`).
- Retail dashboard shows **Today’s report**; Accounting dashboard does not.

---

## i18n

New catalog keys under `sales.dailyReport` (en + bn in the first PR; other
locales follow the repo’s existing message files so typecheck passes).
WhatsApp body strings live in the same catalog so the formatter is not
hardcoded English.

---

## Key decisions

1. **One payload, two renderings.** Print and WhatsApp are views of
   `GET /daily-report`, not two features.
2. **Server-built `whatsappText`.** The only way the chat and the page stay
   equal; unit-testable without a browser.
3. **Tap-to-share via `wa.me`, not Meta send.** Matches quotation/referral
   share. Avoids template approval and the 24-hour window. Scheduled send is
   a later feature on the same string.
4. **`VIEW_FINANCIAL_REPORTS`, not `SALES_READ`.** `SALES_READ` includes
   `CREATE_SALE`, which would hand every cashier AR, AP, and the shop till
   roll-up.
5. **Outside `sales.reports`.** That subgroup is `advancedOnly`; a BASIC
   shop is the primary reader.
6. **Till overlap, not “opened today.”** A shift that started yesterday and
   is still open is on today’s shop-day report.
7. **AR/AP from dashboard *position*,** not `getFinancialKpis` period
   movement, so “customers owe you now” is a closing balance.
8. **New `PrintDocType.DAILY_REPORT`** rather than `LIST_REPORT`, so a shop
   can assign the same letterhead family as invoices without hijacking list
   prints.
9. **`MessageShareModal` sibling** rather than stretching `ShareModal`, which
   is a short-link + revoke UI.

---

## Files (expected)

Backend: `apps/backend/src/daily-report/` (module, controller, service,
whatsapp formatter, specs). Register in `app.module.ts`.

Frontend: `apps/frontend/src/app/(app)/sales/daily-report/page.tsx`, print
helper, `components/share/MessageShareModal.tsx`, `api.getDailyReport`,
RetailDashboard link, nav registry + layout + `NAV_PERMISSIONS`, i18n.

Print enum lockstep listed under Print.

No Prisma migration.

---

## Later (explicitly out of this spec)

- Nightly send to configured owner numbers (needs WhatsApp template).
- Day-close lock (`asOf` becomes the close timestamp).
- All-branches / compare via `ReportScopeBar`.
- PDF in the WhatsApp thread.
- Named overdue customers on the checklist.
