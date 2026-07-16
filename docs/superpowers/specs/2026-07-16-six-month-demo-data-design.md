# Six-Month Demo Data Generation — Design

**Date:** 2026-07-16
**Status:** Approved, ready for implementation planning

## Problem

Demo data today is three sales, ten products, five customers — all timestamped "now"
(`packages/database/prisma/seed-demo.ts`). Every trend chart is a single point, every report is
empty, and there are no suppliers, purchases, payments, expenses, returns, or accounting vouchers
at all. Both the public sandbox (`demo@erp71.com`, via `POST /auth/demo`) and the per-tenant
"Load Demo Data" button in Settings → Data draw from this same thin dataset.

We want roughly six months of realistic trading history covering every major transaction domain,
serving both sales demos and local dev/QA from one dataset.

## The core constraint

**Backdating is not supported through the service layer.** Only `Sale.sale_date`
(`apps/backend/src/sales/sales.service.ts:142`) and `ExpenseEntry.expense_date`
(`expenses/expenses.service.ts:128`) are caller-settable. `Voucher.date`, `InventoryMovement.created_at`,
`PaymentRecord.created_at`, `CustomerCreditTransaction.created_at` and `LoyaltyTransaction.created_at`
all fall to `@default(now())` because no caller passes a date.

A sale created through `SalesService` with a six-month-old `sale_date` would therefore land with its
voucher, inventory movements and credit transactions all stamped today. Sales reports (indexed on
`sale_date`) and the general ledger (indexed on `Voucher.date`) would disagree. This single fact
drives the whole design.

Raw Prisma `create` *can* override an `@default(now())` field, so backdating is achievable below the
service layer.

## Decisions

| Decision | Choice |
|---|---|
| Purpose | One dataset serving both the public demo sandbox and local dev/QA |
| Domains | All four — core trade, money & credit, accounting, inventory ops |
| Time anchor | Relative to run date (`today − 6 months` → `today`) |
| Volume | Medium — ~2,700 sales (~15/day), ~60 products, ~60 customers, ~12 suppliers |
| Re-run behaviour | Append another batch, with a confirmation alert first |
| Write strategy | **Approach B** — primitive-level generator in the backend |
| Returns bugs | Fix the services as part of this work |
| Execution | Background (in-process async) with DB-backed progress |
| Catalogs | Author demo catalogs for all four business types |

### Why approach B

Three options were weighed:

- **A — raw Prisma throughout.** Total date control, no production code touched, but the seeder would
  reimplement double-entry accounting. The trial balance would balance because the seed *says* so,
  not because the tenant's `PostingRule`s produced it; posting-rule changes would silently make demo
  data a lie. It also stays in `packages/database`, which ships committed compiled `.js` artifacts
  that have already caused two production incidents (TODO.md: demo login 500, Load Demo Data 500).
- **B — primitive-level in the backend (chosen).** `applyInventoryMovement` and `autoPostFromRules`
  are plain functions taking a Prisma `tx` — no DI, no module exports needed — and `autoPostFromRules`
  already accepts an optional `date`. Reuses the real inventory and accounting logic (the two places
  hand-rolled seed data goes wrong unnoticed) without rewriting each module's write path. B does
  still change production code, but narrowly and deliberately: one additive optional parameter on
  `applyInventoryMovement`, plus the two returns-service bug fixes below — not a date parameter
  threaded through ten service DTOs.
- **C — first-class backdating in the service layer.** Add `occurredAt` across ~10 service DTOs and
  thread it through. Most correct, and historical-data import is a genuine product need for retailers
  migrating from paper books. But it risks regressions in live sales and purchase flows for the sake
  of demo data. Deferred as its own project; the B generator would become a thin adapter over it.

## Architecture

New backend module, the single home for transaction generation:

```text
apps/backend/src/demo-data/
  demo-data.module.ts
  demo-data.controller.ts      POST /tenants/demo-data, GET /tenants/demo-data/status
  demo-data.service.ts         job lifecycle, batch detection, orphan recovery
  generator/
    simulate.ts                chronological day loop
    write.ts                   row writers over applyInventoryMovement + autoPostFromRules
    rng.ts                     seeded PRNG (mulberry32)
    catalogs/                  grocery | pharmacy | surgical-medical | computer-hardware
    people.ts                  Bangladeshi customer + supplier name pools
```

**Package split.** `seedDemoAccount` stays in `packages/database/prisma/seed-demo.ts` — it is pure
scaffolding (user, tenant, subscription, two stores, warehouses, inventory settings, reasons) with no
backend dependencies. `seedTenantDemoData` **moves out** and is deleted from the barrel, because the
generator imports from `apps/backend/src` and `packages/database` cannot depend on the backend.

> **Landmine:** `packages/database/index.js` is a committed build artifact that has twice gone stale
> against `index.ts` and broken production. Removing the `seedTenantDemoData` export **must** update
> `index.js` in the same commit.

**Call sites.** `tenants.service.loadDemoData` (`tenants.service.ts:193`) delegates to
`DemoDataService`. The CLI (`npm run seed:demo`) calls `seedDemoAccount` for scaffolding, then boots a
Nest application context to run the same generator — sandbox and button produce identical data through
one code path, with no second implementation.

**Production change (additive, behaviour-preserving).** `applyInventoryMovement`
(`apps/backend/src/database/inventory.utils.ts:121`) gains an optional `occurredAt?: Date` setting
`InventoryMovement.created_at`. Omitted by every existing caller. `autoPostFromRules` already takes
`date` and needs no change.

## The simulation

**Time.** `start = today − 6 months`, `end = today`. Randomness comes from a seeded mulberry32 PRNG
keyed on `hash(tenantId + batchNumber)`: the dataset's shape is reproducible for a given tenant and
batch, dates always look current, and a second batch produces different data rather than a clone.

**Chronological and stock-aware.** The simulator walks day by day holding in-memory stock per product
per warehouse, rather than scattering transactions and patching stock afterwards. `applyInventoryMovement`
throws `Insufficient stock`, which makes this a genuine correctness check on the simulator — errors
fail loudly rather than corrupting the dataset.

**No magic opening stock.** Day 0 is an opening purchase from suppliers; every unit sold across six
months traces back to a purchase. Final stock levels are *derived*, which is what makes inventory
reports, the stock ledger and COGS agree.

**Volume shape.** Daily sales = base rate × weekday factor (Friday–Saturday weekend, per Bangladesh)
× a mild growth trend across the six months × noise. Purchases are **triggered** when simulated stock
falls below a product's reorder level, so replenishment cadence emerges rather than being faked.

| Domain | Generated over six months |
|---|---|
| Sales | ~2,700 across both stores; 1–5 items; walk-in (null customer) mixed with named; payment split across cash/bKash/Nagad/card |
| Credit | ~15% of sales on credit, settled 0–45 days later, producing real aging buckets |
| Purchases | Reorder-triggered from ~12 suppliers, part cash / part credit, with supplier payments over time |
| Returns | ~2% of sales, ~3% of purchases, within days of the original |
| Expenses | Monthly rent/utilities/salaries, weekly transport |
| Inventory ops | Main↔Banani transfers, occasional shrinkage with reason codes, quarterly stock takes |
| Cashier sessions | Per store per trading day, floats reconciling to cash sales |
| Accounting | Every domain above posts through `autoPostFromRules` with an explicit `date` |

The last row is the payoff: vouchers come from the tenant's own configured `PostingRule`s, so the
trial balance balances because it was derived, not asserted.

## Catalogs

One file per business type at `generator/catalogs/<type>.ts`, typed TS rather than JSON because the
generator needs fields the admin import template lacks: sell price alongside purchase price, reorder
level, a **popularity weight** (so the sales mix has head and tail products instead of uniform noise),
and a realistic `unit_type` (kg/litre for grocery, not today's blanket `'none'`).

Roughly 40–60 products each, priced in BDT:

- `GROCERY` — today's rice/oil/sugar/soap list, expanded
- `PHARMACY` — generics, OTC, devices
- `COMPUTER_HARDWARE` — components, peripherals, accessories
- `SURGICAL_MEDICAL` — SKUs and names sourced from the existing
  `packages/database/prisma/templates/surgical-medical.json`, with demo metadata layered on, so that
  trade doesn't end up with two contradictory product lists (one from admin catalog import, one from
  demo). The other three have no template today and are authored fresh; if templates appear later,
  the same sourcing pattern applies.

Selection is by `tenant.business_type` (`schema.prisma:343`, a nullable free-text string), falling
back to `GROCERY` when null.

**Demo products get both stock and taxonomy** — groups, subgroups, brands, *and* stock derived from
purchases. Today's demo products have stock but no group/brand; catalog imports have group/brand but
no stock.

**`ProductPrice` rows are required.** `sales.service.ts` snapshots `unit_cost_at_sale` from
`ProductPrice`. Today's seeder omits these entirely, so every demo sale records zero cost and the P&L
shows 100% margin — likely the cause of current wrong demo margins.

## Job execution, API, and the append alert

No queue infrastructure exists: `JobRun` is a global observability table for `@nestjs/schedule` cron
jobs (no `tenant_id`), and there is no Redis container in `docker-compose.prod.yml`. "Background job"
here means in-process async with DB-backed progress. Sound because there is exactly one backend
container.

**New model `DemoDataBatch`** — progress tracker and append-detection marker in one:

```text
id, tenant_id, batch_number, status (PENDING|RUNNING|COMPLETED|FAILED),
phase, processed, total, counts (Json), started_at, finished_at, error
```

Indexed on `tenant_id`.

**Endpoints.**

- `POST /tenants/demo-data` — creates the batch row, returns `202 {batchId, batchNumber}`, kicks off
  generation without awaiting. Returns `409` if a `RUNNING` batch exists for the tenant. The existing
  imperative OWNER check (`userRole !== 'OWNER'`) carries over.
- `GET /tenants/demo-data/status` — the tenant's latest batch, for ~2s polling.

**Transaction strategy.** Not one giant `$transaction` — 40k rows would hold locks for minutes and
risk memory. Each simulated day commits in its own transaction, with progress updated between chunks.
*Accepted tradeoff:* a mid-run failure leaves a partial dataset. Acceptable because we append anyway
and Clear Data exists.

**Orphan recovery.** A container restart mid-job would strand a batch in `RUNNING` forever. On module
init, any `RUNNING` batch is marked `FAILED`.

**UI** (`apps/frontend/src/app/(app)/settings/data/page.tsx`). Today the Load Demo Data button has no
confirmation at all — one click writes into the tenant. It gains:

- A confirm alert when a completed batch exists: *"This store already has demo data from N previous
  load(s). Loading again adds another ~2,700 sales spanning 6 months. Existing data will not be
  removed."*
- A phase label and progress bar replacing the button while polling.

**`ConfirmDialog` extraction.** The only confirm dialog in the codebase is defined locally inside that
page file (`:19-89`); nothing shared exists. Per the UI rules in CLAUDE.md, extract it to
`@/components/ui`, make `expected` optional so it supports plain confirm as well as type-to-confirm,
and fix its hardcoded English `"Confirm"` / `"Cancel"` / `Type "..."` strings — an existing i18n hole
in a bn/ms-localized app. New keys added across en/bn/ms.

## Returns fixes

Both are real production bugs, fixed test-first:

- **`sales-returns.service.ts`** decrements `total_spent` (`:80`) but never touches
  `Customer.due_balance` or writes a `CustomerCreditTransaction`. Returning a credit sale leaves the
  customer still owing for goods they gave back.
- **`purchase-returns.service.ts`** never touches supplier balances at all.
- Both pass `referenceId: returnNumber` (a string like `RET-...`) to `applyInventoryMovement` where
  every other caller passes the row id, breaking movement→source traceability. Fixed in the same pass.

Existing `CustomerCreditTransaction` / `SupplierCreditTransaction` type enum values will be confirmed
during implementation; a new value is added only if none fits.

## Testing

Unit tests for PRNG determinism and simulator invariants.

The integration test carries the value — run the generator against a test tenant and assert the
properties that make the dataset trustworthy:

- Total debits equal total credits across all vouchers
- Every `ProductStock` quantity equals the sum of its `InventoryMovement` rows
- `Customer.due_balance` equals the sum of its credit transactions; same for suppliers
- Every generated date falls within `[start, end]`
- **No voucher, movement, or payment record is stamped "today" for a backdated sale** — the regression
  test for the exact bug motivating approach B

Plus service specs for the two returns fixes, and a manual pass: run `npm run seed:demo`, log into the
sandbox, confirm dashboard trends, the aging report and the trial balance all populate.

## Risks

- **Generation speed.** `autoPostFromRules` re-resolves posting rules on every call; ~3,000 vouchers
  means thousands of redundant queries. Measure before optimizing; likely mitigation is caching rule
  resolution per run.
- **Local migration friction.** `prisma migrate dev` fails against the local dev DB (no
  `_prisma_migrations` table). The `DemoDataBatch` migration needs SQL applied directly plus a client
  regen locally, while still committing a proper migration for the VPS.
- **Partial datasets** on mid-run failure, per the transaction strategy above.

## Out of scope

- Approach C (service-layer `occurredAt` / historical data import) — separate project.
- Selective "clear demo data only" — no `is_demo` tagging exists on rows; Clear Data remains
  all-or-nothing per tenant.
- The Heavy volume preset (~9,000 sales).
