# NBR Mushak 6.x support (sales)

How ERP71 produces the National Board of Revenue's Mushak (মূসক) documents from
the sales module, what it stores to make them reproducible, and which forms it
deliberately does not produce.

Statutory basis throughout: the **Value Added Tax and Supplementary Duty Act
2012** and the **Value Added Tax and Supplementary Duty Rules 2016**. Rule 40(1)
prescribes the 6.x family; each form below carries the clause it comes from.

---

## What is produced, and from where

| Form | Bangla | English | Source | Route |
|------|--------|---------|--------|-------|
| **6.2** | বিক্রয় হিসাব পুস্তক | Sales book | every posted sale in a tax period | `/sales/reports/mushak` |
| **6.3** | কর চালানপত্র | Tax invoice | one sale | `/sales/[id]/mushak` |
| **6.7** | ক্রেডিট নোট | Credit note | one sales return **with a linked sale** | `/sales/returns/[id]/mushak` |
| **6.10** | ২ লক্ষ টাকার ঊর্ধ্বে সরবরাহের তালিকা | Large-supply statement | the 6.2 rows, filtered | `/sales/reports/mushak` |

The remaining seven — 6.1, 6.2.1, 6.4, 6.5, 6.6, 6.8, 6.9 — are **not**
generated. They are still listed in `MUSHAK_FORMS` (`packages/shared-types/mushak.ts`)
with `supported: false`, and the books screen names them, so a workspace is told
which records it still keeps by hand rather than left to infer it from an empty
menu.

API routes mirror the form numbers, because that is how people ask for them:
`GET /mushak/6.3/:saleId`, `GET /mushak/6.2`, `GET /mushak/6.7/:returnId`,
`GET /mushak/6.10`, plus `GET /mushak/forms` for the catalogue.

---

## The tax is snapshotted, not derived

A Mushak 6.3 is a statutory document NBR holds its own copy of. It has to
reprint identically years later, and the 6.2 book built from the same sales has
to agree with every 6.3 issued.

So VAT and supplementary duty are worked out **once, when the sale is posted**,
and stored:

- `SaleItem.vat_rate`, `sd_rate`, `vat_amount`, `sd_amount` — the rates in force
  for that product at that moment, and what they came to.
- `Sale.vat_amount`, `sd_amount` — the rollups.

Deriving instead would silently restate last quarter's invoices the first time
anyone edited a VAT rate. Sale lines written *before* these columns existed
carry `vat_rate = NULL`; a document built from those is reconstructed from the
current catalogue and comes back flagged `estimated: true`, which the UI shows
as a warning rather than passing off as a reprint.

### Prices are tax-inclusive

`SaleItem.price_at_sale` is what the customer pays, taxes included — the
Bangladeshi retail convention, and the assumption this product has always made.
The stored tax amounts are therefore *inside* `total_amount`, never added to it:

```
total_amount − vat_amount − sd_amount = value of the supply
```

This is why the change needed no accounting migration: no total moved.

### The arithmetic

Supplementary duty is levied on the value of the supply; VAT on the value *plus*
that duty. An inclusive amount `P` at SD rate `s` and VAT rate `v` decomposes as

```
P = V × (1 + s/100) × (1 + v/100)
```

With `s = 0` this reduces to the familiar `P × v / (100 + v)`. `splitTaxInclusive`
derives VAT by subtraction rather than by its own multiplication, so the three
parts always add back to the gross charged.

### Discounts reduce the value of the supply

ERP71 keeps invoice-level reductions — a promo code, redeemed loyalty points, a
typed discount — in `Sale.total_amount` rather than on the lines. Before tax is
worked out, that reduction is spread back over the lines pro rata (largest
remainder, so the parts sum to the billed total exactly).

Without this the 6.3 would declare output VAT the business never collected, and
would not foot to its own total. A total *above* the lines is left alone:
transport, labour or a rounding-up adjustment is not the value of a supply.

### Which rate applies

`resolveTaxRate(product.vat_rate, tenant.default_vat_rate)`:

- the product's own rate wins where set;
- an explicit `0` on the product is a **zero-rated or exempt** supply and does
  *not* fall through to the workspace default;
- supplementary duty (`Product.sd_rate`) has **no** workspace fallback — SD
  attaches to a Third Schedule commodity, never to a business.

---

## Configuration

**Settings › Tax** carries the issuer block every 6.x document prints:

| Field | Bangla | Why |
|-------|--------|-----|
| `vat_registration_no` | বিআইএন | Without it the document is a cash memo, not a tax invoice |
| `mushak_issue_address` | চালানপত্র ইস্যুর ঠিকানা | The registered premises, not necessarily the selling branch |
| `mushak_officer_name` | দায়িত্বপ্রাপ্ত ব্যক্তির নাম | Who signs for the business |
| `mushak_officer_designation` | পদবি | Printed beneath the signature |
| `mushak_economic_activity` | অর্থনৈতিক কার্যক্রম | As on the registration certificate |
| `mushak_enabled` | — | Off means sales print a plain shop invoice |

`checkMushakIssuer()` is the single readiness check, run both by the settings
screen and by every document endpoint, so the list of what is missing is the one
that will actually block a 6.3.

Elsewhere:

- **Customer › BIN** (`Customer.bin`) — the buyer's own registration. Its
  *absence* is meaningful: it is what puts a supply over two lakh taka on the
  6.10.
- **Product › VAT rate / Supplementary duty** — per-commodity overrides.
- **Mushak 6.3 screen** — captures সরবরাহের গন্তব্যস্থল and যানবাহনের প্রকৃতি ও
  নম্বর, the two boxes nothing else in the system records. Kept off the sales
  entry form because a counter sale the customer carries out has neither.

---

## Document rendering

The form labels are **not** localised. A Mushak form's wording is prescribed in
Bangla; translating "কর চালানপত্র" because a user set their interface language to
German would produce something NBR does not accept. Each Bangla label carries a
small English gloss so a non-Bangla-reading bookkeeper can still work the
document. Only the surrounding chrome — buttons, page titles, warnings — goes
through `useI18n`.

Column headings print the gazetted column number in Bengali numerals
(`toBengaliDigits`); money stays in Western digits, which NBR accepts and which
a bookkeeper reconciling against the ledger can read.

`/sales/[id]/invoice` remains the shop's **commercial** invoice and may look
however the shop likes; it now reads the same stored snapshot, links across to
the 6.3, and no longer claims to be one.

---

## Permissions

- **6.3 and 6.7** carry no extra permission: anyone who may see a sale may print
  its invoice. Gating them separately would leave a cashier able to view a sale
  but not hand the customer its document.
- **6.2 and 6.10** sit behind `VIEW_FINANCIAL_REPORTS` — they are the
  workspace's whole VAT position, like every other report that exposes it.

The books link is deliberately **not** inside the `advancedOnly` sales-reports
subgroup: a sales book is a statutory record every VAT-registered shop must
keep, not an analytics extra to be sold as an upgrade.

---

## Exclusions, and why

- **A draft** has posted nothing — no stock moved, no supply made — so no 6.3
  may be raised against it. The endpoint refuses.
- **A cancelled sale** still prints, flagged, so the reversal has a paper trail;
  it is unwound with a 6.7, not by reissuing the invoice.
- **Drafts and cancelled sales are both excluded from the 6.2**, which is the
  book an NBR officer inspects.
- **A return with no linked sale** cannot produce a 6.7: rule 40(1)(ঞ) requires
  the note to name the চালানপত্র it reduces, and goods returned from before the
  business moved onto this system have no invoice to reduce.
- **A buyer with a BIN** is excluded from the 6.10: they account for the supply
  through their own input credit.

---

## Files

```
packages/shared-types/mushak.ts          form catalogue, tax arithmetic, units, readiness
packages/database/prisma/migrations/20260916140000_mushak_6x_sales/
apps/backend/src/mushak/sale-tax.util.ts snapshot written at posting time
apps/backend/src/mushak/mushak.service.ts document assembly
apps/frontend/src/components/mushak/MushakDocument.tsx  shared gazette chrome
apps/frontend/src/app/(app)/sales/[id]/mushak/          6.3
apps/frontend/src/app/(app)/sales/returns/[id]/mushak/  6.7
apps/frontend/src/app/(app)/sales/reports/mushak/       6.2 and 6.10
```
