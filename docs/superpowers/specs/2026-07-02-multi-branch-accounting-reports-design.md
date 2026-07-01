# Multi-Branch Accounting Reports (Attribution Model)

**Date:** 2026-07-02  
**Status:** Approved  
**Decision:** Attribution model — single company COA, branch attribution via `store_id` on vouchers; inter-branch clearing accounts net to zero in consolidated view.

---

## Summary

Enable **branch-level**, **company-level**, and **side-by-side comparison** financial reports without separate ledgers per branch. Most transactions inherit branch context from the active store; inter-branch fund and goods transfers use dedicated workflows with clearing accounts that eliminate on consolidation.

Users interact with **one report page per report type** and switch scope (This branch / All branches / Compare branches) — not separate report routes per scope.

---

## Goals

1. Branch P&L and Balance Sheet filtered by voucher `store_id`
2. Company (consolidated) P&L and Balance Sheet across all branches + company-wide entries
3. Comparison matrix: account rows × branch columns + Total
4. Auto-tag branch on operational auto-posting (sales, purchases, expenses, loans)
5. Inter-branch fund transfers with audit trail and correct branch/corporate presentation
6. Preserve user-friendliness: header branch = default; explicit branch on forms; plain-language scope labels

## Non-Goals (this phase)

- Separate COA per branch
- Full elimination journal UI for accountants
- Cost center as primary branch dimension (cost centers remain optional sub-segment within a branch)
- Re-implementing sales consolidated/branch reports (already exist; accounting reports align to same scope UX)

---

## Data Model

### Voucher attribution

Add to `Voucher`:

```prisma
model Voucher {
  // ...existing fields...
  store_id          String?   // null = company-wide entry
  attribution       String    @default("BRANCH")  // BRANCH | COMPANY | INTER_BRANCH
  counterparty_store_id String?  // for INTER_BRANCH: the other branch

  store             Store?    @relation(fields: [store_id], references: [id])
  counterpartyStore Store?    @relation("VoucherCounterpartyStore", fields: [counterparty_store_id], references: [id])

  @@index([tenant_id, store_id])
  @@index([tenant_id, attribution])
}
```

| `attribution` | `store_id` | Meaning |
|---------------|------------|---------|
| `BRANCH` | set | Normal branch transaction |
| `COMPANY` | null | Head-office / shared overhead |
| `INTER_BRANCH` | source branch | Leg of an inter-branch transfer (counterparty set) |

**Rule:** P&L and BS branch filters use `voucher.store_id`. Company-wide entries (`store_id = null`, `attribution = COMPANY`) appear only in consolidated views under a **Company** column/bucket.

### Inter-branch clearing accounts (bootstrap)

Add to default accounting template (idempotent `ensureInterBranchAccounts`):

| Code | Name | Type |
|------|------|------|
| 1040 | Due from Branches | Asset |
| 2040 | Due to Branches | Liability |

Posting pattern for **fund transfer** (amount X, A → B):

| Leg | Branch | Voucher | Dr | Cr |
|-----|--------|---------|----|----|
| Send | A (source) | `store_id=A`, `counterparty_store_id=B` | Due from Branches | Cash |
| Receive | B (dest) | `store_id=B`, `counterparty_store_id=A` | Cash | Due to Branches |

- Branch A BS: cash ↓, due from branches ↑
- Branch B BS: cash ↑, due to branches ↑
- Company BS: clearing accounts net (assets and liabilities offset when transfers are paired)

Goods transfers continue using existing `transfer_scope` inventory posting; no P&L impact. Cross-branch inventory uses transit accounts at company level (existing behavior).

### FundTransfer service (schema exists, logic new)

`FundTransfer` model already has `source_store_id`, `destination_store_id`, status workflow, voucher linkage.

Statuses: `INITIATED` → `IN_TRANSIT` → `RECEIVED` (or `CANCELLED`).

- **Initiate:** create transfer record; post source leg (cash out, due from)
- **Receive:** post destination leg (cash in, due to); link `destination_voucher_id`
- Permissions: `CREATE_FUND_TRANSFER`, `APPROVE_FUND_TRANSFER` (existing)

---

## Report Engine

### Shared query DTO: `ReportScopeDto`

```ts
scope: 'branch' | 'company' | 'compare'
storeId?: string           // required when scope = 'branch'
storeIds?: string[]        // required when scope = 'compare' (min 2)
from?: string
to?: string
asOfDate?: string          // balance sheet / trial balance
includeCompanyBucket?: boolean  // compare mode: add Company column for null store_id
```

### Scope semantics

| Scope | Voucher filter | Presentation |
|-------|----------------|--------------|
| `branch` | `store_id = storeId` | Single-column report (current layout) |
| `company` | all vouchers for tenant; inter-branch clearing shown net in totals | Single-column consolidated |
| `compare` | group by `store_id` (+ null bucket as "Company") | Matrix: rows = accounts, cols = branches + Total |

### Reports to extend (Phase 1)

- Profit & Loss (`getProfitLoss`)
- Balance Sheet (`getBalanceSheet`)
- Trial Balance (`getTrialBalance`)

### Reports to extend (Phase 2)

- Cashbook, Bankbook, Comparative P&L (matrix variant)

### Compare matrix response shape

```ts
{
  scope: 'compare',
  period: { from, to },
  columns: [
    { key: 'store-uuid-1', label: 'Gulshan', type: 'branch' },
    { key: 'store-uuid-2', label: 'Banani', type: 'branch' },
    { key: 'company', label: 'Company', type: 'company' },
    { key: 'total', label: 'Total', type: 'total' },
  ],
  sections: [
    {
      name: 'Revenue',
      rows: [
        {
          account: { id, code, name },
          amounts: { 'store-uuid-1': 125000, 'store-uuid-2': 82000, company: 0, total: 207000 },
        },
      ],
      subtotals: { ... },
    },
  ],
  net_profit: { ... },
}
```

**Total column** = sum of branch columns + company column. Inter-branch clearing accounts: include in branch columns where posted; Total should reflect economic consolidated position (clearing nets when both legs exist).

### Permissions

- `scope=branch`: user must have `VIEW_FINANCIAL_REPORTS` on that store (or OWNER/MANAGER all-store access)
- `scope=company` or `compare`: requires `VIEW_CONSOLIDATED_REPORTS`

---

## Auto-Tagging

Extend `AutoPostInput` and `createVoucher` callers:

| Source | `store_id` | `attribution` |
|--------|------------|---------------|
| Sale / sale return | `sale.store_id` | `BRANCH` |
| Purchase / purchase return | `purchase.store_id` | `BRANCH` |
| Expense entry | `expense.store_id` ?? active store from request | `BRANCH` or `COMPANY` if null |
| Loan disbursement/repayment | `loan.store_id` ?? active store | `BRANCH` or `COMPANY` |
| Customer payment | sale/customer context store | `BRANCH` |
| Warehouse transfer (intra) | source `store_id` | `BRANCH` |
| Warehouse transfer (cross) | source `store_id` for send leg | `INTER_BRANCH` |
| Manual voucher | DTO `storeId` or active `x-store-id` header | user choice |
| Fund transfer | per leg | `INTER_BRANCH` |

`posting.utils.ts` → pass `storeId` into voucher create path inside `autoPostFromRules`.

---

## Frontend UX

### `ReportScopeBar` component

Shared control used on P&L, Balance Sheet, Trial Balance (and later other reports):

```
View: ( ) This branch  ( ) All branches  ( ) Compare branches

[Branch dropdown]          — visible for "This branch"
[Multi-select branches]    — visible for "Compare", default all accessible
[☑ Include company overhead] — compare mode only

[From] [To] or [As of]  [Generate]
```

Labels (i18n keys under `reports.scope`):

- `thisBranch` — "This branch"
- `allBranches` — "All branches"
- `compareBranches` — "Compare branches"
- `companyOverhead` — "Company overhead"

Default scope:

- User with single-branch access → `branch`
- Owner/Accountant → remember last choice in `localStorage['report_scope']`

### Manual voucher entry

Add to `accounting/vouchers/new`:

- **Branch:** dropdown (default = active store); option **Company-wide** sets `storeId` null + `attribution=COMPANY`
- Hidden for `INTER_BRANCH` (only created via fund transfer workflow)

### Fund transfer page

New route: `/accounting/inter-branch/fund-transfers`

- List transfers with status filters
- Create modal: from branch, to branch, amount, method, notes
- Actions: Approve (if required), Mark received
- Linked voucher numbers shown per leg

Sidebar: under Accounting → **Inter-branch** → Fund Transfers

---

## Migration & Backfill

1. Add nullable `store_id`, `attribution`, `counterparty_store_id` to `vouchers`
2. Backfill script (one-time, tenant-scoped):
   - Vouchers linked to `PostingEvent` where source is sale/purchase/etc. → infer `store_id` from source record
   - Remaining → `attribution=COMPANY`, `store_id=null`
3. No breaking change to existing company-wide reports (they continue to work; compare mode adds branch breakdown)

---

## Testing

### Backend unit tests

- `getProfitLoss` / `getBalanceSheet` / `getTrialBalance` with each scope
- Compare matrix: two branches + company bucket + total arithmetic
- Inter-branch fund transfer: source/receive legs appear in correct branch BS; company nets clearing
- Auto-post from sale tags `store_id`

### Frontend tests

- `ReportScopeBar` renders correct controls per scope
- P&L page passes correct query params per scope
- Fund transfer page create/receive flow (mock API)

### E2E (accounting.spec.ts)

- AC-Branch-01: create sales at two branches → branch P&L differs → compare matrix shows both columns
- AC-Branch-02: fund transfer → branch BS shows cash movement

---

## Phased Delivery

| Phase | Scope | Outcome |
|-------|-------|---------|
| **1** | Schema + auto-tag + scope on P&L/BS/TB + ReportScopeBar | Branch & company reports work |
| **2** | Compare matrix + export | Side-by-side analysis |
| **3** | Fund transfer module + inter-branch accounts bootstrap | Cash movement between branches |
| **4** | Cost center on voucher lines (optional drill-down) | Department within branch |

---

## Open Questions (deferred)

- Should compare view hide inter-branch clearing rows by default? **Default: hide; toggle "Show inter-branch accounts" for accountants.**
- Fiscal period lock: per-tenant only (unchanged for now).

---

## Approval

- **Model:** Attribution (`store_id` on vouchers) — approved 2026-07-02
- **UX:** Unified report + scope bar — approved 2026-07-02