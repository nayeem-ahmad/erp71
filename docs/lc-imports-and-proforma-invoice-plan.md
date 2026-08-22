# LC imports and proforma invoices — implementation plan

Status: **built, 2026-08-21.** Written 2026-08-20 as a proposal; all five phases
shipped. Kept as the design record — what was decided and why — rather than
rewritten as documentation of the result. Where the build diverged from the
proposal, §7 says so.

Open follow-ups are tracked in `TODO.md` under "Imports (LC) and proforma
invoices"; the largest is that **none of this has been opened in a browser.**

Two requests that sound like one feature and are not:

1. **Importing via LC** — the tenant buys from a foreign supplier against a
   Letter of Credit. Inbound, purchase side, 60–150 days long, and the money
   that decides the product's cost arrives in a dozen separate payments to the
   bank, the C&F agent and Customs — not on the supplier's invoice.
2. **Sharing a PI with potential customers** — the tenant issues its *own*
   Proforma Invoice to a prospect and sends them a link. Outbound, sales side,
   and a document, not a process.

They meet in exactly one place: a customer's PI is often what justifies opening
the LC. Otherwise they are independent, and (2) is roughly two days of work
while (1) is the larger piece. **Ship them separately, PI first.**

---

## 1. Executive summary

| | PI to customers | LC import |
|---|---|---|
| Existing home | `Quotation` | `PurchaseOrder` → `Purchase` |
| New tables | none | `ImportShipment`, `ImportShipmentItem`, `ImportCost`, `ImportDocument` |
| Sharing | already built — reuse verbatim | n/a |
| Blocking gaps | none | no currency anywhere, landed cost dropped, two-leg posting |
| Size | ~1 migration, no new module | 5 phases, new module, addon-gated |

The architectural decision that makes the LC half tractable:

> **The import module produces a `Purchase`; it does not replace it.**

An `ImportShipment` is a long-running file that accumulates costs. When the
goods clear customs, it emits an ordinary `Purchase` whose `unit_cost` is the
**landed** cost. Everything downstream — `ProductCost.avg_cost`,
`InventoryMovement`, the supplier ledger, every purchase report — then works
with no changes at all.

---

## 2. What already exists

### 2.1 The sharing half is done

The quotation share mechanism is exactly the shape a shared PI needs, and it is
already built end to end:

| Piece | Location |
|---|---|
| `Quotation.share_token` / `share_token_at`, unique + nullable | `packages/database/prisma/schema.prisma:2904` |
| Mint / revoke, token regenerated on revise | `apps/backend/src/sales-quotations/sales-quotations.service.ts:265,300` |
| Unauthenticated public read — the token is the authorization | `apps/backend/src/sales-quotations/public-quotations.controller.ts` |
| Public page | `apps/frontend/src/app/q/[token]/PublicQuotationView.tsx` |
| Short link + full click analytics (channel, UTM, device, country) | `ShortLink` / `ShortLinkClick`, `ShortLinkEntity.QUOTATION` |
| Quote → sales order conversion, deposits | `convertToOrder`, `OrderDeposit` |

Nothing here needs redesigning for a PI. A PI *is* a quotation with commercial
terms attached and a different name on the paper.

### 2.2 Multi-currency support: none

Two `currency` columns exist in the entire schema — `BillingEvent.currency` and
`SmsPackage.currency`, both platform billing. Every business amount is
`Decimal(12,2)` with an implied BDT. `formatBDT()` is mandated by the UI rules.

The frontend is slightly ahead of the backend here: `formatCurrency()` in
`apps/frontend/src/lib/format.ts` already takes a currency code and knows
`BDT`/`MYR`/`USD`, so the display layer is not the obstacle.

### 2.3 Landed cost is silently dropped — an existing bug

`Purchase` carries `freight_amount` on the header (`schema.prisma:1620`), and
`PurchasesService.create` folds it into `total_amount`
(`purchases.service.ts:47`) and stores it (`:94`). It then calls
`applyInventoryMovement` with `unitCost: item.unitCost` (`:120`) — the raw line
cost. **Freight never reaches `ProductCost.avg_cost`.**

Today that is a rounding error on a local purchase. On an import where duty,
VAT, AIT, C&F and port charges routinely add 30–60% to the invoice value, it is
the difference between knowing your margin and guessing it. LC support does not
introduce this bug; it makes it unignorable.

### 2.4 Auto-posting is strictly two-legged

`autoPostFromRules` resolves exactly one debit and one credit account off a
`PostingRule` (`apps/backend/src/accounting/posting.utils.ts:331-332`) and
rejects a posting where they collapse onto the same account (`:343`). Every
module-driven journal in the platform is a two-line voucher.

LC accounting is not two-legged. Receiving an import is:

```
Dr  Inventory (landed)          1,000,000
    Cr  Goods in Transit                    780,000
    Cr  Customs Duty payable/paid           140,000
    Cr  C&F agent payable                    50,000
    Cr  Transport payable                    30,000
```

The manual voucher path already supports N lines — `createVoucher` maps
`dto.details` straight onto `VoucherDetail` rows
(`apps/backend/src/accounting/accounting.service.ts:1486`). So the capability
exists; what is missing is a *module-callable* multi-leg helper with the
idempotency-key and `PostingEvent` handling that `autoPostFromRules` provides.

This same limitation is already logged in `TODO.md` against perpetual inventory
and against gross payroll ("Payroll accrues net pay, not gross"). **One helper
unblocks three features.**

### 2.5 A purchase is instantaneous

`PurchasesService.create` writes the bill, moves the stock, books the supplier
credit and posts the voucher in a single transaction. There is no in-transit
state anywhere in the system. `PurchaseOrder` has a `status` string and a
`received_at`, but nothing converts a PO into a `Purchase`.

An LC import spends three to five months between commitment and receipt, with
real money paid out at four or five points along the way. That timeline is the
thing the new module exists to hold.

### 2.6 Master data gaps

- **`Supplier`** (`schema.prisma:1554`) — name, phone, email, address, balance.
  No country, no currency, no bank/SWIFT/beneficiary details. A foreign
  supplier cannot be represented as one.
- **`Product`** (`schema.prisma:1143`) — no HS code, no country of origin, no
  weight or volume. HS code drives the duty rate; weight and CBM are how
  freight is fairly allocated across lines.

### 2.7 Precedents worth copying

- **`MANUFACTURING`** is an existing addon-gated vertical (`AddonModule` +
  `TenantAddonSubscription`). Imports is the same kind of thing — most
  Bangladeshi retailers on this platform never open an LC.
- **`ExpenseClaimAttachment` / `VoucherAttachment`** + `AssetsService.uploadBuffer`
  is the established document-storage pattern (`storage_key`, not a bare URL).
- **`buildPartyLedger`** already gives a per-supplier statement out of any
  control account tagged `PartyType.SUPPLIER`.

---

## 3. Part A — PI to potential customers

**Do not create a `ProformaInvoice` table.** A PI and a quotation differ in
what the document promises, not in what it holds. Model it as a document kind
on `Quotation`.

### 3.1 Migration

```prisma
model Quotation {
  // ...existing
  /// QUOTE | PROFORMA. Drives the number series, the print template and what
  /// the public page calls itself. A quotation can be promoted to a proforma;
  /// the reverse is deliberately not allowed, because a PI may already have an
  /// advance receipted against it.
  doc_kind          String    @default("QUOTE")

  /// Commercial terms. Null on an ordinary quote — these are what make the
  /// document a PI a buyer's bank will accept.
  currency          String    @default("BDT")
  exchange_rate     Decimal?  @db.Decimal(12, 6)
  incoterm          String?   // FOB | CFR | CIF | EXW | DDP
  port_of_loading   String?
  port_of_discharge String?
  payment_terms     String?
  advance_percent   Decimal?  @db.Decimal(5, 2)
  lead_time_days    Int?
  country_of_origin String?
}
```

`@@unique([tenant_id, quote_number, version])` already permits two series side
by side — `QT-2526-0001` and `PI-2526-0001` — with no constraint change.

Beneficiary bank details belong on the **tenant**, not on each document; add
them to `SalesSettings` (`bank_name`, `branch`, `account_name`, `account_number`,
`routing_number`, `swift_code`) so they are typed once.

### 3.2 Backend

- `CreateQuotationDto` gains the fields above; `docKind` decides the number
  prefix in the existing counter logic.
- `PrintDocType` gains `PROFORMA_INVOICE`
  (`apps/backend/src/print-templates/print-templates.dto.ts:22`).
- `ShortLinkEntity` gains `PROFORMA_INVOICE`. Worth the enum value rather than
  reusing `QUOTATION`: "did the buyer open the PI" is a materially different
  sales signal from "did they open a quote", and `ShortLinkClick` already
  captures everything needed to answer it — it just cannot currently separate
  the two.
- Share, revoke, revise, convert-to-order: **no changes.**

### 3.3 Frontend

- `/sales/quotes` gains a doc-kind filter and a "New proforma invoice" action.
  Same list, same detail page, same `ModalShell` share modal.
- `/q/[token]` renders the terms block and the beneficiary bank panel when
  `doc_kind === 'PROFORMA'`, and prices in `currency` via the existing
  `formatCurrency` (this is the one legitimate exception to the `formatBDT()`
  house rule, and it should be written into `docs/ui-design-guidelines.md`
  rather than left as a local deviation).

### 3.4 Advance against a PI

Already a solved path: PI accepted → `convertToOrder` → `OrderDeposit` records
the advance. No new model. The only addition worth making is surfacing
`advance_percent × total` as the suggested deposit amount.

### 3.5 What Part A deliberately does not do

- No PI → LC link. That arrives with Part B (`ImportShipment.customer_pi_id`).
- No customer-side acceptance signature on the public page. The existing
  status flow (`SENT → ACCEPTED`) is staff-driven, and changing that is a
  separate decision about whether an unauthenticated visitor may mutate state.
- No FX revaluation. A PI in USD is a quote in USD; nothing hits the GL until
  it becomes a sale.

---

## 4. Part B — LC imports

### 4.1 The pipeline

```
Customer PI ──┐
              ▼
Supplier PI → PurchaseOrder → ImportShipment ──────────────► Purchase → stock
                              │  LC_APPLIED                    (landed cost)
                              │  LC_ISSUED      + ImportCost rows
                              │  SHIPPED          margin, commission, freight,
                              │  DOCS_RECEIVED    insurance, duty, VAT, AIT,
                              │  CUSTOMS          C&F, port, transport
                              │  RECEIVED
                              ▼  CLOSED
```

### 4.2 New models

```prisma
model ImportShipment {
  id                 String    @id @default(uuid())
  tenant_id          String
  store_id           String
  supplier_id        String?
  purchase_order_id  String?
  /// Set once the shipment is received. This is the join back to the ordinary
  /// purchase pipeline — after it is set, nothing downstream knows or cares
  /// that these goods were imported.
  purchase_id        String?   @unique
  /// The customer PI that justified opening this LC, when there was one.
  customer_pi_id     String?

  reference_number   String    // IMP-2526-0001
  status             String    @default("DRAFT")

  // --- LC ---
  lc_number          String?
  lc_type            String?   // SIGHT | DEFERRED | USANCE
  lc_date            DateTime?
  lc_expiry_date     DateTime?
  latest_shipment_date DateTime?
  bank_name          String?
  bank_branch        String?
  margin_percent     Decimal?  @db.Decimal(5, 2)
  tenor_days         Int?

  // --- FX ---
  currency           String    @default("USD")
  /// Rate booked when the LC opened. Settlement uses the rate on the day and
  /// the difference is realised FX gain/loss — see 4.5.
  fx_rate_at_open    Decimal?  @db.Decimal(12, 6)
  fx_rate_at_settle  Decimal?  @db.Decimal(12, 6)
  invoice_value_fc   Decimal   @default(0) @db.Decimal(14, 2)

  // --- shipment ---
  incoterm           String?
  bl_number          String?
  bl_date            DateTime?
  vessel_name        String?
  port_of_loading    String?
  port_of_discharge  String?
  etd                DateTime?
  eta                DateTime?

  // --- customs ---
  be_number          String?   // Bill of Entry
  be_date            DateTime?
  cf_agent_name      String?

  notes              String?
  created_by         String?
  created_at         DateTime  @default(now())
  updated_at         DateTime  @updatedAt

  @@unique([tenant_id, reference_number])
  @@index([tenant_id, status])
  @@index([tenant_id, lc_number])
}

model ImportShipmentItem {
  id            String  @id @default(uuid())
  shipment_id   String
  product_id    String
  quantity      Int
  /// Unit price in the shipment currency. The BDT figure is derived, never
  /// stored on the line — the rate can change between open and settlement and
  /// a stale stored value would quietly disagree with the voucher.
  unit_price_fc Decimal @db.Decimal(14, 4)
  /// Snapshots, because a product's HS code can be corrected later and this
  /// shipment was assessed under the old one.
  hs_code       String?
  net_weight_kg Decimal? @db.Decimal(12, 3)
  cbm           Decimal? @db.Decimal(12, 4)
  /// Written by the allocation run at receipt. Nullable until then.
  landed_unit_cost Decimal? @db.Decimal(14, 4)
}

model ImportCost {
  id               String   @id @default(uuid())
  tenant_id        String
  shipment_id      String
  /// LC_MARGIN | LC_COMMISSION | BANK_CHARGE | FREIGHT | INSURANCE |
  /// CUSTOMS_DUTY | VAT | AIT | RD | SD | CF_AGENT | PORT | TRANSPORT | OTHER
  cost_type        String
  description      String?
  currency         String   @default("BDT")
  amount           Decimal  @db.Decimal(14, 2)
  fx_rate          Decimal? @db.Decimal(12, 6)
  amount_bdt       Decimal  @db.Decimal(14, 2)
  /// VALUE | QTY | WEIGHT | CBM | MANUAL
  allocation_basis String   @default("VALUE")
  /// False for VAT that is rebatable and AIT that is creditable against
  /// income tax — those are receivables, not product cost. Capitalising them
  /// overstates COGS on every subsequent sale, which is the single most
  /// common landed-cost error.
  is_capitalized   Boolean  @default(true)
  paid_at          DateTime?
  paid_from_account_id String?
  voucher_id       String?
  created_at       DateTime @default(now())

  @@index([tenant_id, shipment_id])
}

model ImportDocument {
  id          String   @id @default(uuid())
  tenant_id   String
  shipment_id String
  /// LC_COPY | COMMERCIAL_INVOICE | PACKING_LIST | BL | COO | INSURANCE |
  /// BILL_OF_ENTRY | RELEASE_ORDER | OTHER
  doc_type    String
  file_name   String
  storage_key String
  mime_type   String?
  file_size   Int?
  uploaded_by String?
  created_at  DateTime @default(now())

  @@index([tenant_id, shipment_id])
}
```

Master-data additions, both small and both needed:

```prisma
model Supplier {
  is_foreign        Boolean @default(false)
  country           String?
  currency          String?
  bank_name         String?
  swift_code        String?
  beneficiary_name  String?
  beneficiary_account String?
}

model Product {
  hs_code           String?
  country_of_origin String?
  net_weight_kg     Decimal? @db.Decimal(12, 3)
  cbm               Decimal? @db.Decimal(12, 4)
}
```

### 4.3 Landed-cost allocation

One pure utility, `apps/backend/src/database/landed-cost.utils.ts`, with no
Prisma dependency so it is unit-testable in isolation (the shape
`schedule.util.ts` already uses in HR):

```ts
allocateLandedCost({
  lines: [{ productId, quantity, baseCostBdt, weightKg?, cbm? }],
  charges: [{ amountBdt, basis: 'VALUE'|'QTY'|'WEIGHT'|'CBM'|'MANUAL', manualSplit? }],
}) => [{ productId, landedUnitCost, allocatedCharges }]
```

Rules that need pinning in tests:

- The last line absorbs the rounding remainder, so allocated charges sum
  **exactly** to the charge total. A per-line round leaks paisa.
- `WEIGHT`/`CBM` fall back to `VALUE` when any line is missing the figure,
  rather than silently allocating zero to it.
- Non-capitalized costs (`is_capitalized: false`) are excluded from allocation
  entirely and posted to their receivable account instead.

**Apply the same utility to ordinary purchases** — pass the allocated result
to `applyInventoryMovement` instead of the raw `item.unitCost`
(`purchases.service.ts:120`). That is the fix for §2.3 and it is worth shipping
on its own, ahead of any LC work.

### 4.4 Chart of accounts

New accounts, following the existing `bootstrap-accounting.ts` code scheme:

| Code | Name | Type | Notes |
|---|---|---|---|
| `1105` | Imports | subgroup, asset | new subgroup under Current Assets |
| `110501` | LC Margin & Advance to Bank | asset | paid at LC opening |
| `110502` | Goods in Transit | asset | accumulates until receipt |
| `110503` | Advance Income Tax (AIT) | asset | creditable, not product cost |
| `110504` | VAT Rebate Receivable | asset | rebatable, not product cost |
| `210106` | LC Acceptance Payable | liability | usance/deferred LC |
| `4xxx/5xxx` | FX Gain / Loss | revenue / expense | realised at settlement |

`110501`–`110504` are ordinary accounts, not control accounts — none of them
needs a party dimension, since the counterparty is the bank and there is one
bank per LC, already named on the shipment.

### 4.5 Posting

**Prerequisite: a multi-leg posting helper.** Add `postMultiLeg()` alongside
`autoPostFromRules` in `apps/backend/src/accounting/posting.utils.ts`, taking
`{ legs: [{ accountId, debit, credit, partyType?, partyId? }] }` and reusing the
existing `PostingEvent` row, idempotency key, voucher numbering and
`approval_status` handling. `createVoucher` already proves the N-line write
works; this is about giving modules the same guarantees the two-leg path has.

The journals, in order:

| Event | Entry |
|---|---|
| LC opened | Dr `LC Margin` / Cr Bank — plus commission and charges to expense |
| Payments abroad | Dr `Goods in Transit` / Cr `LC Margin`, Cr Bank (or Cr `LC Acceptance Payable` on usance) |
| Duty & VAT at customs | Dr `Goods in Transit` (duty, RD, SD) / Dr `VAT Rebate Receivable` / Dr `AIT` / Cr Bank |
| C&F, port, transport | Dr `Goods in Transit` / Cr payable or Cr Bank |
| **Receipt** | Dr Inventory (landed) / Cr `Goods in Transit` — emits the `Purchase` |
| Usance settlement | Dr `LC Acceptance Payable` / Cr Bank / Dr-or-Cr `FX Gain / Loss` |

The receipt entry is the one that must balance to the paisa against
`Goods in Transit`, which is why the allocation utility owns the rounding
remainder rather than each line rounding independently.

### 4.6 FX scope — deliberately narrow

**The GL stays BDT.** Foreign amounts live on the import documents
(`ImportShipment`, `ImportCost`) with an explicit rate; every voucher line is
translated at write time. Realised FX gain/loss is recognised only on
settlement of a usance LC, where the rate genuinely differs from the rate the
liability was booked at.

What this deliberately excludes: multi-currency GL accounts, period-end
revaluation of open FX balances, and multi-currency sales. Those are a
different and much larger project, and no Bangladeshi importer needs them to
run an import business — they invoice their own customers in BDT.

### 4.7 Module surface

`apps/backend/src/imports/` — `ImportsModule`, service, controller,
`landed-cost.utils.ts` in `database/`, mirroring how `manufacturing` is laid
out.

Endpoints follow the existing REST shape: CRUD on shipments, `POST
/imports/:id/costs`, `POST /imports/:id/documents`, `PATCH /imports/:id/status`,
`POST /imports/:id/receive` (the one that emits the `Purchase`),
`GET /imports/:id/cost-sheet`.

### 4.8 Permissions, navigation, packaging

- **Permissions** — `VIEW_IMPORTS`, `MANAGE_IMPORTS`, `MANAGE_IMPORT_COSTS` on
  the `StorePermission` enum plus `ROLE_DEFAULT_PERMISSIONS`. The third is
  separate on purpose: adding an import cost moves COGS on every future sale of
  those goods, which is a finance action, not a warehouse one.
  A **new** `PERMISSION_BACKFILL_GROUPS` entry is required — an existing group
  that has already reconciled will never pick up a new permission (see the
  header comment in `sync-role-permissions.ts:35-45`).
- **Navigation** — a `purchase.imports` subgroup in `NAV_REGISTRY`
  (`packages/shared-types/navigation.ts:99-114`) with LC Register, Shipments in
  Transit, Landed Cost Sheet. **Then run
  `npx tsx prisma/sync-nav-layout.ts --nodes=purchase.imports,...`** — saved
  layouts are returned verbatim and will not otherwise show it.
- **Packaging** — register an `IMPORTS` `AddonModule`, gated the way
  `manufacturing` gates itself.

### 4.9 Reports worth building

- **LC register** — open LCs, value, expiry, latest shipment date, days to
  expiry. An expired LC is a real loss and nothing else in the system watches
  the date.
- **Landed cost sheet** per shipment — invoice value, every charge, the
  allocation, cost per unit. This is the document an importer already keeps in
  a spreadsheet and the single most valuable screen in the module.
- **Duty and tax paid** by period, for the VAT return.
- **Bank limit utilisation** — how much LC exposure is outstanding per bank.

---

## 5. Phasing

| Phase | Contents | Depends on |
|---|---|---|
| **1** | PI to customers (§3) | nothing |
| **2** | `landed-cost.utils.ts` + wire into `PurchasesService` — fixes the dropped freight | nothing |
| **3** | `postMultiLeg()` in `posting.utils.ts` | nothing |
| **4** | `ImportShipment` / `ImportCost` / `ImportDocument`, status machine, receive → `Purchase`, COA, permissions, nav, addon | 2, 3 |
| **5** | FX settlement, LC register, cost sheet, duty report, bank limits | 4 |

Phases 1–3 are independently shippable and each has value without the others.
Phase 2 in particular is a correctness fix that every existing tenant with a
freight charge benefits from today.

---

## 6. Open questions

1. **Does an import always land in one store?** `Purchase` requires a
   `store_id`. A container split across branches would need either several
   purchases from one shipment or a receipt into a central warehouse followed
   by transfers. The second is simpler and matches how importers actually
   work — but it should be a deliberate choice, not a default that falls out of
   the schema.
2. **Partial shipments against one LC.** One LC frequently covers two or three
   shipments. The model above assumes one shipment per LC file. Supporting
   partials means either allowing several `ImportShipment` rows to share an
   `lc_number`, or splitting an `LetterOfCredit` parent above the shipment. The
   latter is correct and heavier; recommend starting with the shared
   `lc_number` and an index, then splitting if tenants actually need it.
3. **Who may revise a landed cost after receipt?** A C&F bill often arrives
   weeks after the goods. Re-allocating changes `avg_cost` retroactively, which
   changes historical margin. Options are: refuse (post the late charge to
   expense), allow with an audit trail and a cost-adjustment voucher, or allow
   only before the period is closed. `FiscalPeriod` already exists, which makes
   the third option cheap.
4. **Should a customer PI in USD be allowed at all?** Part A permits it, but
   nothing downstream converts — a PI in USD accepted and converted to a
   `SalesOrder` would carry a USD `total_amount` into a BDT ledger. Either
   restrict the sales side to BDT, or fix the rate at conversion. Recommend
   fixing the rate at conversion and storing it on the order.

---

## 7. What changed between the proposal and the build

Four things, none of which alters the shape above.

**`delivery_lead_time_days`, not `lead_time_days`.** §3.1 named the column
`lead_time_days`. The public-quotation DTO spec — whose job is to fail when the
customer-facing allow-list widens — caught the collision with
`Product.lead_time_days`, which is the tenant's own replenishment lead time and
must never reach a page a stranger can open. Two fields a join apart with the
same name eventually get copied into each other.

**A `DocumentSequence` table, which the plan did not mention.** §3.1 assumed the
existing quotation numbering would do. It would not: `QT-${Date.now()}` is epoch
millis, which tells a shop owner nothing, and the `count() + 1` pattern used
elsewhere reissues a number when a row is deleted — which quotations can be. One
small table serves both the PI series and the import series.

**`ImportShipmentItem` carries snapshots.** Not in the proposal. A product's HS
code can be corrected later, but the shipment was assessed under the old one, and
a reclassification must not retroactively rewrite how past entries were assessed.
Same argument for weight and CBM, which a particular shipment can legitimately
differ on.

**The posting contract gained a third expectation.** §4.5 said only that
`postMultiLeg` was needed. In practice `posting-contract.ts` knew `'rule'` and
`'skip'`, and an import event is neither: it posts, but through no rule at all.
Left unclassified it would have been invisible to the guard; classified as
`'rule'` it would have demanded a default rule that must not exist. The new
`'multi-leg'` expectation asserts the thing that actually matters — that no rule,
and in particular no `condition_key: 'none'` fallback, ever shadows one of these
events. A fallback there would quietly post a two-line voucher for an entry that
needs five.

### One question the plan asked, now answered

§6.4 asked whether a customer PI may be denominated in USD at all. It may.
`convertToOrder` translates at the rate written on the document and returns
`exchange_rate_applied` on the order. Fixing the rate at conversion rather than
reading a live one is deliberate: the order total has to match the proforma the
customer signed, which is the one number they will check.

The other three — multi-store landing, partial shipments against one LC, and who
may revise a landed cost after receipt — are still open, and are now entries in
`TODO.md` rather than questions here. The third is the one that will bite first:
`assertOpen` refuses any cost change after receipt, which is right in principle
and wrong for the C&F bill that routinely arrives weeks after the goods.
