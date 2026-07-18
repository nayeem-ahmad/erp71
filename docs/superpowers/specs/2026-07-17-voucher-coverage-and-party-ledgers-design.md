# Voucher Coverage & Party Ledgers — Design

**Date:** 2026-07-17
**Status:** Draft — two decisions open (see `Open decisions`)
**Builds on:** `docs/superpowers/specs/2026-07-16-accounting-posting-correctness-design.md`

## Goal

Every transaction involving an item of monetary value creates a voucher, by default, for every
tenant. Tenants may override the rules; they may not silently end up with none.

Corollary: every customer, supplier and employee has an accounting ledger derived from the general
ledger — not a parallel table that can drift from it.

## Problem

The 2026-07-16 work fixed the rules that *existing callers* emit. It did not ask which callers
should exist. Five modules move real money and write no voucher at all:

| Module | Money movement | Evidence |
|---|---|---|
| Supplier payments | `SupplierCreditTransaction` + `due_balance` | `suppliers.service.ts:611` — no posting code in the file |
| Fixed-asset depreciation | `depreciation_amount` + `accumulated_depreciation` | `accounting.service.ts:2303` |
| Salary payments | `amount` paid, `payment_method` | `salary-payments.service.ts:72` |
| Sales-order deposits | `OrderDeposit.amount` — customer cash received | `sales-orders.service.ts:119` |
| Cashier `PAYOUT` / `LOAN` | cash out of the drawer | `cashier-sessions.service.ts:133` |

Net effect: Purchase Payable grows forever (nothing debits it), and payroll + depreciation never
reach the P&L. **Reported profit is overstated on every tenant.**

Depreciation is the clearest case, because the schema proves the voucher was intended and never
wired: `AssetDepreciationEntry.voucher_id` (`schema.prisma:2751`) is declared and never written, and
`FixedAsset.asset_account_id` / `depreciation_account_id` are captured at `accounting.service.ts:2255-2256`
and **read by nothing**. There is also no Fixed Assets account in the template for them to point at.

### Why the contract test did not catch this

`POSTING_CONTRACT` (`apps/backend/src/accounting/posting-contract.ts`) validates that every tuple a
service *does* emit has a matching rule. It is a registry of **calls that exist**. A module that
never calls `autoPostFromRules` is invisible to it. It cannot catch this bug class — that is the
systemic hole behind all five gaps, and Phase 7 is the fix.

Related: `fund-transfers.service.ts:46` hand-rolls `tx.voucher.create` directly. It posts correctly
and honours fiscal locks, but creates no `PostingEvent`, so it is invisible to the registry, gets
none of `autoPostFromRules`' idempotency, and cannot be reconciled. Naming trap: the `fund_movement`
event type is emitted by **warehouse-transfers** (stock), not **fund-transfers** (cash).

### Party ledgers are parallel, not derived

Customers and suppliers already have a ledger — in the wrong place:

- `CustomerCreditTransaction` / `SupplierCreditTransaction` carry `amount` + `balance_after`, plus a
  denormalized `due_balance` on the party row. The customer-ledger page reads this
  (`api.getCustomerCreditLedger`), **not** the GL.
- The GL has one `Accounts Receivable` (1030) and one `Purchase Payable` (2010) aggregating every party.
- Nothing links them. Two independent sources of truth that can silently diverge. The demo-data
  spec's "customer due == signed ledger" invariant compares `due_balance` to
  `CustomerCreditTransaction` — the parallel ledger against itself, never against the control account.

Employees have neither: no `due_balance`, no ledger table, only `basic_salary` + `SalaryPayment`.

### The live bug this also fixes

`bootstrapDefaultAccountingForTenant` runs **only at tenant creation** (`auth.service.ts:591`,
`admin-tenants.service.ts:781`). No backfill exists. Commit `9ffb067` (2026-07-16) added the
`bkash` / `nagad` / `credit` rules *and* fixed `classifyPaymentMode` to stop collapsing wallets into
`bank` — so on any tenant created before that date, a bKash sale now classifies as `bkash`, finds no
rule, and posts nothing. Cash and card sales still post. That is the observed "some Skipped, some
Posted" split in the sales list.

## Decisions

**D1 — Periodic inventory retained.** Warehouse transfers, stock takes and shrinkage correctly post
nothing; stock is expensed at purchase. Unchanged from the 2026-07-16 spec. A `none` fallback there
is what fabricated the Dr Bank / Cr Cash vouchers.

**D2 — Advances are real posting accounts, not a presentation bucket.** A sales-order deposit posts
`Dr <mode> / Cr Customer Advances (2030)`; a supplier advance posts `Dr Advances to Suppliers (1045)
/ Cr <mode>`. A **settlement** entry then moves the advance into AR/AP when the sale or bill is
booked.

The alternative considered and rejected: post deposits straight to AR/AP with a party tag, letting
the party account net continuously, and reclassify credit-balance parties to "Advances" for
presentation only. That needs no settlement flow and cannot strand. It was rejected in favour of a
textbook-correct balance sheet with no reclassification step.

**Consequence, accepted:** `SalesOrder` is never converted into a `Sale` anywhere in the codebase —
`sales.service.ts` never references `salesOrder` or `orderDeposit`. D2 therefore *requires* building
that conversion flow (Phase 5). Until it ships, an advance is recorded but never clears. Note the
books are not wrong in aggregate meanwhile — Customer Advances (liability) and AR (asset) are both
real and net correctly; the presentation is grossed-up rather than netted, and the advance stays
open. Conservative, but it must not be left there.

**D4 — Employee payables are IN, via monthly salary accrual.** Salary accrues monthly to a payable;
employee payments settle it. This makes all three party types structurally identical, so the Phase 3
party dimension covers employees with no extra machinery:

| Party | Control account | Advance account | Accrues on | Settles on |
|---|---|---|---|---|
| Customer | Accounts Receivable (1030) | Customer Advances (2030) | sale | customer payment |
| Supplier | Purchase Payable (2010) | Advances to Suppliers (1045) | purchase | supplier payment |
| Employee | Salary Payable (2050) | Staff Advances (1060) | salary accrual | employee payment |

A salary advance is the same shape as D2's advance settlement — `Dr Staff Advances / Cr <mode>`, later
cleared `Dr Salary Payable / Cr Staff Advances`. Account 1060 therefore serves both the cashier `LOAN`
case and employee advances.

**D3 — Control account + party dimension, not an Account row per party.** `Account.party_type` marks
1030 / 2010 / 2050 as control accounts; `VoucherDetail` gains `party_type` + `party_id`.

Rejected: an `Account` row per customer/supplier/employee. `autoPostFromRules` resolves accounts
statically from `PostingRule.debit_account_id` — one rule, one fixed account — so per-party accounts
would need dynamic resolution on every rule and would grow the chart to thousands of rows, unusable
for the retailers this targets. Control-account-plus-dimension is what Tally and ERPNext do and fits
the engine that exists. Precedent: `VoucherDetail.cost_center_id` is already an optional dimension on
voucher lines with its own index; this mirrors it exactly.

## Phase 0 — Make bootstrap reach existing tenants — **BUILT 2026-07-17**

**This must land first, and it is not optional.** Adding new default rules while the bootstrap only
runs at tenant creation would silently skip all of them on every existing tenant — reproducing the
`9ffb067` bug at five times the scale.

Delivered:

- `packages/database/prisma/sync-accounting.ts` — `npm run sync:accounting`, with `--dry-run` and
  `--tenant=<uuid>`. Additive-only and idempotent, so it is safe to re-run.
- `packages/database/prisma/sync-accounting.utils.ts` — the testable core, split out the way
  `repair-fabricated-vouchers.utils.ts` is.
- `apps/backend/src/accounting/sync-accounting.spec.ts` — 9 tests.

### Two corrections to the original plan

**1. It hooks the backend Dockerfile CMD, not `scripts/deploy.sh`.** The plan said "wire into
deploy.sh after migrations". There is no migration step in `deploy.sh` — this project uses
`prisma db push`, run from the backend container's CMD on every start. So sync joins that chain:

```sh
db push && db:seed && sync:accounting && node main.js
```

After `db:seed`, so it also covers anything the seed just created. It joins the `&&` chain
deliberately: a failure means tenants would post against a stale rule set, which must be loud rather
than skipped. `db:seed` already gates startup the same way, and `tsx` is present in the production
image (`npm ci --include=optional`, no `--omit=dev`), so the precedent holds.

**2. Re-running the bootstrap is NOT sufficient.** `bootstrapDefaultAccountingForTenant` calls
`ensureLoanPostingSetup` and `ensureInterBranchAccounts` but **not**
`ensureCustomerPaymentPostingSetup`. Customer-payment rules are otherwise provisioned lazily, on a
tenant's first customer payment (`customers.service.ts:564,643`), so a tenant that has never taken
one has no rules for it at all. `applySync` therefore calls it explicitly, and *after* the bootstrap,
because it returns silently when no `Accounts Receivable` account exists — running it first would
no-op on exactly the stale tenants this script exists to repair. Both facts are pinned by tests.

**Finding: all three local tenants were missing `customer_payment` rules entirely.** Not part of the
bKash/Nagad regression — an independent gap, invisible until sync enumerated it.

### On the dry run

The preview does not name-diff against `DEFAULT_POSTING_RULES`. The loan, inter-branch and
customer-payment rules are created by the ensure\* helpers rather than declared in that array, so a
name-diff silently under-reports them — the first implementation promised "nothing to do" and then a
live run wrote 2 rules to each of 3 tenants. Instead `previewTenant` performs a **real sync inside a
transaction and rolls it back**, which is accurate by construction. Deltas are sorted, because Set
iteration order differs between the rolled-back and live transactions and an operator diffing the two
outputs must not see phantom discrepancies.

### Verified against a real database

Simulated a pre-2026-07-16 tenant by deleting the bKash/Nagad accounts + rules and the
customer-payment rules, then:

- dry run named exactly the 2 accounts and 6 rules missing, and touched only the drifted tenant;
- the database was confirmed unchanged after the dry run;
- the live run's output matched the dry run byte-for-byte;
- a second live run was a clean no-op (idempotent);
- unknown `--tenant=` exits 1; success exits 0 (required by the `&&` chain).

Full backend suite green: 99 suites / 1294 tests. `tsc --noEmit` shows only the 3 known pre-existing
errors, none in the new files.

**Still to do:** run `--dry-run` against production, review, then live. Until then the live
bKash/Nagad bug persists on prod.

## Phase 1 — Chart of accounts

New group **Non-Current Assets** (none exists today):

| Code | Account | Type | Needed by | Status |
|---|---|---|---|---|
| 1045 | Advances to Suppliers | ASSET | supplier advances (D2) | pending |
| 1050 | Fixed Assets | ASSET | depreciation | **LANDED 2026-07-18** |
| 1055 | Accumulated Depreciation | ASSET (contra) | depreciation | **LANDED 2026-07-18** |
| 1060 | Staff Advances | ASSET | cashier `LOAN` + employee salary advances (D4) | **LANDED 2026-07-18** (plain account — see note) |
| 2030 | Customer Advances | LIABILITY | order deposits (D2) | pending |
| 2050 | Salary Payable | LIABILITY | employee payables (D4) | **LANDED 2026-07-18** |
| 5020 | Salary & Wages | EXPENSE | salary payments | **LANDED 2026-07-18** |
| 5030 | Depreciation Expense | EXPENSE | depreciation | **LANDED 2026-07-18** |
| 5040 | Cash Shortage / Overage | EXPENSE | till reconciliation | pending |

`Account.party_type` and the 1030/2010 marks landed with Phase 3.

## Phase 2 — Event types and default rules

Extend `PostingEventType` (`posting.utils.ts:5`), add matching `VOUCHER_TYPE_BY_EVENT` entries, and
add to `DEFAULT_POSTING_RULES`:

**`supplier_payment` LANDED 2026-07-17** — but keyed on `payment_direction`, not `payment_mode`.
A third correction to this plan: `SupplierCreditTransaction` has **no `payment_method` column**, so
there is no mode to read and `payment_mode × cash/bank/bkash/nagad` is not implementable. It mirrors
`customer_payment` instead, which already hardcodes Cash in Hand for the same reason:

| Event | Condition | Dr / Cr |
|---|---|---|
| `supplier_payment` | `payment_direction` × pay | Purchase Payable / Cash in Hand |
| `supplier_payment` | `payment_direction` × receive | Cash in Hand / Purchase Payable |

`pay` / `receive` mirror `dueDelta` in `suppliers.service.ts` (PAYMENT reduces the payable, PAYOUT
increases it), so the voucher and `due_balance` cannot move in opposite directions. Unlike
`customer_payment` these live in `DEFAULT_POSTING_RULES` rather than a lazy `ensure*` helper — the
bootstrap creates Purchase Payable and Cash in Hand unconditionally, so there is nothing to provision
lazily around. Resolving the counter-account from the payment method is the existing
`PaymentMethod.account_id` follow-up in TODO.md.

Remaining, not yet built:

| Event | Condition | Dr / Cr |
|---|---|---|
| `supplier_advance` | `payment_mode` × cash/bank/bkash/nagad | Advances to Suppliers / \<mode\> |
| `order_deposit` | `payment_mode` × cash/bank/bkash/nagad | \<mode\> / Customer Advances |
| `advance_settlement` | `party_type` × customer | Customer Advances / Accounts Receivable |
| `advance_settlement` | `party_type` × supplier | Purchase Payable / Advances to Suppliers |
| `depreciation` | `none` | Depreciation Expense / Accumulated Depreciation — **LANDED 2026-07-18** |
| `cash_transaction` | `reason_type` × PAYOUT | General Operating Expense / Cash in Hand — **LANDED 2026-07-18** |
| `cash_transaction` | `reason_type` × LOAN | Staff Advances / Cash in Hand — **LANDED 2026-07-18** |
| `salary_accrual` | `none` | Salary & Wages / Salary Payable — **LANDED 2026-07-18** |
| `salary_payment` | `payment_mode` × cash/bank/bkash/nagad | Salary Payable / \<mode\> — **LANDED 2026-07-18** |
| `employee_advance` | `payment_mode` × cash/bank/bkash/nagad | Staff Advances / \<mode\> |
| `advance_settlement` | `party_type` × employee | Salary Payable / Staff Advances |

`supplier_payment` closes the "Purchase Payable never clears" hole (TODO.md:193).

Cashier `DROP` stays unposted: cash moving drawer → safe is Cash in Hand on both sides. Revisit only
if those are ever tracked as separate accounts.

**Fold in the lazy provisioners.** `ensureCustomerPaymentPostingSetup` and `ensureLoanPostingSetup`
are a second, parallel mechanism for creating rules — the reason those tuples are marked
`expectation: 'skip'` in the contract and dodge the guard. Requirement is that rules are
default-provisioned and tenant-overridable, which means one mechanism. Once Phase 0 makes bootstrap
re-runnable, these move into `DEFAULT_POSTING_RULES` and the lazy path is deleted.

## Phase 3 — Party dimension (prerequisite for Phase 4) — **LANDED 2026-07-17**

Delivered:

- New `PartyType` enum (`CUSTOMER | SUPPLIER | EMPLOYEE`); `Account.party_type` marks a control
  account; `VoucherDetail.party_type` + `party_id` (indexed) mirror the `cost_center_id` dimension.
  `party_id` is polymorphic — deliberately **not** an FK, since it points at three tables. Migration
  `20260717170000_add_party_dimension`.
- The bootstrap marks Accounts Receivable `CUSTOMER` and Purchase Payable `SUPPLIER`, threaded through
  the account upsert's **update** clause — so `sync:accounting` sets `party_type` on existing tenants
  on the next deploy (verified: stripped it to NULL, sync restored it). In **both** `.ts` and `.js`.
- `autoPostFromRules` gains optional `partyType` / `partyId`, stamped **only** on the leg whose
  account's `party_type` matches — never the cash/revenue side, and a no-op if neither leg matches or
  the types differ. Wired into every caller that holds a party: sales (credit), customer payments,
  purchases, purchase orders, sales/purchase returns, supplier payments, and the demo generator.
- **Retires the suppliers debt from the earlier commit** — `recordCreditPayment` now passes
  `partyType: 'SUPPLIER'`.

Party ledger is now `voucher_details WHERE party_id = X`. Repointing the UI at it and rebuilding
`due_balance` from it is Phase 8; the backfill of `party_id` onto *historical* AR/AP lines is also
Phase 8 (this phase tags new postings only).

**Employees** carry `party_type` support in the schema but no rule/account yet — that arrives with
Phase 5b (Salary Payable 2050).

**Two corrections / discoveries while building:**

1. A tautology trap in the first invariant I wrote (sum of per-party balances == control balance is
   just re-summing the same lines). The sound integration invariants that shipped: *every
   control-account line carries a `party_id`* (completeness), and *every `party_id` resolves to a real
   party of the matching type* (correct attribution — the cross-contamination failure the unit tests
   can't see across modules). A GL-vs-`due_balance` amount check is **unsound** and was dropped: GL
   posts the full return while the credit tracker floors at zero, so they legitimately diverge on an
   over-return.
2. A **pre-existing** generator bug surfaced by those invariants: `maybePurchaseReturn` recorded the
   full `-lineTotal` in the credit ledger while flooring `due_balance` at 0, so an over-return left
   the two out of sync (intermittent reconciliation failure, ~1 run in 3). Fixed to clamp both to
   `min(lineTotal, due)`, matching `purchase-returns.service`. Also fixed a pre-existing
   time-of-day flake: `simulate.ts` stamped today's sales at a random 10–20h, which could land in the
   future; now clamped to `now`.

**`SalesOrder.customer_id` is nullable** (`String?`). A walk-in deposit would produce an AR/advance
line attributable to nobody, violating the completeness invariant. Taking a deposit must require a
customer — enforced in Phase 4 (deposits) / by the invariant, not by convention.

## Phase 4 — Wire the calls

Five modules gain `autoPostFromRules` inside a `$transaction`: suppliers, salary-payments, accounting
(depreciation), sales-orders, cashier-sessions. Each passes `partyType` / `partyId`.

- **Depreciation** additionally needs wrapping in a transaction and an `assertFiscalPeriodOpen` call.
  It has neither today, so it writes into locked periods.
- **`update` / `remove` paths** need `voidAutoPostedVoucher`. Several currently hard-delete a paid
  amount with no reversal (`salary-payments.service.ts:124`, `sales-orders.service.ts:223`).
- **Convert `fund-transfers`** from hand-rolled `tx.voucher.create` to `autoPostFromRules`, so it
  produces a `PostingEvent` and becomes visible to the registry.
- Add every new tuple to `POSTING_CONTRACT`.

## Phase 5 — Sales-order → sale conversion + settlement

**Required by D2.** Build the conversion flow that does not exist, and emit `advance_settlement` on
conversion so the advance clears into AR. Mirror for supplier advances against a purchase.

Without this, advances accumulate and never clear. This is the cost of D2 and it is accepted, but it
is not deferrable indefinitely.

## Phase 5b — Payroll accrual + employee payment (D4) — **LANDED 2026-07-18**

Both halves shipped, in two commits: **(A)** the accrual (`SalaryAccrual` model, monthly runner
`POST /salary-payments/run-accrual`, `salary_accrual/none` → Dr Salary & Wages / Cr Salary Payable
[party], accounts 2050/5020, 2050 marked `EMPLOYEE`); **(B)** the payment settlement
(`salary_payment/payment_mode` → Dr Salary Payable / Cr \<mode\> [party], wired into
`salary-payments.create` with `update` void-and-reposting and `remove` voiding) **and the constraint
drop below**. Verified end-to-end against a real DB: accrue 30000 then pay 10000 leaves the employee's
Salary Payable at 20000 credit — the payable is `accrual − Σ payments`, derived from the GL. The
`1060` party tension above remains for a future per-employee-advance feature; 2050 is the employee
control account and is unaffected.

### Design (as built)

**New `SalaryAccrual` model**, mirroring `AssetDepreciationEntry` exactly: `employee_id`,
`pay_period`, `amount`, `voucher_id`, `@@unique([tenant_id, employee_id, pay_period])`. It gives
`autoPostFromRules` a real `sourceId` to key idempotency on.

**Monthly accrual runner**, modelled on the depreciation runner
(`accounting.service.ts:runDepreciation`, which now shows the exact shape — one transaction, post per
entry, write `voucher_id` back, date to period end): a `{year, month}` DTO, loop ACTIVE employees, one
accrual per employee per period, emit `salary_accrual` → `Dr Salary & Wages / Cr Salary Payable
[party: employee]`. The depreciation runner already wraps in a `$transaction`; the fiscal-period guard
comes free by passing the period-end `date` to `autoPostFromRules`.

**Account 1060 (Staff Advances) tension to resolve here.** It landed 2026-07-18 as a **plain**
account for the cashier `LOAN` case, because a cashier session links to a `user_id`, not an
`Employee`, so there is no employee party to attribute. When this phase adds per-employee salary
advances, 1060 either (a) gets marked `party_type: EMPLOYEE` — in which case the cashier `LOAN`
posting must resolve the cashier's Employee record or it violates the completeness invariant — or (b)
splits into a separate employee-advance account. Decide before marking 1060.

`salary_payment` then settles it: `Dr Salary Payable / Cr <mode> [party: employee]`. An employee
ledger is `voucher_details WHERE party_type='EMPLOYEE' AND party_id=X`, and the payable is
`accrual − Σ payments`, derived from the GL rather than from `SalaryPayment` rows.

### Dropped: the one-payment-per-month constraint (product behaviour change)

`SalaryPayment` carried `@@unique([tenant_id, employee_id, pay_period])`, and `create` threw
`ConflictException` on a duplicate. That permitted **exactly one payment per employee per month**,
forbidding partial payments, instalments, and advances — the whole point of "payments adjusted from
there". **Dropped** (migration `20260718130000_salary_payment_settlement`, replaced by a plain index;
the duplicate checks in `create`/`update` removed). `SalaryPayment` is now a payment ledger that may
hold many rows per period; the balance comes from the vouchers, not a row count. Taken deliberately —
advances are routine for BD SMEs and one-payment-per-month would not survive a real shop.

### Scope limits

- **No salary structure exists** — no allowance, deduction, or payroll models; `Employee.basic_salary`
  is the only figure and it is nullable. v1 accrues flat `basic_salary` and skips employees without
  one, reporting them the way the depreciation runner reports its results.
- **No attendance link.** `AttendanceRecord` and leave models exist but nothing connects them to pay,
  so loss-of-pay deductions are **out of scope** — a payroll feature, not an accounting one.
- `basic_salary` has no history. A raise does not retro-adjust posted accruals, which is correct.

## Phase 6 — Sales partial-payment idempotency collision

On a credit sale with a *partial* payment, both legs share `sourceId: sale.id` and
`eventType: 'sale'`, so they compute the same idempotency key. The second call finds the first's
`posted` event and short-circuits at `posting.utils.ts:176` — the paid portion is silently never
journaled, and its result is discarded anyway at `sales.service.ts:289`. The demo generator was
written to *avoid* this rather than fix it (`write.ts:433-435`).

Fix: add optional `legKey?: string` to `AutoPostInput`; the key becomes
`${tenantId}:${eventType}:${sourceId}${legKey ? ':' + legKey : ''}`. Pass `legKey: 'paid'` **only** on
the paid-portion call and stop discarding its result. Leaving the credit leg keyless is deliberate:
it preserves every existing voucher's key, so nothing re-posts.

## Phase 7 — The guard that prevents recurrence — **LANDED 2026-07-18**

`POSTING_CONTRACT` starts from call sites, which can hide. The guard must start from the **data
model, which cannot**.

**`money-model-contract.ts` + `money-model-contract.spec.ts`** — the spec parses `schema.prisma`,
finds every model with a `@db.Decimal` field (65 today), and requires each to appear in the registry
as `postsVia: <eventType>`, `exempt: '<reason>'`, or `gap: '<reason>'`. Anything unclassified fails
the build. **Mutation-verified both ways:** dropping a classification fails, and appending a new
`@db.Decimal` model to the schema fails until it is classified — the exact recurrence property. The
spec also checks every `postsVia` names an event type `POSTING_CONTRACT` knows, every reason is
non-empty, and pins the current gap set so wiring one forces a conscious update. Same drift-guard
idiom as `database-exports.spec.ts`.

A third state, `gap`, was added beyond the spec's original two: a money model that *should* post but
is not wired yet, tracked rather than hidden as `exempt`. The census surfaced two — `OrderDeposit`
(Phase 4/5 deposits) and **`FixedAsset`** (asset **acquisition** is not posted; `createFixedAsset`
only registers the row — a newly-found gap, now a TODO follow-up).

Supporting invariants:

- Every voucher line on a party-control account has a non-null `party_id` — makes unattributable
  AR/AP impossible.
- Σ party sub-ledger balances == control account balance, per tenant — catches the drift the current
  tests structurally cannot see.
- Extend `test/demo-data.integration.spec.ts` (already asserts 7 similar invariants) with: every
  money-bearing source row has a voucher.

**Fix the read paths — LANDED 2026-07-17.** All 8 sites now read `PostingEvent` via the shared
`accounting/posting-status.util.ts`, and additionally surface `posting_error` so "why was this
skipped" is answerable rather than a mystery. `PostingBadge` already mapped all four statuses and was
simply never sent them, so no frontend change was needed.

One deliberate limit: a source with **no** `PostingEvent` row still reports `skipped`. That covers
pre-auto-posting rows and rows whose event `voidAutoPostedVoucher` deleted. It is not strictly true,
but it is indistinguishable after the fact and is what those rows have always reported — fixing the
failed-as-skipped lie should not silently reclassify history. Phase 8's backfill is what resolves
them properly.

## Phase 8 — Backfill history

**Backfill script — LANDED 2026-07-18 (built + locally verified; NOT run against any prod DB).**
`apps/backend/scripts/backfill-vouchers.ts` (`npm run backfill:vouchers`, with `--dry-run` and
`--tenant=`) re-posts historical source rows that never got a voucher. Safe by construction:
`autoPostFromRules` is idempotent (a posted row short-circuits — verified: a second run posts 0), a
row whose historical date is in a **locked** period is left alone and reported (never force-posted),
and `--dry-run` writes nothing (verified) — the per-tenant review gate. Two reposters shipped: **sales**
(reconstructs the credit-vs-mode decision from the stored row + first payment, reusing
`classifyPaymentMode` / `creditDueAmount` to stay in lock-step with `sales.service`; the partial
paid-portion is dropped to match live, not Phase 6) and **supplier payments** (PAYMENT→pay /
PAYOUT→receive, tagged with the supplier). Verified end-to-end: a directly-inserted skipped bKash sale
was reported by the dry-run, then posted Dr bKash Account / Cr Sales Revenue (balanced), and re-running
was a no-op. **Runs `tsx`, not `ts-node`** (the backend only has `tsx` installed; `seed:demo`'s
`ts-node` is separately broken). **Still rewrites historical financials — deliberately; review the
dry-run per tenant before live.**

**All six reposters — LANDED 2026-07-18.** Beyond sales + supplier payments: customer payments,
salary payments, cashier PAYOUT/LOAN, and depreciation (which also links its voucher back to the
entry). Each reconstruction was checked against its caller; e2e-verified (depreciation + cashier).

**Reconciliation — LANDED 2026-07-18.** `npm run reconcile:balances` (in `packages/database`) diffs
each party's `due_balance` against the GL-derived balance of their subsidiary ledger (AR net debit /
AP net credit). Report-only by default — a mismatch is not automatically a bug (GL and `due_balance`
legitimately diverge on an over-return; before the backfill the GL is incomplete). `--rebuild`
overwrites `due_balance` from the GL once the backfill has made it the truth. This is the "diff the two
on real data before deleting anything" step. E2e-verified: due 999 vs GL 700 reported, then rebuilt to
700.

**Ledger UI repointed — LANDED 2026-07-18.** New `accounting/party-ledger.util.ts` (`buildPartyLedger`)
builds a party's ledger straight from its tagged control-account voucher lines, in the account's
natural sign. New `GET /customers/:id/gl-ledger` and `GET /suppliers/:id/gl-ledger` return the same
shape as the credit-transaction endpoints (mapping debit/credit to the `CREDIT_SALE`/`CREDIT_PURCHASE`
/`PAYMENT` labels the pages already render), so the customer-ledger and supplier-ledger pages swapped
their data source with no rendering change. The credit-transaction endpoints stay **alongside** for
diffing. 6 util tests (mutation-checked) + a real-DB smoke test; backend 104 suites / 1350 green,
frontend `tsc` clean.

Still open in Phase 8:

- **Retire the parallel tables** — once `reconcile:balances` shows the GL and
  `CustomerCreditTransaction` / `SupplierCreditTransaction` agree on real data, drop the parallel
  tables and the credit-transaction endpoints. Deliberately deferred until the diff is clean on prod.
- **Run against production** — `sync:accounting` → `backfill:vouchers --dry-run` (review per tenant) →
  live → `reconcile:balances`. Not yet run anywhere but the local dev DB; needs prod access.

## Open decisions

**D5 — Priority: CRITICAL or HIGH?** This spans 12+ modules and rewrites historical books. Phase 0 is
arguably CRITICAL on its own (it fixes a live bug silently dropping revenue from the ledger).

## Testing

- Phase 0: sync script against a restored production snapshot; assert every tenant has the full rule set.
- Phase 2: `posting-contract.spec.ts` extended with every new tuple.
- Phase 7: the three invariants above, plus `money-model-contract.spec.ts`.
- Phase 8: dry-run diff reviewed per-tenant before live.
