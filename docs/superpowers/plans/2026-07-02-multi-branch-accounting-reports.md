# Multi-Branch Accounting Reports Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver branch-level, company-level, and side-by-side comparison accounting reports using voucher `store_id` attribution, with auto-tagging from operations and an inter-branch fund transfer workflow.

**Architecture:** Single shared COA per tenant. Add `store_id` + `attribution` to `Voucher`. Extend report queries with a `ReportScopeDto` (`branch` | `company` | `compare`). Reuse one report page per type with a shared `ReportScopeBar` component. Fund transfers post paired legs to inter-branch clearing accounts.

**Tech Stack:** NestJS, Prisma/PostgreSQL, Next.js 15, React, shared-types, Jest, Playwright.

## Global Constraints

- **Design spec:** `docs/superpowers/specs/2026-07-02-multi-branch-accounting-reports-design.md` (approved)
- **Attribution model:** branch via `voucher.store_id`; company-wide = `null`; inter-branch = `INTER_BRANCH` + `counterparty_store_id`
- **Do not** create separate COA per branch or duplicate report routes per scope
- **Permissions:** `VIEW_FINANCIAL_REPORTS` for branch scope; `VIEW_CONSOLIDATED_REPORTS` for company/compare
- **i18n:** add en/bn/ms keys for scope labels and fund transfer UI
- **Tests:** backend unit tests for each report scope; frontend page tests for scope bar; extend `e2e/accounting.spec.ts` in Phase 2+

---

## File Map

| Area | Files |
|------|-------|
| Schema | `packages/database/prisma/schema.prisma`, new migration SQL |
| Bootstrap | `packages/database/prisma/bootstrap-accounting.ts`, `accounting.constants.ts` |
| Posting | `apps/backend/src/accounting/posting.utils.ts`, callers in `sales.service.ts`, `purchases.service.ts`, etc. |
| Reports | `apps/backend/src/accounting/accounting.service.ts`, `accounting.dto.ts`, `accounting.controller.ts` |
| Report utils | **Create:** `apps/backend/src/accounting/report-scope.utils.ts` |
| Fund transfers | **Create:** `apps/backend/src/fund-transfers/` (module, service, controller, dto) |
| Shared types | `packages/shared-types/index.ts` (VoucherAttribution enum if needed) |
| Frontend scope | **Create:** `apps/frontend/src/components/accounting/ReportScopeBar.tsx` |
| Report pages | `apps/frontend/src/app/(app)/accounting/reports/pl/page.tsx`, `balance-sheet/page.tsx`, `trial-balance/page.tsx` |
| Voucher form | `apps/frontend/src/app/(app)/accounting/vouchers/new/page.tsx` |
| Fund transfer UI | **Create:** `apps/frontend/src/app/(app)/accounting/inter-branch/fund-transfers/page.tsx` |
| API client | `apps/frontend/src/lib/api.ts` |
| Nav | `apps/frontend/src/lib/accounting-nav.ts`, `routes.ts` |
| Backfill | **Create:** `packages/database/prisma/backfill-voucher-store-id.ts` (script) |

---

## Phase 1: Schema, Auto-Tag, Branch & Company Reports

### Task 1: Prisma schema — voucher attribution fields

**Files:**
- Modify: `packages/database/prisma/schema.prisma`
- Create: `packages/database/migrations/13_voucher_branch_attribution.sql`

- [ ] **Step 1: Add fields to `Voucher` model**

```prisma
store_id               String?
attribution            String   @default("BRANCH")  // BRANCH | COMPANY | INTER_BRANCH
counterparty_store_id  String?

store             Store? @relation(fields: [store_id], references: [id])
counterpartyStore Store? @relation("VoucherCounterpartyStore", fields: [counterparty_store_id], references: [id])

@@index([tenant_id, store_id])
```

Add reverse relations on `Store` model for vouchers.

- [ ] **Step 2: Write migration SQL** (manual migration pattern used in repo)

- [ ] **Step 3: Run `npx prisma generate` in `packages/database`**

- [ ] **Step 4: Commit** `feat(db): add voucher branch attribution fields`

---

### Task 2: Report scope utilities (TDD)

**Files:**
- Create: `apps/backend/src/accounting/report-scope.utils.ts`
- Create: `apps/backend/src/accounting/report-scope.utils.spec.ts`

- [ ] **Step 1: Write failing tests** for:
  - `buildVoucherWhereForScope({ scope: 'branch', storeId })` → `{ store_id: storeId }`
  - `scope: 'company'` → `{}` (no store filter)
  - `scope: 'compare'` → returns grouping key function
  - `assertReportScopePermission(user, scope, storeId)` throws without consolidated perm

- [ ] **Step 2: Run tests** — expect FAIL

- [ ] **Step 3: Implement minimal utils**

- [ ] **Step 4: Run tests** — expect PASS

- [ ] **Step 5: Commit** `feat(accounting): report scope query helpers`

---

### Task 3: Extend report DTOs and P&L for branch/company scope

**Files:**
- Modify: `apps/backend/src/accounting/accounting.dto.ts`
- Modify: `apps/backend/src/accounting/accounting.service.ts`
- Modify: `apps/backend/src/accounting/accounting.controller.ts`
- Modify: `apps/backend/src/accounting/accounting.service.spec.ts`

- [ ] **Step 1: Add `ReportScopeFields` mixin or extend `ProfitLossQueryDto`**

```ts
@IsOptional() @IsIn(['branch', 'company', 'compare']) scope?: string;
@IsOptional() @IsString() storeId?: string;
@IsOptional() @IsArray() storeIds?: string[];
@IsOptional() @IsBoolean() includeCompanyBucket?: boolean;
```

- [ ] **Step 2: Write failing test** — branch P&L only includes vouchers with matching `store_id`

- [ ] **Step 3: Refactor `getProfitLoss`** — add `voucher.store_id` filter via `buildVoucherWhereForScope`; company scope unchanged behavior

- [ ] **Step 4: Run accounting.service.spec.ts** — PASS

- [ ] **Step 5: Commit** `feat(accounting): branch and company scope on P&L`

---

### Task 4: Balance Sheet and Trial Balance scope

**Files:**
- Modify: `apps/backend/src/accounting/accounting.service.ts`
- Modify: `apps/backend/src/accounting/accounting.service.spec.ts`

- [ ] **Step 1: Write failing tests** for branch-filtered BS and TB

- [ ] **Step 2: Apply same voucher filter** in `getBalanceSheet` and `getTrialBalance`

- [ ] **Step 3: Run tests** — PASS

- [ ] **Step 4: Commit** `feat(accounting): branch scope on balance sheet and trial balance`

---

### Task 5: Auto-tag store_id on voucher create and auto-posting

**Files:**
- Modify: `apps/backend/src/accounting/posting.utils.ts`
- Modify: `apps/backend/src/accounting/accounting.dto.ts` (`CreateVoucherDto` — optional `storeId`, `attribution`)
- Modify: `apps/backend/src/accounting/accounting.service.ts` (`createVoucher`, `updateVoucher`)
- Modify: `apps/backend/src/sales/sales.service.ts`
- Modify: `apps/backend/src/accounting/posting.utils.spec.ts` (if exists) or `accounting.service.spec.ts`

- [ ] **Step 1: Extend `AutoPostInput`** with `storeId?: string`, `attribution?: string`, `counterpartyStoreId?: string`

- [ ] **Step 2: Write failing test** — sale auto-post creates voucher with `store_id = sale.store_id`

- [ ] **Step 3: Pass `storeId: dto.storeId` from sales.service `autoPostFromRules` call**

- [ ] **Step 4: Persist fields in voucher create** inside `autoPostFromRules` and `createVoucher`

- [ ] **Step 5: Repeat for purchases, expenses, loans** (grep `autoPostFromRules` callers)

- [ ] **Step 6: Run backend tests** — PASS

- [ ] **Step 7: Commit** `feat(accounting): auto-tag voucher store_id from operations`

---

### Task 6: Backfill existing vouchers

**Files:**
- Create: `packages/database/prisma/backfill-voucher-store-id.ts`

- [ ] **Step 1: Script** — for vouchers with `source_module=sales` and `source_id`, join sale and set `store_id`; similar for purchases; else `attribution=COMPANY`

- [ ] **Step 2: Dry-run log counts** per tenant

- [ ] **Step 3: Document in spec** (already noted); run on staging before prod

- [ ] **Step 4: Commit** `chore(db): voucher store_id backfill script`

---

### Task 7: Frontend ReportScopeBar + P&L integration

**Files:**
- Create: `apps/frontend/src/components/accounting/ReportScopeBar.tsx`
- Create: `apps/frontend/src/components/accounting/ReportScopeBar.test.tsx`
- Modify: `apps/frontend/src/app/(app)/accounting/reports/pl/page.tsx`
- Modify: `apps/frontend/src/lib/api.ts`
- Modify: `apps/frontend/src/lib/localization/messages/en/accounting.ts` (+ bn, ms)

- [ ] **Step 1: Write failing test** — scope bar shows branch dropdown when "This branch" selected

- [ ] **Step 2: Implement `ReportScopeBar`** with three radio modes, date inputs, accessible stores from `api.getMe()` / stores list

- [ ] **Step 3: Update `api.getProfitLoss`** to pass `scope`, `storeId`

- [ ] **Step 4: Wire P&L page** — replace bare date filters with scope bar

- [ ] **Step 5: Run frontend tests** — PASS

- [ ] **Step 6: Commit** `feat(ui): report scope bar on P&L`

---

### Task 8: Wire scope bar to Balance Sheet and Trial Balance

**Files:**
- Modify: `balance-sheet/page.tsx`, `trial-balance/page.tsx`
- Modify: `api.ts`

- [ ] **Step 1: Update API methods** with scope params

- [ ] **Step 2: Add scope bar to both pages** (reuse component)

- [ ] **Step 3: Add page tests** (mirror pl/page.test.tsx if exists, or minimal render tests)

- [ ] **Step 4: Commit** `feat(ui): report scope on balance sheet and trial balance`

---

### Task 9: Manual voucher branch picker

**Files:**
- Modify: `apps/frontend/src/app/(app)/accounting/vouchers/new/page.tsx`
- Modify: `CreateVoucherDto` usage in api.ts

- [ ] **Step 1: Add Branch dropdown** — default `localStorage store_id`, option "Company-wide"

- [ ] **Step 2: Send `storeId` / `attribution` on create**

- [ ] **Step 3: Manual test** — create branch voucher, verify in branch P&L

- [ ] **Step 4: Commit** `feat(ui): branch attribution on manual voucher entry`

---

## Phase 2: Compare Matrix

### Task 10: Compare scope backend for P&L

**Files:**
- Modify: `apps/backend/src/accounting/accounting.service.ts`
- Modify: `apps/backend/src/accounting/accounting.service.spec.ts`

- [ ] **Step 1: Write failing test** — compare returns columns for 2 stores + total

- [ ] **Step 2: Implement `buildCompareMatrix`** in `report-scope.utils.ts` — group voucher details by `store_id` (null → `company` key)

- [ ] **Step 3: Extend `getProfitLoss`** when `scope=compare`

- [ ] **Step 4: Run tests** — PASS

- [ ] **Step 5: Commit** `feat(accounting): compare-matrix P&L`

---

### Task 11: Compare matrix for Balance Sheet

**Files:**
- Modify: `accounting.service.ts`, specs

- [ ] **Step 1: Failing test for BS compare columns**

- [ ] **Step 2: Implement** (reuse matrix builder)

- [ ] **Step 3: Commit** `feat(accounting): compare-matrix balance sheet`

---

### Task 12: Compare UI — matrix table component

**Files:**
- Create: `apps/frontend/src/components/accounting/CompareMatrixTable.tsx`
- Modify: `pl/page.tsx`, `balance-sheet/page.tsx`
- Modify: i18n files

- [ ] **Step 1: Render matrix** when `scope=compare` — sticky header row for branch names, account rows, subtotals

- [ ] **Step 2: Multi-select branches** in ReportScopeBar

- [ ] **Step 3: Optional CSV export** button (client-side from matrix JSON)

- [ ] **Step 4: Commit** `feat(ui): compare-matrix report table`

---

### Task 13: E2E — branch comparison

**Files:**
- Modify: `apps/frontend/e2e/accounting.spec.ts`
- Modify: `apps/frontend/e2e/helpers/accounting.ts`

- [ ] **Step 1: AC-Branch-01** — two branches, sales, compare P&L shows two columns

- [ ] **Step 2: Run `npm run test:e2e:accounting`** — PASS

- [ ] **Step 3: Commit** `test(e2e): multi-branch compare P&L`

---

## Phase 3: Inter-Branch Fund Transfers

### Task 14: Bootstrap inter-branch clearing accounts

**Files:**
- Modify: `packages/database/prisma/bootstrap-accounting.ts`
- Modify: `apps/backend/src/accounting/bootstrap-accounting.spec.ts`

- [ ] **Step 1: Add accounts 1040 Due from Branches, 2040 Due to Branches**

- [ ] **Step 2: `ensureInterBranchAccounts(tenantId)`** idempotent helper

- [ ] **Step 3: Test** — PASS

- [ ] **Step 4: Commit** `feat(accounting): inter-branch clearing accounts bootstrap`

---

### Task 15: Fund transfers NestJS module

**Files:**
- Create: `apps/backend/src/fund-transfers/fund-transfers.module.ts`
- Create: `apps/backend/src/fund-transfers/fund-transfers.service.ts`
- Create: `apps/backend/src/fund-transfers/fund-transfers.controller.ts`
- Create: `apps/backend/src/fund-transfers/fund-transfers.dto.ts`
- Create: `apps/backend/src/fund-transfers/fund-transfers.service.spec.ts`
- Modify: `apps/backend/src/app.module.ts`

- [ ] **Step 1: Write failing tests** — initiate creates transfer + source voucher; receive creates destination voucher

- [ ] **Step 2: Implement `initiate`** — validate stores, permission, post source leg

- [ ] **Step 3: Implement `receive`** — post destination leg, update status

- [ ] **Step 4: Implement `list` / `get`**

- [ ] **Step 5: Register module**

- [ ] **Step 6: Run tests** — PASS

- [ ] **Step 7: Commit** `feat(fund-transfers): inter-branch cash transfer service`

---

### Task 16: Fund transfers frontend

**Files:**
- Create: `apps/frontend/src/app/(app)/accounting/inter-branch/fund-transfers/page.tsx`
- Modify: `accounting-nav.ts`, `routes.ts`, `api.ts`, i18n

- [ ] **Step 1: List page** with status badges, create modal

- [ ] **Step 2: Initiate and receive actions**

- [ ] **Step 3: Show linked voucher numbers**

- [ ] **Step 4: Commit** `feat(ui): inter-branch fund transfers page`

---

### Task 17: E2E fund transfer

**Files:**
- Modify: `e2e/accounting.spec.ts`

- [ ] **Step 1: AC-Branch-02** — fund transfer moves cash between branches in branch BS

- [ ] **Step 2: Run e2e** — PASS

- [ ] **Step 3: Commit** `test(e2e): inter-branch fund transfer`

---

## Phase 4 (Optional): Cost Center Drill-Down

### Task 18: Cost center on voucher lines

**Files:**
- Modify: `CreateVoucherDetailDto`, voucher create service, vouchers/new UI

- [ ] **Step 1: Add optional `costCenterId` per line**

- [ ] **Step 2: P&L branch scope + optional `costCenterId` filter**

- [ ] **Step 3: Commit** `feat(accounting): optional cost center on voucher lines`

---

## Verification Checklist (before merge)

- [ ] `npm test` backend accounting + fund-transfers specs green
- [ ] Frontend tests for ReportScopeBar and report pages green
- [ ] `npm run test:e2e:accounting` green (including new branch tests)
- [ ] Manual: branch P&L ≠ company P&L when branches have different sales
- [ ] Manual: compare view shows side-by-side columns
- [ ] Manual: fund transfer updates both branch balance sheets

---

## Suggested PR Stack

1. **PR1 (Phase 1):** Schema + auto-tag + branch/company scope + scope bar + voucher picker
2. **PR2 (Phase 2):** Compare matrix backend + UI + E2E
3. **PR3 (Phase 3):** Fund transfers + clearing accounts + E2E
4. **PR4 (Phase 4):** Cost center drill-down (optional)