# Sales exchange — one document for a size change or a swap

**Date:** 2026-10-13
**Status:** Draft pending review
**Asked as:** after a sale, a customer comes back to exchange (a size change, or
something else). One screen should post it, print one slip, and settle only
the price difference, following the original invoice.

---

## Problem

A customer brings goods back and takes something else. Today the cashier posts
a sales return for the full original price, then rings a new sale for the
replacement. The till and the books only come out right if both documents are
entered at full price and the drawer happens to be cash. A bKash invoice, a
card invoice, or an invoice that still has a due does not settle as a
difference, and nothing links the two documents.

There is no exchange document. Sizes are separate products, so a size change
is one product coming back and another going out.

## Goals

- One screen, against an original invoice. Posting is immediate.
- Each row is goods coming back and a replacement. The replacement quantity
  and price start at the quantity coming back and the price they paid. The
  cashier can change the product, the quantity, and the price.
- The customer pays or receives only the difference. Settlement follows the
  original invoice, as in [Settlement](#settlement).
- Stock moves both ways in the same transaction. The original invoice is left
  as it was.
- One customer slip. Mushak 6.3 and 6.7 stay available for the VAT file.
- Sales reports, the daily report, the till, the customer due, and revenue
  move by the difference.

## Non-goals

- Loyalty points. A return does not touch them, and an exchange does not either.
- Editing or deleting a posted exchange. Cancel, with a note, then post another.
- An exchange with no original invoice.
- A warehouse picker. Goods go back to the warehouse the line was sold from,
  and the replacement leaves from that same warehouse.
- A thermal slip. The customer slip is A4, same print window as a return.
- A new posting rule. The voucher uses the sale and sales-return rules that
  already exist.
- Importing exchanges from Express or Dizi.
- A new permission. Posting uses `CREATE_RETURN`. Cancelling uses `CANCEL_ENTRY`.
- Adding goods with nothing coming back. Every row has a returned quantity of
  at least one and a replacement quantity of at least one.

## Document

`SalesExchange` is its own document. It always names a sale.

Header:

- Tenant, branch (the sale's branch), sale, and the cashier session of the
  person posting. The session is stamped on the server from that person's open
  session. It stays null when they have none, the same way a back-office sale
  does.
- Number `EXC-` plus the timestamp, unique per tenant, issued the same way as
  a return number. A unique collision fails the request.
- Optional reason.
- Status `COMPLETED` or `CANCELLED`. Create writes `COMPLETED`. There is no draft.
- Returned total, replacement total, and difference. Difference is replacement
  total minus returned total. Both totals are tax-inclusive. Money is rounded
  to paisa. A difference whose absolute value is at most 0.005 is zero.
- Settlement mode: `cash`, `bank`, `bkash`, `nagad`, or `credit`. This is the
  tender for any amount that does not sit on the due. When the whole
  difference sits on the due, the mode is `credit`. An even swap still stores
  the mode it would have used, and both deltas are zero.
- `due_delta` and `cash_delta`, the amounts actually applied. `due_delta` is
  the receivable movement, signed (positive increases what the customer owes).
  The tender movement is the difference minus `due_delta`. `cash_delta` equals
  that tender movement when the mode is `cash`, and is zero otherwise. Cancel
  and the till replay these stored figures. They do not recompute them.
- Warehouse: the sale's warehouse, otherwise the tenant's default sales
  warehouse.
- Who posted it, and when.
- Cancel fields: when, who, and a required note.

`SalesExchangeLine`, one per row the cashier posted:

- The original sale line.
- Product and quantity coming back. Unit price is locked to that line's
  `price_at_sale`. Unit cost is copied from `unit_cost_at_sale` (null when the
  sale line has none).
- Replacement product, quantity, and unit price as posted. Unit cost is
  snapshotted from the cost pool at posting, the same way a sale snapshots
  cost.
- Warehouse on each side. Both are the warehouse that sale line was sold from
  (`SaleItem.warehouse_id`, otherwise the exchange warehouse).
- Tax. Goods coming back keep the original line's VAT and supplementary-duty
  rates. The amounts are recomputed with `splitTaxInclusive` on unit price
  times returned quantity, so a partial quantity does not prorate an already
  rounded line total. The replacement's rates are the product's current rates
  (tenant default VAT when the product has none, same as a sale). Amounts are
  computed on the posted inclusive price.

Several rows may name the same original line. Their returned quantities,
together with earlier returns and earlier completed exchanges, cannot exceed
the quantity sold.

Open quantity of a sale line is:

```
sold − returned on returns that still exist − returned on exchanges whose status is not CANCELLED
```

The sales-return create and update paths use the same figure, so goods already
exchanged cannot be returned, and goods already returned cannot be exchanged.
The sale payload that both screens load includes completed exchange quantities
beside the returns it already includes.

A posted exchange is not edited and has no delete.

## Settlement

The server re-reads the sale inside the posting transaction and decides this.
The screen's sentence is a preview. The client does not send a mode or an
amount. `forbidNonWhitelisted` rejects those fields.

"Still has a due" means `creditDueAmount(total, amount_paid)` is greater than
0.005. "First payment" is `sale.payments` ordered by `created_at` ascending.
Its mode is `classifyPaymentMode`. A fully paid invoice with no payment rows,
or whose first payment classifies as `credit` while nothing is owed, settles
in cash.

| Original invoice | Difference | Result |
|---|---|---|
| Still has a due | Customer owes more | `due_delta` = difference. `cash_delta` = 0. Mode `credit`. |
| Still has a due | Customer is owed, and the refund is within the due | `due_delta` = difference (negative). `cash_delta` = 0. Mode `credit`. |
| Still has a due | Refund larger than the due | `due_delta` brings the due to zero. The remainder is paid back through the first payment's mode. `cash_delta` is that remainder only when that mode is cash. |
| Paid in full, cash | Either way | The whole difference is `cash_delta`. |
| Paid in full, bKash, Nagad, or card | Either way | The whole difference posts to that account. `cash_delta` = 0. Card and bank classify as `bank`. |
| Even swap | Zero | No voucher, no due movement, no drawer movement. |

A due movement requires the sale's customer. A walk-in invoice whose
difference would change a due is refused. A walk-in cash difference is
allowed.

When `due_delta` is positive, `assertCustomerCreditForSale` runs for that
amount, the same check a credit sale uses. Past the limit, the post is refused.

## Stock

In the same transaction as the document:

- `EXCHANGE_IN` adds the returned quantity to the line's warehouse.
  `reference_type` `SALES_EXCHANGE`, `reference_id` the exchange id.
- `EXCHANGE_OUT` subtracts the replacement quantity from that same warehouse.

`EXCHANGE_OUT` is in `NEGATIVE_STOCK_MOVEMENT_TYPES`, so a shortfall is
allowed only when the shop already allows selling stock it does not have.
`EXCHANGE_IN` is not in that set. Putting goods back is an increment and is
not refused for lack of stock.

Cancel writes the opposite movements. `EXCHANGE_IN_REVERSAL` (a decrement) is
in `NEGATIVE_STOCK_MOVEMENT_TYPES`, because it undoes a restock.
`EXCHANGE_OUT_REVERSAL` puts the replacement back and is not in that set.

## Books

### Voucher

A zero difference posts nothing.

A positive tender or due movement posts with `autoPostFromRules` event type
`sale`: debit the settlement account, credit sales revenue, for that amount.
A negative movement posts with event type `sale_return`, the other way, for
the absolute amount. `sourceModule` is `sales`, `sourceType` is
`sale_exchange`, `sourceId` is the exchange id. The description names the
exchange number and the original invoice serial. `referenceNumber` is the
exchange number. The party is the customer when the sale has one.

A refund larger than the due is two vouchers. One is `sale_return` with
`payment_mode` `credit` for the amount that brings the due to zero. The other
is `sale_return` with the original tender's mode for the remainder. They pass
distinct `legKey`s (`due` and `tender`) so the idempotency key does not drop
the second. A single movement passes no `legKey`.

No new row is added to `DEFAULT_POSTING_RULES`. The posting-contract registry
gains the new call sites. The event types it emits are `sale` and
`sale_return`, which already have rules.

If the matching rule is missing, the document and the stock still commit and
the result says the voucher was skipped, which is how a sale already behaves.
A locked fiscal period is not that case: posting throws, and the transaction
rolls back, so stock does not move without the voucher.

Cancel calls `voidAutoPostedVoucher` for each leg that was posted, using the
same event type, source id, and leg key. A missing leg is a no-op. A locked
period refuses the cancel, the same way it refuses voiding a sale.

### Customer and till

When the sale has a customer and the difference is not zero, `total_spent`
moves by the difference.

When `due_delta` is not zero, a `CustomerCreditTransaction` of type
`ADJUSTMENT` is written: signed amount, `balance_after`, `reference_type`
`SALES_EXCHANGE`, `reference_id` the exchange id, and the customer's `store_id`.
`due_balance` moves by the same amount.

The open shift's expected cash adds `cash_delta` of completed exchanges
stamped with that session. The refund query stays sales returns only. An
exchange is not a sales-return refund.

A shift that is already closed keeps the expected cash it stored at close.
Cancelling afterwards still voids the vouchers and restores stock, due, and
spend. It does not rewrite a closed shift.

### Sales reports and the daily report

`loadMarginSource` also loads completed exchanges in the window. Incoming
lines go through the return side (price, quantity, copied unit cost). Outgoing
lines go through the sale side (posted price, quantity, snapshotted unit cost).
Net sales move by the difference. An even swap can still change the margin
when the two products cost different amounts. The difference is not also added
on top of those lines.

The daily report's net adds the sum of completed exchange differences for that
branch and day. It does not add the outgoing total into gross sales, and its
returns list stays returns only. When the report reads an open shift, cash
already includes `cash_delta`. When it does not, the cash fallback adds
`cash_delta` itself.

### Mushak

Goods going out are a supply. `GET /sales-exchanges/:id/mushak` is the 6.3,
numbered with the exchange number, priced at the posted inclusive amounts and
the replacement's stored tax. The 6.2 sales book gains one row per completed
exchange for that outgoing supply. The 6.10 large-supply list counts that
outgoing total on its own, because it reads the sales book.

Goods coming back are a 6.7 credit note against the original invoice.
`GET /sales-exchanges/:id/credit-note` builds it from the incoming lines at
the stored original rates. An even swap still produces both forms. The
incoming side is not a negative row in the 6.2, which is the same split a
return already uses: the sales book lists supplies, and the credit note is its
own form.

## Screen

Sidebar link **Exchanges** at `/sales/exchanges`, next to Returns, permission
`CREATE_RETURN`. A saved nav layout does not grow new nodes by itself;
`sync-nav-layout` is run for the new node after deploy, the same way other
leaves are.

The list uses `PageShell` and `PageHeader`. Columns: number, date, original
invoice, customer, returned total, replacement total, difference, how it was
settled, status. Branch filter and created-date range match the returns list.
**New exchange** is the primary action, `blue-600`.

`/sales/exchanges/new` uses the document entry layout. The cashier looks the
invoice up by its serial. A sale that is not a draft and not cancelled, and
that still has open quantity, has an Exchange action in its header. That
action opens this page with the invoice loaded. It is hidden otherwise, and
hidden without `CREATE_RETURN`.

Each row picks an open line, the quantity coming back, the replacement
product, the replacement quantity, and the price. Quantity and price start as
in [Goals](#goals). The price can be typed over. There is no warehouse field.
The reason is optional.

The side panel shows the returned total, the replacement total, the
difference, and a sentence for how it will settle ("Collect ৳200 cash", "The
customer's due increases by ৳200", "Even exchange", and the bKash, Nagad, and
bank forms). The page sends the rows and the reason. After a successful post,
the slip preview opens and the cashier lands on the exchange.

`/sales/exchanges/[id]` shows the paired rows, the original invoice, and the
settlement that was applied. Print prints the slip. Two further actions open
the 6.3 and the 6.7. Cancel uses `CancelEntryModal`, requires a note, and is
shown only with `CANCEL_ENTRY`.

Copy for the screens goes through the locale catalogs, every locale the
catalog test covers.

### Slip

One A4 preview through the same print window as a return. Letterhead type
`SALES_EXCHANGE`, added in lockstep:

- `apps/backend/src/print-templates/print-templates.dto.ts`
- `apps/frontend/src/lib/print/types.ts`
- `HeaderEditor` `DOC_TYPES`
- every locale's `settingsExtras.docTypes`

Until a shop assigns a template, resolve falls back the way other doc types
do. The slip names the exchange and the original invoice, lists what came
back and what went out with quantities and prices, then the two totals and
the difference. One line states the settlement in taka from the stored deltas
and mode. The customer's name is printed when the invoice has one. The reason
is printed when it was entered. Money uses `formatBDT`.

## API

All routes sit behind `JwtAuthGuard`, `StorePermissionGuard`, and
`TenantInterceptor`. They carry permission decorators, so they stay out of
`route-authorization.baseline.ts`. The route-authorization spec proves they
are gated.

| Method | Path | Permission |
|---|---|---|
| `POST` | `/sales-exchanges` | `CREATE_RETURN` |
| `GET` | `/sales-exchanges` | `SALES_READ` |
| `GET` | `/sales-exchanges/:id` | `SALES_READ` |
| `POST` | `/sales-exchanges/:id/cancel` | `CANCEL_ENTRY` |
| `GET` | `/sales-exchanges/:id/mushak` | `SALES_READ` |
| `GET` | `/sales-exchanges/:id/credit-note` | `SALES_READ` |

There is no `PATCH` and no `DELETE`.

`POST /sales-exchanges` body:

- `saleId` (required)
- `reason` (optional string)
- `lines` (at least one): `saleItemId`, `quantity` (integer ≥ 1), `replacementProductId`, `replacementQuantity` (integer ≥ 1), `unitPrice` (number ≥ 0)

The branch, the warehouse, the session, the prices of goods coming back, and
the settlement are not accepted from the client. The sale's branch is the
exchange's branch.

The response is the exchange, its lines, `posting_status`, and the voucher
ids when a voucher was posted.

`GET /sales-exchanges` takes the same branch and created-date query as the
returns list (`BranchListQueryDto`).

`POST /sales-exchanges/:id/cancel` body: `note` (required, non-empty).
Cancelling an exchange that is already cancelled is refused. Cancel applies
the opposite of the stored `due_delta` and difference, writes the reversing
credit-ledger line when `due_delta` was not zero, voids the vouchers, and
reverses stock. It does not recompute settlement from the sale as it stands
today.

Create and cancel are recorded in history as `SALES_EXCHANGE`.

### Refusals

Checked inside the transaction, after re-reading the sale:

- Sale missing, not in this tenant, draft, or cancelled.
- A line's sale item is not on that sale.
- Returned quantity would exceed open quantity, including other rows in this
  same post.
- Replacement product missing, deleted, or in another tenant.
- Either quantity below 1, or `unitPrice` negative. Zero is allowed.
- Replacement stock would go negative and the shop does not allow it.
- The difference would change a due and the sale has no customer.
- A positive `due_delta` would pass the customer's credit limit.
- Empty `lines`.

Two posts racing for the last open unit: one commits, the other is refused.
The submit button stays disabled while the request is in flight.

## Files

- `packages/database/prisma/schema.prisma` and a migration for `SalesExchange`,
  `SalesExchangeLine`, and the `SaleItem` relation.
- `apps/backend/src/sales-exchanges/` — module, controller, dto, service, specs.
- `apps/backend/src/database/inventory.utils.ts` — the two movement types that
  may go negative.
- `apps/backend/src/sales-returns/sales-returns.service.ts` — open quantity
  subtracts completed exchanges.
- `apps/backend/src/sales/sales.service.ts` — sale read includes completed
  exchange quantities per line.
- `apps/backend/src/cashier-sessions/cashier-sessions.service.ts` — `cash_delta`.
- `apps/backend/src/daily-report/daily-report.service.ts` — net and the cash
  fallback.
- `apps/backend/src/sales-reports/sales-reports.service.ts` — `loadMarginSource`.
- `apps/backend/src/mushak/mushak.service.ts` — 6.3, 6.7, and the 6.2 row.
- `apps/backend/src/accounting/posting-contract.ts` — new emitters only.
- `packages/shared-types/record-history.ts` and `navigation.ts`.
- `apps/frontend/src/app/(app)/sales/exchanges/` — list, new, detail, mushak,
  credit note.
- `apps/frontend/src/app/(app)/sales/[id]/page.tsx` — Exchange action.
- `apps/frontend/src/app/(app)/sales/returns/new/page.tsx` — open quantity
  subtracts exchanges once the payload includes them.
- Print doc type lockstep files listed under [Slip](#slip).
- `apps/frontend/src/lib/routes.ts` and the API client.

## Testing

Backend service tests:

- Even swap: both stock movements, no voucher, no due, no cash, open quantity
  reduced, cost snapshotted on the way out and copied on the way in.
- Cash invoice, higher price and lower price: `cash_delta` sign, event type
  `sale` or `sale_return`, and the shift's expected cash.
- Fully paid bKash: tender voucher, `cash_delta` 0, expected cash unchanged.
- Due rises. Due falls within the balance. Refund larger than the due: due to
  zero, remainder on the original tender, two leg keys.
- Fully paid invoice whose first payment classifies as credit: the difference
  is cash.
- Open quantity shared with an existing return, and a return refused after an
  exchange has taken the unit.
- Stock shortfall refused unless negative stock is allowed.
- Missing customer when a due would change. Credit limit refused.
- Zero price allowed. Negative price refused. Draft and cancelled sale refused.
- Cancel restores stock, due, spend, and open quantity, voids the vouchers,
  and refuses a second cancel or an empty note.
- Margin loader and daily report net include the difference once.
- Mushak 6.7 uses the original rates. Mushak 6.3 and the 6.2 row use the
  replacement price and the exchange number.

Frontend:

- New-exchange page test: lookup, price starts at what they paid, settlement
  sentence matches a cash difference and an even swap.
- Detail page test: Cancel is absent without `CANCEL_ENTRY`.
- Route-authorization spec: the six routes are gated.

## Key decisions

1. **A new document, not a linked return plus sale.** The cashier posts one
   thing. Stock, tax, and reports learn that document. The voucher still uses
   the sale and sales-return rules so revenue lands in the same accounts.
2. **The difference follows the original invoice.** Any remaining due absorbs
   the whole difference. Only the part of a refund that exceeds the due leaves
   through the original tender. A fully paid invoice uses its first payment.
   A cleared credit sale settles the difference in cash.
3. **The replacement starts at the price they paid.** The cashier types over
   it when the new goods should cost something else. Goods coming back stay at
   the original price.
4. **The till sees `cash_delta` only.** A bKash, Nagad, card, or due exchange
   does not look like cash leaving the drawer.
5. **Mushak stays two forms.** The outgoing supply is a 6.3 and a 6.2 row. The
   incoming goods are a 6.7 against the original invoice. An even swap still
   produces both, because the goods changed.
