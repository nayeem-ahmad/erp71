# CEO KPI scorecard

Eighteen business-health KPIs, shown to a shop owner about their own business
(`/scorecard`, API `GET /kpis`) and to the platform owner about ERP71 itself
(`/admin/kpis`, API `GET /admin/kpis`).

- Definitions (unit, which direction is better, availability per audience):
  `packages/shared-types/kpis.ts`
- Computation: `apps/backend/src/kpis/` (`tenant-kpi.service.ts`,
  `platform-kpi.service.ts`, formulas in `kpi-math.ts`)
- UI: `apps/frontend/src/components/kpis/KpiScorecardView.tsx`
- Words (what / why / how, notes, input labels): `messages/<locale>/kpis.ts`

Every KPI is compared with the period of the same length just before. A KPI
with nothing to divide by returns `no_data`, never 0.

## Access

| | Shop (`GET /kpis`) | Platform (`GET /admin/kpis`) |
|---|---|---|
| Guard | `VIEW_FINANCIAL_REPORTS`, any plan (not on accounting-only plans) | `PlatformAdminGuard` |
| Scope | Whole business for an owner or a `VIEW_CONSOLIDATED_REPORTS` holder; otherwise one branch (`storeId`) | All tenants; books from the platform workspace |
| Sidebar | Root `scorecard` entry beside Dashboard | `admin.kpis` under Overview |

## Phase 1: live KPIs and where each comes from

| # | KPI | Shop | Platform |
|---|---|---|---|
| 1 | Revenue growth | Net sales (invoices − refunds) vs previous period | Ledger revenue in the platform books |
| 2 | Gross margin | Stamped sale-line cost (`unit_cost_at_sale`), as in the sales gross-profit reports; flags partly-costed sales | Phase 3 |
| 3 | Net profit margin | `getFinancialRatios`: ledger net profit ÷ revenue | Same, platform books |
| 4 | Operating cash flow | `getCashMovements`: direct method over vouchers that move cash/bank | Same, platform books |
| 5 | Cash runway | Cash + bank ÷ average monthly net burn over the trailing 90 days; "cash-positive" when cash grew | Same, platform books |
| 7 | Customer lifetime value | Named customers' monthly gross profit per customer × average first-to-last purchase span (a one-time buyer counts 1 month) | Phase 3 |
| 9 | Revenue retention | Revenue this period from last period's named customers ÷ their revenue last period | Phase 2 |
| 10 | Churn rate | Named customers who bought in the 90 days before the period and not in the 90 days ending with it ÷ the former | Phase 2 |
| 11 | Avg revenue per customer | Named-customer revenue ÷ named customers who bought (plus average bill as an input) | Phase 2 |
| 13 | Sales cycle length | CRM leads converted in the period: mean days from `created_at` to `closed_at` | Workspace signup → first paid activation (`activated_at`) |
| 14 | Staff turnover | Leavers (`last_working_day` in period) ÷ mean of opening and closing headcount | Same, platform workspace employees |
| 16 | Days sales outstanding | Receivables ÷ credit sales (debits to receivable accounts) × days in period | Same, platform books |

Walk-in sales carry no customer, so KPIs 7, 9, 10 and 11 cover named customers
only and say so on the tile.

Ledger KPIs honour the tenant's approved-only reporting setting; the scorecard
warns when vouchers are waiting for approval.

## Phase 2: platform subscription KPIs

Read from the MRR history (`apps/backend/src/kpis/mrr/`, table
`tenant_mrr_snapshots`). A nightly job (23:50 Dhaka) records every tenant's
MRR: the subscription fee after the tenant's discount (yearly ÷ 12) plus active
add-ons, for tenants that are active, or past due after a first payment, and
not suspended. Today is computed live. The first boot backfills 12 month-ends
from `subscription_fee` events (approximate, no add-ons).

Each tenant's MRR on the day before the period and on its last day is sorted
into new, expansion, contraction, churn or reactivation (paid before, not at
the start, paying at the end).

| # | KPI | Formula |
|---|---|---|
| 9 | Net revenue retention | (start MRR + expansion − contraction − churned) ÷ start MRR |
| 10 | Churn rate | Paying tenants lost ÷ paying tenants at the start |
| 11 | ARPA | MRR ÷ paying tenants, on the last day |
| 12 | Burn multiple | Net cash burn (books) ÷ net new ARR ((end − start MRR) × 12); "Not burning cash" when cash grew |
| 17 | SaaS quick ratio | (new + expansion + reactivation) ÷ (churned + contraction) |

A period that starts before the history says "history does not reach back"
instead of guessing. The admin dashboard's MRR tile reads the same figures.

## Phase 3: classified expenses

Expense accounts carry an optional KPI class (`Account.kpi_class`): cost of
sales, sales & marketing, interest, tax, depreciation, amortisation, or
"operating" (none of these). Set it in Accounting › Chart of Accounts, or leave
it on Auto, which guesses from the account name, then its subgroup and group
(`resolveKpiAccountClass` in `packages/shared-types/kpis.ts`). The default
charts work untouched: a shop's "Depreciation Expense" and "Cost of Sales"
subgroup, the platform's "Infrastructure & Platform Costs" group and "Sales &
Marketing" subgroup. `AccountingService.getKpiLedgerBreakdown` sums each class.

| # | KPI | Shop | Platform |
|---|---|---|---|
| 2 | Gross margin | (unchanged: stamped sale-line cost) | (revenue − cost of sales) ÷ revenue, platform books |
| 6 | CAC | Sales & marketing spend ÷ customers whose first purchase was in the period | Sales & marketing spend ÷ workspaces that started paying in the period |
| 7 | LTV | (unchanged) | ARPA × gross margin × lifespan; lifespan = 1 ÷ monthly churn, capped at 60 months |
| 8 | LTV:CAC | LTV ÷ CAC | LTV ÷ CAC |
| 18 | EBITDA | Net profit + interest + tax + depreciation + amortisation | Same, platform books |

With no account in the sales & marketing class, CAC and LTV:CAC say so
rather than reporting zero.

## Not live yet

| KPI | Shop | Platform | Needs |
|---|---|---|---|
| 15 NPS | Phase 4 | Phase 4 | A customer survey |

The phases are tracked in `TODO.md` under "CEO KPI scorecard".
