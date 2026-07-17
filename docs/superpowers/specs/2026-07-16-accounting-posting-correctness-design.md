# Accounting Posting Correctness — Design

**Date:** 2026-07-16
**Status:** Approved, ready for implementation planning
**Blocks:** `docs/superpowers/specs/2026-07-16-six-month-demo-data-design.md`

## Problem

`bootstrapDefaultAccountingForTenant` (`packages/database/prisma/bootstrap-accounting.ts`) provisions
the default chart of accounts and posting rules for **every real tenant** and for the demo sandbox. Its
rule set does not match what the calling services actually emit. Because `autoPostFromRules` falls
back to a `condition_key: 'none'` rule when no exact match exists, the mismatches do not fail loudly —
three of them post **fabricated vouchers**, and two post **nothing**.

| Caller | Emits | Today's outcome |
|---|---|---|
| `warehouse-transfers.service.ts:131` | `fund_movement` / `transfer_scope` / `inter_store`\|`intra_store` | Falls back → **Dr Main Bank Account, Cr Cash in Hand** for a pure stock movement. Fabricates money that never moved. |
| `stock-takes.service.ts:190` | `inventory_adjustment` / `reason_type` / `DISCREPANCY` | Falls back → **Dr General Operating Expense, Cr Cash in Hand** for a physical count variance. |
| `inventory-shrinkage.service.ts:69` | `inventory_adjustment` / `reason_type` / *any reason code* | Falls back → same. Written-off stock drains the cash ledger. |
| `sales.service.ts:289` | `sale` / `payment_mode` / `credit` | No rule → **silently skipped**. Credit sales post no receivable. |
| `customers.service.ts:566,669` | `customer_payment` / `payment_direction` / `receive`\|`pay` | **Silently skipped** — `ensureCustomerPaymentPostingSetup` returns early because the template never creates an account named `Accounts Receivable`. |

This was found while planning the six-month demo-data work, which cannot produce a trustworthy trial
balance on this foundation.

### Root cause

Two divergent bootstraps. `seed.ts` calls `bootstrapDefaultAccountingForTenant` and then bolts on its
own accounts and rules (`seed.ts:960-1100`). The two drifted. The comment at `seed.ts:1038` shows a
previous author half-knew — it says the bootstrap "leaves [these] unmatched, causing those events to
be skipped". They did not realise the `none` fallback makes them post fiction instead of skipping.

### `seed.ts` is not the reference — it is also wrong

The obvious fix ("copy seed.ts's rules into the bootstrap") is wrong, because nobody ever checked
`seed.ts`'s `condition_value`s against what callers emit. Its rules are substantially dead:

- `classifyPaymentMode` (`sales.service.ts:268-284`) collapses `bkash`/`nagad`/`rocket`/`card`/`wallet`
  all into `'bank'`. No caller ever emits `'bkash'`, `'nagad'` or `'rocket'`, so `seed.ts`'s
  mobile-wallet rules can never fire and its bKash/Nagad/Rocket accounts receive nothing.
- `sales-returns.service.ts:94` hardcodes `'cash'`, so `seed.ts`'s `sale_return`/`credit` rule is dead.
- `purchases.service.ts:140` hardcodes `'credit'`, so the `purchase`/`cash` and `purchase`/`bank` rules
  are dead.
- `Rocket` is not in `DEFAULT_PAYMENT_METHODS` at all (`payment-method.seed.ts`), making its rule
  doubly dead.

### The incoherent inventory model

Purchases post *Dr General Operating Expense, Cr Cash/Payable* — **periodic** inventory, where stock is
expensed on receipt. But the accounts and rules `seed.ts` adds (Stock on Hand, Goods in Transit, COGS,
"Dr COGS / Cr Stock on Hand" for stock takes) assume **perpetual** inventory. Nothing anywhere ever
*debits* Stock on Hand, so under those rules the asset only ever goes negative. The two models are
mixed and neither is complete.

This decides what "correct" means for transfers and shrinkage — see Decisions.

### Account code collisions

`code` is nullable and **not** unique (`Account` is unique on `[tenant_id, name]` only), so these are
silent duplicates rather than errors. Both land on the same tenant, since `seed.ts` layers its accounts
on top of the bootstrap's:

- `1030` — Accounts Receivable (`seed.ts`) vs Loans Receivable (bootstrap)
- `1040` — Stock on Hand (`seed.ts`) vs Due from Branches (bootstrap)

## Decisions

| Decision | Choice |
|---|---|
| Inventory model | **Periodic** — commit to what the system actually does |
| Transfers / shrinkage / stock takes | **Post nothing** — delete the harmful `none` fallbacks |
| Mobile wallets | **Make them work** — stop collapsing bkash/nagad into `bank` |
| Rocket | Drop — not a default payment method |
| Source of truth | `bootstrap-accounting.ts` only; `seed.ts` stops defining accounting |
| Existing fabricated vouchers | **Delete** via `voidAutoPostedVoucher`, with audit log + dry run |
| Fiscal period locks | Enforce in this project |
| `PaymentMethod.account_id` posting | Out of scope — logged as follow-up |

### Why periodic

Under periodic inventory, moving your own stock between your own warehouses is **not an economic
event**, and written-off stock was **already expensed at purchase**. So the correct entry for
transfers, shrinkage and stock-take variances is *no entry*. The fix is to **delete** the
`fund_movement`/`none` and `inventory_adjustment`/`none` fallback rules, not to replace them.

Perpetual was considered and rejected for this project: it would require purchases to debit Stock on
Hand and every sale to post a second COGS event (Dr COGS / Cr Stock on Hand from `unit_cost_at_sale`),
because `autoPostFromRules` writes exactly **two** `VoucherDetail` rows per voucher and cannot express
a multi-leg entry. That is a large accounting redesign changing every tenant's books, and belongs in
its own project.

Services keep calling `autoPostFromRules` and simply receive `postingStatus: 'skipped'`. This is
honest, and leaves the door open: `PostingRule` is tenant-configurable, so a tenant running perpetual
can define their own rules.

## The target rule set

Organizing principle: **derive the rules from what callers actually emit**, not from `seed.ts`.
Failing to do that is what produced the dead rules.

| Event | Condition key | Values emitted | Rule |
|---|---|---|---|
| `sale` | `payment_mode` | `cash` | Dr Cash in Hand, Cr Sales Revenue |
| | | `bank` (incl. card) | Dr Main Bank Account, Cr Sales Revenue |
| | | `bkash` *(new)* | Dr bKash Account, Cr Sales Revenue |
| | | `nagad` *(new)* | Dr Nagad Account, Cr Sales Revenue |
| | | `credit` *(new)* | Dr Accounts Receivable, Cr Sales Revenue |
| `sale_return` | `payment_mode` | same set (after caller fix) | mirror of `sale` |
| `purchase` | `payment_mode` | `credit` only — see note below | Dr Purchases, Cr Purchase Payable |
| `purchase_return` | `none` | `null` | Dr Purchase Payable, Cr Purchases |
| `expense` | `payment_mode` | `cash` / `bank` | unchanged |
| `customer_payment` | `payment_direction` | `receive` / `pay` | Dr Cash, Cr Accounts Receivable (and reverse) |
| `loan_disbursement`, `loan_repayment` | `loan_direction` | `PAYABLE` / `RECEIVABLE` | unchanged |
| `fund_movement` | `transfer_scope` | `inter_store` / `intra_store` | **no rule — skips** |
| `inventory_adjustment` | `reason_type` | any reason code | **no rule — skips** |

### Chart of accounts changes

- **Add** `Accounts Receivable` (`1030`), under a new `Receivables` subgroup of Current Assets. This
  alone also fixes customer payments, since `ensureCustomerPaymentPostingSetup` is already wired
  correctly at both call sites and only fails on the missing account.
- **Add** `bKash Account` (`1015`) and `Nagad Account` (`1016`) under Cash and Bank.
- **Add** `Purchases` (`5015`) under Operating Expenses. Purchases currently debit *General Operating
  Expense*, lumping stock buys with rent and utilities and making the P&L nearly meaningless.
  Code `5015` is deliberate, **not** `5020`: tenants already seeded by `seed.ts` have a
  `Cost of Goods Sold` account at `5020`, and reusing it would introduce exactly the kind of duplicate
  code this spec removes.
  **Accepted tradeoff:** existing tenants get a history split — purchases before the change sit in
  General Operating Expense, after it in Purchases. No data migration; the split is documented.
- **Move** `Loans Receivable` from `1030` to `1035`, freeing `1030` for the conventional AR slot.
  Because the bootstrap upserts by name and writes `code` on update, this propagates to existing
  tenants automatically. No posting rule references a code — only account ids.
- **Stop creating** `Stock on Hand`, `Goods in Transit`, `Cost of Goods Sold` and `Rocket Account`.
  Unused under periodic; dropping them dissolves the `1040` collision. Existing rows are left in place
  (an account with vouchers cannot be deleted); they simply stop being provisioned.

## Single source of truth

`bootstrap-accounting.ts` becomes the only definition of the default chart of accounts and posting
rules. `seed.ts` keeps calling it and stops defining accounting of its own — the "Additional Accounts"
and "Additional Posting Rules" blocks (`seed.ts:960-1100`) are deleted, with the wallet accounts worth
keeping moved into `DEFAULT_ACCOUNTING_TEMPLATE`.

## Caller fixes

- **`classifyPaymentMode`** (`sales.service.ts:268`) stops collapsing wallets: `bkash` and `nagad`
  become their own modes; `card` and `bank` keep mapping to `bank`; everything else stays `cash`.
- **`sales-returns.service.ts:94`** stops hardcoding `'cash'` and classifies from the original sale —
  a credit sale's return credits Accounts Receivable. Today it posts *Dr Sales Revenue, Cr Cash*,
  refunding cash that was never received. This overlaps the returns fixes already logged in the
  demo-data spec; they land together.
- **`purchases.service.ts:140`** keeps `'credit'` — corrected during planning. An earlier draft of this
  spec called for classifying from `paid_amount` vs `total_amount`; that is impossible.
  `CreatePurchaseDto` has no `paidAmount` field, `tx.purchase.create` (`:75`) never writes
  `paid_amount` (schema default `0`), and the service always books the full total as
  `CREDIT_PURCHASE`. A purchase is *always* a payable in this data model, so classifying would return
  `'credit'` every time — identical to the hardcode, with more code.

  So `purchase`/`cash` and `purchase`/`bank` are unreachable **by construction**, not merely by the
  hardcode, and the target rule set above deliberately omits them. Recording a cash purchase is a
  two-step flow (purchase, then supplier payment), which is coherent double-entry and out of scope.
  The work only adds a comment explaining this, so the next reader doesn't "fix" it.

### Out of scope: `PaymentMethod.account_id`

The column exists, is settable through the payment-methods admin UI, and is documented as *"Links to
Account for posting"* — but is **never read by the posting path**. `sales.service.ts:150` takes
`account_id` from the client DTO instead.

This is the right long-term design: substring-matching a user-editable name is inherently fragile, and
a tenant whose payment method is named "Upay" silently posts to Cash in Hand today. But it changes
`autoPostFromRules`'s account-resolution contract (rules-only, no override), so it gets its own design.
Logged as a follow-up along with the custom-payment-method bug.

## Fiscal period enforcement

`is_locked` is currently written only by the lock/unlock endpoints (`accounting.service.ts:1964`) and
read by nothing — locking a period does nothing today.

`autoPostFromRules` and `AccountingService.createVoucher` will look up the `FiscalPeriod` covering the
voucher date and throw when it is locked.

**Interaction with the repair:** the repair script deletes via raw Prisma, below this guard, so it is
not blocked by locked periods. This is deliberate, noted in the script, and makes the two safe to land
in either order.

## The repair script

`packages/database/prisma/repair-fabricated-vouchers.ts`, following the existing
`backfill-voucher-store-id.ts` shape: `--dry-run` and `--tenant=` flags, per-tenant stats, console
report.

**Identification.** `PostingRule` is tenant-configurable, so a tenant may have deliberately configured
correct transfer postings; matching on `source_type` alone would destroy those. The test is two-part:

1. `source_type` is one of `transfer`, `shrinkage`, `stock_take_adjustment`; **and**
2. the voucher's two `VoucherDetail` rows point at exactly the fallback rule's accounts —
   *Dr Main Bank Account, Cr Cash in Hand* for `transfer`; *Dr General Operating Expense, Cr Cash in
   Hand* for `shrinkage` and `stock_take_adjustment`.

Only that combination is the fingerprint of the `none` fallback firing. Anything else is left alone.

**Deletion** goes through the existing `voidAutoPostedVoucher` (`posting.utils.ts:290`), which removes
the voucher, its details and the posting event. Event type is mapped back from `source_type`:
`transfer` → `fund_movement`; `shrinkage` and `stock_take_adjustment` → `inventory_adjustment`.

Each deletion writes an `AuditLog` row recording voucher number, date, amount and accounts, so the
removal is itself auditable.

**Accepted consequence:** reports for past periods will change. That is the point — they were wrong.

## Testing

**The contract test is the important one**, and it is what would have caught this entire class of bug:

> Every `(eventType, conditionKey, conditionValue)` tuple any caller can emit must either resolve to a
> bootstrap rule or appear in an explicit, documented skip list. And in the other direction: every
> bootstrap rule must be reachable by some caller tuple.

Tuples are enumerated from the callers, rules from the template. The first direction kills the
fabricated-voucher class; the second kills the dead-rule class.

Also:

- No two accounts share a code within a tenant.
- The fiscal-lock guard rejects a posting dated into a locked period.
- Repair script: dry-run mutates nothing; fingerprint matching deletes only fallback-posted vouchers;
  tenant-configured vouchers are preserved.

**Fix the mock that hid this.** `customers.service.spec.ts:17` mocks `autoPostFromRules` to always
return `posted`. That mock is precisely why nobody noticed customer payments never post.

## Follow-ups (not in scope)

- Wire `PaymentMethod.account_id` into posting; fix custom payment methods silently posting to cash.
- Perpetual inventory accounting (needs multi-leg vouchers or a second COGS event per sale).
- `inventory-shrinkage.service.ts` uses `product.price` (selling price) as `unitCost` on the movement.
- `suppliers.service.recordCreditPayment` (`:611`) never posts to accounting, unlike the customer
  equivalent. **Consequence: Purchase Payable never clears in the ledger.** Purchases post
  Dr Purchases / Cr Purchase Payable, but paying the supplier moves `due_balance` without a voucher,
  so the payable grows forever.
- Purchases cannot record a payment at all (`CreatePurchaseDto` has no `paidAmount`). Adding it needs
  the supplier credit transaction to book only the unpaid remainder.
