# VAT added on top of prices — per-shop setting

Status: approved in conversation 2026-10-06 (approach A, VAT after discount).

## Problem

1. The Sales Entry screen never shows VAT. It reads the rate from
   `GET /sales-settings` → `tenant.default_vat_rate`, a field that endpoint has
   never returned, so the rate is always 0 whatever Settings → Tax says.
2. Some shops price **before** VAT and add it at the counter (a customer's sample
   invoice: Sub Total 6,040 + Tax 906 = 6,936). ERP71 only knows VAT-inclusive
   prices: the server backs VAT out of the total and rejects any total that is
   not `lines − discount − loyalty` ("Sale total mismatch").

## Decisions

- **Per-shop setting** in Settings → Tax: *Prices include VAT* (default, today's
  behaviour) or *VAT is added on top of prices*.
- **Approach A — store inclusive, enter and show before VAT.** Sales keep storing
  VAT-inclusive `price_at_sale` and totals exactly as today. In an "added on top"
  shop the entry screen converts each before-VAT price to its VAT-inclusive price
  (with that product's own VAT/SD rate, else the shop default) just before it
  saves. The server's total check, tax snapshot, Mushak, returns, POS and reports
  are unchanged and stay correct.
- **Each document records its mode**: `prices_include_vat` on `Sale`, `Quotation`,
  `SalesOrder`, stamped when it is created. Editing, duplicating, converting and
  reprinting follow the document's own mode, never the shop's current one.
- **VAT is charged on the amount after the discount** (NBR taxable value; matches
  the stored tax and the Mushak 6.3). Loyalty redemption is a discount too.
- **Scope**: New Sale, editing a saved sale, Duplicate, quotations and sales
  orders (entry, edit, view, print, convert-to-sale), both printed invoice
  designs, the on-screen invoice page. Not POS, not returns (both stay correct
  under approach A because the stored prices are VAT-inclusive; POS in an
  "added on top" shop would charge the catalogue price as VAT-inclusive — the
  setting warns about this).
- Proforma invoices in a foreign currency carry no VAT.

## Data

- `Tenant.prices_include_vat Boolean @default(true)` — the setting, exposed with
  the other tax settings on `GET/PATCH /tenants/tax-settings`.
- `Sale.prices_include_vat Boolean @default(true)` — how the sale was entered.
- `Quotation` / `SalesOrder`: `prices_include_vat Boolean @default(true)` and
  `vat_amount Decimal(12,2) @default(0)`. These documents have no tax snapshot
  and nothing downstream reads their tax, so their lines are stored **as typed**
  (before VAT in an "added on top" document) and the total includes the VAT.
- One migration; every default is "prices include VAT", so no shop changes until
  it picks the new option.

## Arithmetic (shared, `@erp71/shared-types/vat-pricing`)

- `grossUpUnitPrice(net, rates) = round2(net × (1+sd)(1+vat))` and
  `netUnitPrice(gross, rates) = round2(gross / ((1+sd)(1+vat)))`. For a 2-decimal
  price, `netUnitPrice(grossUpUnitPrice(p)) === p` for any non-negative rate.
- `computeEntryTax(lines, discount, pricesIncludeVat)` — what an entry screen
  shows and posts:
  - *include*: posted prices = entered; posted discount = discount; total =
    lines − discount; VAT/SD = `computeSaleTax(lines, total)` (shown as
    "included").
  - *added on top*: posted unit prices = gross-ups; G = Σ posted lines,
    E = Σ entered lines; posted discount = round2(discount × G / E) capped at G;
    total = G − posted discount; VAT/SD = `computeSaleTax(posted lines, total)`
    — the very figure the server will snapshot.
  - `discountShown` = E + VAT + SD − total (*added on top*), so
    Sub Total − Discount + VAT + SD = Total always foots; it equals the typed
    discount except for paisa rounding.
- Quotations and orders use the same function; they post entered prices, the
  `vat_amount` and the VAT-inclusive total.

## Screens

- **Settings → Tax**: the two-way choice, a hint, and a warning that POS still
  treats prices as VAT-inclusive.
- **New Sale**: rate and mode come from `/tenants/tax-settings` (fixes the root
  bug). *Include*: info row "VAT 15% (included)". *Added on top*: Sub Total,
  Discount, VAT, (SD), Total; catalogue price is the before-VAT price. Lines carry
  the product's own VAT/SD rate.
- **Edit sale / Duplicate**: an "added on top" sale is seeded with before-VAT
  prices (`netUnitPrice` with the line's stored rates) and its discount in
  before-VAT terms; saving posts gross-ups again. Inclusive sales behave as today.
- **Quotations / orders**: new and edit screens add VAT on top for "added on top"
  documents; view and print show a VAT row whenever `vat_amount > 0`.
  Convert-to-sale seeds prices in the new sale's mode (converting with product
  rates when the document's mode differs from the shop's).
- **Prints**: an "added on top" sale prints before-VAT unit prices and
  Sub Total → Discount → VAT → Total (detailed design: the on-top branch; standard
  design: Subtotal/Discount/VAT rows). The on-screen invoice page reads the stored
  `vat_amount`/`sd_amount` instead of recomputing.

## Out of scope (logged in TODO.md)

POS following the setting; no Output VAT ledger account (VAT is booked as
revenue in both modes); returns ignore the invoice discount; editing a posted
sale does not re-post vouchers; transport/labour still rejected on save.

## Testing

- shared-types: round-trip property for gross-up/net-down across rates, SD and
  prices; `computeEntryTax` totals equal what `prepareSale` computes, both modes,
  mixed product rates, with discount.
- backend: tax settings read/write the flag; create/draft store
  `prices_include_vat`; quotations/orders store `vat_amount` and the flag.
- frontend: New Sale posts gross prices, gross discount and the flag in "added on
  top"; edit seeds before-VAT prices; prints in both modes and designs.
- Manual: one sale in each mode through the local app, then print.

## Build order

1. Schema + migration. 2. shared-types `vat-pricing` + tests. 3. Backend tax
settings, sale flag, quotation/order fields + tests. 4. Tax settings hook,
cart line rates, `computeSaleTotals` on `computeEntryTax`, TotalsFooter rows,
New Sale. 5. Edit sale, Duplicate, conversions. 6. Quotations/orders entry, edit,
view, print. 7. Invoice prints + invoice page. 8. Settings → Tax UI + i18n.
9. Full suites, lint, local run, TODO.md.
