# Subscription Pricing Architecture — Proposal

**Status:** proposal, not committed pricing · **Drafted:** 2026-09-03
**Currency:** BDT (৳), VAT exclusive · **Yearly:** 10 × monthly (2 months free)
**Baseline read from:** `packages/database/prisma/seed-platform.ts`, `packages/shared-types/subscription-plans.ts`, `apps/backend/src/subscription-plans/`, `apps/frontend/src/lib/marketing/plans.ts`

> Interactive version (filterable matrix): https://claude.ai/code/artifact/b55ed30b-5d20-42fb-9664-95a32c08932b

The catalogue today mixes a capability ladder, a vertical edition, and a bag of add-ons into a single row of cards, which is why it stops making sense when you look at it closely. This proposal separates the three, sets a ৳299 on-ramp, reprices the top so it stops undercutting its own add-ons, and answers which dimensions should meter and which should not.

---

## 1. Six things in the current catalogue are working against you

These are checkable in the repo, and two of them are costing money right now.

### 1.1 Premium is cheaper than the parts it contains — *revenue leak*

Premium is ৳1,499/mo and carries `premiumManufacturing: true`. The Manufacturing add-on alone is ৳999/mo, Imports (LC) another ৳999, Advanced Accounting ৳599. Any manufacturer who would have bought two add-ons (৳1,998) buys Premium instead and gets 30 users and unlimited SKUs thrown in. The bundle has to sit above the sum of its parts, and today it sits well below.

### 1.2 The ৳999 Imports (LC) add-on grants no capability at all — *sells nothing*

It sets `features_json: { premiumImports: true }`, but `premiumImports` is not in `PLAN_ENTITLEMENT_REGISTRY`, and `mergeAddonFeatures` iterates that registry and silently drops unknown keys. Nothing reads the flag either, and there is no LC or landed-cost model in the schema — `apps/backend/src/imports` is CSV import. A tenant can pay ৳999 a month for it and receive exactly nothing. (The module itself is designed but unbuilt — see `docs/lc-imports-and-proforma-invoice-plan.md`.)

### 1.3 The ৳749 plan has a feature the ৳999 plan does not — *ladder inversion*

Accounting carries `premiumAccountingAdvanced: true`; Standard, at ৳250 more, carries `false`. It also sits at `planRank: 0` next to Basic's `1`. This is what a vertical edition looks like when you force it into a ladder — and it is very likely the source of the confusion. Fix by taking it out of the row, not by patching the flag.

### 1.4 The matrix promises more than the API withholds — *unenforced*

Seven entitlement keys are enforced across 16 of ~126 controllers. `premiumStorefront` and `premiumBookPublishing` gate nothing anywhere. Meanwhile the public matrix is 16 hardcoded rows in `apps/frontend/src/lib/marketing/plans.ts` that already disagree with the database — it shows lead management as Premium-only while Standard carries `premiumCrm: true`. Repricing on top of that just makes the gap more expensive.

### 1.5 Basic carries 100 AI credits and no way to spend them — *sold, not delivered*

`premiumAi` is `true` only on `PREMIUM`, but `aiCreditsMonthly` is `100` on `BASIC` — an allowance on a plan whose AI endpoints refuse the request. Selling AI on every tier, which is what "AI-enabled" means on a pricing page, is the fix: turn `premiumAi` on across plans and let the credit allowance do the differentiating. Voice stays a rung up, anomaly detection two.

### 1.6 Every employee given self-service access burns a paid seat — *pricing trap*

`EmployeeGuard` says it plainly: unlike a referee or an investor, an employee "is a real tenant member with a real membership row". And `assertUserQuota` counts every `TenantUser` for the tenant with no filter on role. So a 40-person shop that wants everyone to see a payslip needs 30 extra seats — six packs at ৳300, or ৳1,800/mo on top of a ৳999 plan. Nobody decided that; it falls out of portal users sharing a table with staff.

Storefront customers are safe by contrast: `POST /storefront/:slug/auth/signup` creates a `User` and a `Customer` and never a membership row, so a shop with 5,000 web customers still uses zero seats.

---

## 2. The model — three axes, each answering exactly one question

The reason a customer cannot self-serve today is that one price is being asked to encode three unrelated decisions. Split them and every plan becomes explainable in a sentence.

| Axis | Question it answers | How it works |
|---|---|---|
| **1 — Tier** | How deep does the software go? | Four rungs, strictly nested: each one is everything below it plus more. No feature ever appears on a lower rung and vanishes on a higher one. |
| **2 — Capacity** | How big is the business? | One primary multiplier — branches — with users sold in packs above a generous included count. Products and warehouses do not meter. |
| **3 — Add-ons** | What industry are they in? | Anything fewer than roughly one customer in four will ever open. Bought on top of a tier, priced independently, never a reason to upgrade. |

---

## 3. Axis 1 — the ladder

Starter is deliberately thin — it exists so a two-person shop in Bogura can pay for a month out of one day's takings and find out whether this fits. Business is deliberately expensive, because it is the tier that carries the modules that took the longest to build.

### Starter — ৳299/mo (was ৳499, **down 40%**)

`code: BASIC` · One counter, one owner, two staff. Ring up sales, know what is in stock.

**Setup fee: none, ever.**
**Data migration included** — customisation: fee applicable.

- 1 branch, 1 warehouse
- 2 users, 500 products
- POS, sales, returns
- Purchase entry & suppliers
- Cash book & expenses
- Bangla UI, bKash checkout
- AI assistant, 100 credits
- Email support, 2 business days

### Growth — ৳999/mo (unchanged — **the anchor**, where most land)

`code: STANDARD` · A real business with books to close, a second branch, and someone chasing customers.

**Setup fee: ৳4,000 — charged once.**
**Data migration included** — customisation: fee applicable.

- 2 branches, 10 users
- 10,000 products
- Full ledger & financial reports
- Sales orders, quotations, price lists
- CRM pipeline, loyalty, storefront
- Advanced inventory analytics
- AI assistant, 500 credits
- Priority email support

### Business — ৳2,499/mo (was ৳1,499, **up 67%**)

`code: PREMIUM` · Multi-branch operators who run payroll, make things, or import them.

**Onboarding: ৳15,000, mandatory.**
**Data migration included** — customisation: fee applicable.

- 5 branches, 30 users
- Unlimited products
- Manufacturing & Imports included
- Payroll, recruitment, projects
- Advanced accounting reports
- Public API, white-label
- AI assistant, 2,000 credits
- Phone & chat support

### Enterprise — quote, from ৳8,000/mo (**new rung**)

`code: ENTERPRISE` (new) · Chains and groups where procurement asks for a contract before a card.

**Onboarding: scoped in the contract.**
**Data migration included** — customisation: fee applicable.

- Unlimited branches & users
- SSO, dedicated database
- Custom modules & integrations
- Named account manager
- 99.9% SLA with credits
- Annual invoicing, no card

---

## 4. Accounting is an edition, not a rung

It sells to a different buyer — a firm doing books, not a shop doing sales. It carries `accountingOnly: true`, which hides every retail module, so comparing it to Growth on "does it have POS" is meaningless. Give it its own block on the pricing page, **below** the ladder, with the heading *Not selling anything? Just keeping books.*

Once it is out of the row, the fact that it carries advanced accounting while Growth does not stops being an inversion and starts being the point.

**Accounting edition — ৳749/mo**

- Full ledger & chart of accounts
- P&L, balance sheet, trial balance, cash book
- Comparative P&L, budget vs actual, ratios
- Expenses, fund transfers, loans, investors
- Bank reconciliation & recurring journals
- 5 users, 1 workspace
- No POS, no inventory, no CRM — by design

---

## 5. One-time charges — the fourth line on the invoice

A setup fee does not belong on any of the three axes, because it is not recurring — and that is exactly why it gets misused. It is three different things wearing one label: a commitment device, a delivered service, and a project. Bundled into a single number it is either too high for a shop trying the product or too low to cover a real migration.

| Tier | Setup fee | Why |
|---|---|---|
| **Starter** | **None, ever** | Non-negotiable. A ৳4,000 fee on a ৳299 plan makes the first payment ৳4,299 — fourteen months of subscription before the shop has rung up a single sale. That destroys the one job this tier has. Onboarding is self-serve: a product CSV template, a setup wizard, and the help centre. |
| **Growth** | **৳4,000, charged once** | Flat, on monthly and yearly alike. Growth onboarding is real work — a chart of accounts, opening balances, a second branch configured — and a fee that does not depend on billing cycle is one less thing to explain on a call. It does cost the annual-commitment lever a waiver would have given, so the yearly discount now has to stand on its own two months free. |
| **Business** | **৳15,000, mandatory** | Here it is a real service: multi-branch opening stock, existing salary structures mapped into payroll, a chart of accounts matching what their auditor already sees, BOMs entered. Scope it in writing — named deliverables and an hour count — or it becomes the first thing discounted on every deal. |
| **Enterprise** | **Scoped in contract** | Migration, integration and training are the deal, not a line under it. Floor around ৳50,000. Procurement expects it itemised, so itemise it. |

### Getting data in is free; building something is quoted

One line decides it: if the standard importer already handles it, it costs nothing on any tier — including Starter. If it needs building or bending, it is quoted before the work starts. That keeps the free half genuinely free rather than a lead-in, and it stops migration cost — which varies more than tenfold by source — from being buried in a setup number.

| Service | Price | Notes |
|---|---|---|
| Standard data import | **Free, every tier** | Products, customers, suppliers, opening stock and balances, loaded by you rather than left to the customer. Free is the right price: it is the highest-leverage hour anyone spends on a new tenant, and charging ৳3,000 for it buys a rounding error while costing first-month churn. |
| Legacy migration | Quoted | Tally, desktop POS or a previous ERP, where the data does not fit a standard import. Quoted after looking at the data — never off a price list, because the range is genuinely tenfold. |
| Custom mapping & transformation | Quoted | Bespoke field mapping, merging several sources, or cleaning that needs rules written for one customer's data. |
| Custom reports & integrations | Quoted | Print formats, reports, or a connection to another system, built for how one business works. |
| On-site training | ৳8,000/day | Inside Dhaka. Outside Dhaka the same rate plus travel, quoted per trip. |

"Customisation is charged as applicable" only reassures a buyer who also knows what is *not* chargeable — so state the free half first and in more detail than the quoted half.

**Refund the setup fee in full if they cancel within 30 days.** It removes the largest objection a first-time software buyer has, and costs almost nothing — a tenant who leaves inside a month was never going to renew. State it on the pricing page, not in the terms where nobody reads it.

---

## 6. Full feature matrix

This is the artefact to put on `/pricing` and again inside the app on the billing page with the tenant's current column highlighted.

**Legend:** ✓ included · — not available · a ৳ figure means available on that tier only as a paid add-on.

### Price and capacity

| | Starter | Growth | Business | Enterprise |
|---|---|---|---|---|
| **Price (per month)** | ৳299 | ৳999 | ৳2,499 | Quote |
| **Price (per year)** | ৳2,990 | ৳9,990 | ৳24,990 | Contract |
| Branches (stores) included | 1 | 2 | 5 | Unlimited |
| Team members included | 2 | 10 | 30 | Unlimited |
| Products (SKUs) | 500 | 10,000 | Unlimited | Unlimited |
| Warehouses per branch | 1 | 3 | 5 | Unlimited |
| Extra branch | — | ৳400/mo | ৳400/mo | Included |
| Extra 5 team members | — | ৳300/mo | ৳300/mo | Included |
| AI credits per month | 100 | 500 | 2,000 | Custom |
| **Setup fee (one-time)** | None | ৳4,000 | ৳15,000 | Quoted |
| Standard data migration | Free | Free | Free | Free |

### Selling

| | Starter | Growth | Business | Enterprise |
|---|---|---|---|---|
| POS terminal & cashier sessions | ✓ | ✓ | ✓ | ✓ |
| Sales invoices, returns & receipts | ✓ | ✓ | ✓ | ✓ |
| Sales quotations & sales orders | — | ✓ | ✓ | ✓ |
| Price lists & customer groups | — | ✓ | ✓ | ✓ |
| Loyalty points & discount codes | — | ✓ | ✓ | ✓ |
| Online storefront on an erp71.com address | — | ✓ | ✓ | ✓ |
| Custom domain & unbranded storefront | — | — | ✓ | ✓ |
| Delivery tracking & warranty claims | — | ✓ | ✓ | ✓ |

### Buying and stock

| | Starter | Growth | Business | Enterprise |
|---|---|---|---|---|
| Purchase entry & supplier records | ✓ | ✓ | ✓ | ✓ |
| Purchase orders, quotations & returns | — | ✓ | ✓ | ✓ |
| Stock takes & shrinkage recording | — | ✓ | ✓ | ✓ |
| Branch & warehouse transfers | — | ✓ | ✓ | ✓ |
| Stock valuation, aging & reorder analytics | — | ✓ | ✓ | ✓ |

### Money

| | Starter | Growth | Business | Enterprise |
|---|---|---|---|---|
| Cash book & expense tracking | ✓ | ✓ | ✓ | ✓ |
| Full ledger & chart of accounts | — | ✓ | ✓ | ✓ |
| P&L, balance sheet & trial balance | — | ✓ | ✓ | ✓ |
| Comparative P&L, budget vs actual, ratios | — | ৳599/mo | ✓ | ✓ |
| Fund transfers, loans & investors | — | ✓ | ✓ | ✓ |
| Bank reconciliation & recurring journals | — | ✓ | ✓ | ✓ |

### People

| | Starter | Growth | Business | Enterprise |
|---|---|---|---|---|
| Users, roles & per-store permissions | ✓ | ✓ | ✓ | ✓ |
| Attendance & work schedules | — | ✓ | ✓ | ✓ |
| Expense claims & approvals | — | ✓ | ✓ | ✓ |
| Payroll & salary payments | — | — | ✓ | ✓ |
| Recruitment & employee lifecycle | — | — | ✓ | ✓ |

### Customers and pipeline

| | Starter | Growth | Business | Enterprise |
|---|---|---|---|---|
| Customer & supplier records | ✓ | ✓ | ✓ | ✓ |
| CRM leads, pipeline & activities | — | ✓ | ✓ | ✓ |
| Campaigns, territories & lead scoring | — | — | ✓ | ✓ |
| Projects & timesheets | — | — | ✓ | ✓ |

### Specialist add-ons

| | Starter | Growth | Business | Enterprise |
|---|---|---|---|---|
| Manufacturing & BOM | — | ৳999/mo | ✓ | ✓ |
| Imports & letters of credit | — | ৳999/mo | ✓ | ✓ |
| Book publishing | — | ৳799/mo | ৳799/mo | ✓ |
| Team chat | ৳299/mo | ৳299/mo | ✓ | ✓ |

### Artificial intelligence

| | Starter | Growth | Business | Enterprise |
|---|---|---|---|---|
| AI assistant over the tenant's own data | ✓ | ✓ | ✓ | ✓ |
| Report narration & message drafting | ✓ | ✓ | ✓ | ✓ |
| Business card scanning | ✓ | ✓ | ✓ | ✓ |
| Voice entry & voice navigation | — | ✓ | ✓ | ✓ |
| Anomaly detection on sales & stock | — | — | ✓ | ✓ |
| Monthly credit allowance | 100 | 500 | 2,000 | Custom |
| Buy extra credits | ✓ | ✓ | ✓ | ✓ |

### Customer and portal accounts

| | Starter | Growth | Business | Enterprise |
|---|---|---|---|---|
| Storefront customer accounts | Unlimited | Unlimited | Unlimited | Unlimited |
| Customer order history & profile | — | ✓ | ✓ | ✓ |
| Employee self-service portal | — | ✓ | ✓ | ✓ |
| Seats consumed by customer or portal logins | None | None | None | None |

### Platform

| | Starter | Growth | Business | Enterprise |
|---|---|---|---|---|
| Bangla & English interface | ✓ | ✓ | ✓ | ✓ |
| bKash, Nagad & card checkout | ✓ | ✓ | ✓ | ✓ |
| Daily backups, audit log & data export | ✓ | ✓ | ✓ | ✓ |
| Custom fields & print templates | — | ✓ | ✓ | ✓ |
| Public API & webhooks | — | — | ✓ | ✓ |
| White-label branding | — | — | ✓ | ✓ |
| SSO & dedicated database | — | — | — | ✓ |
| Support | Email, 2 days | Priority email | Phone & chat | Named manager, SLA |

---

## 7. Axis 2 — should price be a function of users, branches, warehouses, products?

Partly — but only one of those four deserves to be a meter, and two of them will actively damage the product if you bill on them. Charge for the dimension the customer already thinks in, and cap the rest generously enough that nobody notices the ceiling.

| Dimension | Verdict | Reasoning |
|---|---|---|
| **Branches / stores**<br>`maxStores` | **Meter it** | This is the multiplier. A retailer's revenue scales with branches and they already budget per branch, so ৳400/mo for a second location reads as a line item rather than a software price rise. It is also the only dimension you already enforce properly — `assertStoreQuota` plus `@RequiresFeature('multiStore')` on `POST /stores`. |
| **Team members**<br>`maxUsers` | **Packs only** | Never per-seat. In a Bangladeshi shop, per-seat pricing does not raise ARPU — it makes three cashiers share one login. That destroys the audit trail, makes `created_by` meaningless and kills cashier accountability, which is most of why they bought a POS. Include seats generously, sell packs of five above the line. |
| **Products / SKUs**<br>`maxSkus` | **Do not meter** | A catalogue is a one-time import, not ongoing value — a 12,000-SKU stationery shop is not richer than a 300-SKU jeweller. Worse, `assertProductQuota` fires on every create, so a 3,000-row CSV against a 2,000 cap fails halfway through and leaves the catalogue in pieces during week one. Keep caps as tier signals only. |
| **Warehouses**<br>*no entitlement exists* | **Do not meter** | There is no `maxWarehouses` key in the registry today, and adding one would be inventing a meter no customer asked for. A warehouse is internal bookkeeping — splitting the godown from the shop floor is good data hygiene you want to encourage, not tax. Bundle three per branch and stop counting. |
| **Invoices / transactions**<br>— | **Do not meter** | It punishes your best customers on their best months and makes the bill unpredictable. SMB owners here tolerate a high fixed price far better than a variable one they cannot forecast — an unexpected bill is the most common reason a subscription gets cancelled outright rather than downgraded. |
| **SMS, AI, WhatsApp**<br>`aiCreditsMonthly` | **Prepaid credits** | These are the only features with a genuine marginal cost per use, so they are the only ones that should consume. The machinery already exists — an allowance per tier plus prepaid top-ups. Never let a credit balance block a sale being rung up; degrade the AI, not the POS. |

---

## 8. Axis 3 — where a feature belongs, including book publishing

The recurring question is not "is this feature valuable" but "what fraction of customers will ever open it". Four buckets, one test each. Book publishing fails the first test decisively, which is exactly why it should never touch the ladder.

### Fewer than ~1 in 4 will open it, and it is shaped by industry → **add-on**

Putting a vertical module on a tier forces every non-vertical customer to either pay for it or feel the tier is not for them. Sold separately it is pure margin from a small group and invisible to everyone else. Gate it to Growth and above so it never lands in a 2-user workspace where it cannot be supported.

> `MANUFACTURING` ৳999 · `IMPORTS_LC` ৳999 · `BOOK_PUBLISHING` ৳799 (new) · restaurant KOT, pharmacy batch-expiry when they ship

### Most will want it eventually, but only once they are bigger → **tier feature**

This is what a ladder is for. The feature is not niche, it is simply premature for a small shop — which makes it a genuine reason to upgrade rather than a surcharge.

> `multiStore` · `premiumInventoryReports` · `premiumAccountingAdvanced` · `apiAccess` · payroll · projects

### It costs you cash every time it runs → **credits**

Anything with a per-unit vendor bill behind it. Bundle an allowance into the tier so normal use never triggers a purchase, then sell top-ups. Keep the allowance visible in the app before it runs out, not after.

> `aiCreditsMonthly` · SMS sends · WhatsApp conversations · storage beyond a fair-use ceiling

### It is table stakes, or withholding it would be hostile → **everywhere**

Never paywall the things that make the product trustworthy, and never retro-paywall something tenants already have. Standard data import belongs here for the same reason — a tenant whose catalogue is not loaded has not started, so charging for the loading taxes the one step that decides whether they stay. The storefront falls here — it is live on tenants today, so it stays included on Growth rather than becoming an add-on. Sell the *capability* instead of the access: an erp71.com address on Growth, a custom domain and unbranded pages on Business. Customer and employee portal logins belong here too, and should never consume a paid seat.

> Bangla interface · bKash/Nagad checkout · daily backups · audit log · data export · role permissions

---

## 9. What it takes to ship this

Ordered by dependency, not by size. The first two need no deploy at all; the matrix cannot be trusted until step three is done, and capacity cannot be priced until step four is.

### 1. Reprice Premium and Starter in the database
*No migration · no deploy · platform admin only*

`monthly_price`, `yearly_price`, `name` and `description` are all editable columns, and `upsertPlan` only fills in missing keys rather than reverting an admin's edits. Starter/Growth/Business are display names over the existing `BASIC`/`STANDARD`/`PREMIUM` codes, so nothing in the enum moves. Grandfather every current tenant at their existing price and entitlements for twelve months.

### 2. Register `premiumImports` and stop selling a dead add-on
*One-line registry change · refund exposure if anyone bought it*

Either add the key to `PLAN_ENTITLEMENT_REGISTRY` and build the LC module behind it, or deactivate `IMPORTS_LC` until it exists. Right now it is the only add-on in the catalogue whose `features_json` key survives no merge and gates no route. Add a startup assertion that every seeded add-on key exists in the registry so this cannot recur.

### 3. Enforce every row before you publish the matrix
*The real work · roughly one pass per module*

Seven keys across 16 of ~126 controllers is not enough to sell against. Each new matrix row needs a `@RequiresFeature` on its controller and a nav gate that actually reads the entitlement — note that `ResolvedNavModule` currently drops module-level `entitlement` entirely, so the chat module's gate is dead config. The storefront is the sharpest case: the matrix puts it on Growth and above, but `premiumStorefront` gates nothing, so a Starter tenant can switch one on today. A promise you do not enforce is a support ticket you will answer forever.

### 4. Stop portal logins from consuming paid seats
*Blocks the capacity pricing · one column, one query*

Before seats are priced at ৳300 per five, `assertUserQuota` has to stop counting people who never open a staff screen. Either flag portal-only membership on `TenantUser` and exclude it from the count, or count `portal_access` employees separately. Until that lands, HR self-service costs a Growth tenant more than the plan it sits on — and "unlimited employee self-service" is a line you cannot print.

### 5. Add quantity to capacity purchases
*One migration · changes merge semantics*

Capacity packs need somewhere to live: `TenantAddonSubscription` has no `quantity`, and `TenantSubscription` has no `extra_branches`. A `quantity Int @default(1)` on the add-on subscription is the smaller change, with `mergeAddonFeatures` multiplying numeric grants by it instead of taking the max — which is a real behavioural change to that function, so it wants tests before it wants a migration.

### 6. Charge the setup fee once, and record that you did
*Two columns · no billing-cycle logic now the waiver is gone*

The cheap half is already true: `createCheckout` builds `amount` as plan plus add-ons and writes `line_items` into the `BillingEvent` payload, and the renewal scheduler recomputes from `plan.monthly_price` rather than reusing that amount — so a setup line added at checkout will not recur. The expensive half is that nothing records the fee was ever paid, so a tenant who lapses to `PAST_DUE` and checks out again is charged it a second time. That wants `setup_fee_paid_at` on `TenantSubscription` and a `setup_fee` column on `SubscriptionPlan` — it is a price, so a column, not a `features_json` key. Decide explicitly whether the referral discount touches it; today that discount multiplies `planAmount` only, and add-ons are already excluded the same way.

### 7. Drive the matrix from the entitlement registry
*Removes the drift permanently*

Retire the 16 hardcoded rows in `apps/frontend/src/lib/marketing/plans.ts`. Extend each `PlanEntitlementDefinition` with `marketingLabel`, `matrixGroup` and `showInMatrix`, then let one registry feed the public matrix, the in-app upgrade screen and the admin plan editor. A platform admin toggling an entitlement should change the public page without a deploy — which is the whole reason the registry exists.

### 8. Make plans data before adding Enterprise
*Already on the backlog · unblocks everything after*

`SubscriptionPlanCode` is a Prisma enum and `SELF_SERVE_SUBSCRIPTION_PLAN_CODES` is a code constant, so a fourth rung costs a migration plus a deploy plus a shared-types release. The tracked fix — `is_public`, `is_self_serve`, `sort_order` and a string `code` — pays for itself the first time you want a seasonal or partner plan. Enterprise is quote-only anyway, so it can ship as a manually assigned plan while that lands.
