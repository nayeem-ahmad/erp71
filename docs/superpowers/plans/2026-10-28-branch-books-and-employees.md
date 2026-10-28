# Branch cash drawers, filtered books, and branch employees — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A branch user sees and posts only that branch's cash drawer, sees shared bank and wallet balances filtered to that branch, and sees only that branch's employees and payroll.

**Architecture:** One cash drawer per branch (`Account.store_id` set, category `cash`). Banks and wallets stay `store_id` null and any branch may post to them; reads filter voucher lines by `BranchScopeService`. A pure planner (`sync-branch-books.utils.ts`) decides the historical fold; the CLI applies it. Posting resolves cash to the voucher branch's drawer and bank/wallet to the shared account. Employees gain a required home branch; payroll runs are unique per branch.

**Tech Stack:** NestJS, Prisma/PostgreSQL, Next.js 15, Jest (`--testPathPatterns`), nine frontend locales.

**Spec:** `docs/superpowers/specs/2026-10-28-branch-books-and-employees-design.md`

## Global Constraints

- Check: `store_id IS NULL OR category = 'cash'`. `store_id` set means that branch's cash drawer. Category `bank` is always null. Category `cash` with null `store_id` is a wallet.
- Drop `@@unique([tenant_id, name])` on `Account`. Partial uniques live only in SQL: `(tenant_id, name) WHERE store_id IS NULL`, and `(tenant_id, store_id) WHERE store_id IS NOT NULL`.
- A cash drawer is category `cash`, is not the linked account of a `Mobile Wallet` payment method, and is not named `bKash Account` or `Nagad Account`.
- Drawer pick is not a hardcoded tenant. Most lines of that branch win. Tie: the account whose own lines are mostly that branch, then the oldest account (`created_at`, then `id`). An account belongs to the one branch with the most lines on it. Tie between branches: the older store (`created_at`, then `id`) keeps the account.
- Main branch is the oldest physical store by `created_at` then `id`. Never a store named `Online Store` (see `ONLINE_BRANCH_NAME` in `packages/database/prisma/party-branch.utils.ts`).
- Do not move the 1,341 Press Club lines already on Main Cash (LT) `110112` / account `9df1d62c-b797-4111-9ffc-17a22862c4f0`. Do not clone banks or wallets. Do not run the production sync until a dry-run is reviewed. Rollback table `kh_cash_branch_fix_20261028` stays.
- KH Trading tenant `5e7c7f4a-3d21-4c6d-bf4b-f909e57b54f7`, stored as "KH Tradind". Babu Bazar CF `5998f11f-70ff-4eec-a1c8-c42418cd461b`. Press Club LT `501fed1b-9732-44fa-98b1-271fae2bc135`. Main Cash (CF) `110101` account `f5a45408-79b0-4b70-b3af-bc2fe806085d`. Cash in Hand `110113`. Premier Bank 186 `110102`.
- Employee phone and employee code stay unique per tenant. Department delete message is exactly `This department is still in use.` Designation message is exactly `This designation is still in use.` No name and no count.
- Payroll unique becomes `(tenant_id, year, month, kind, store_id)`. Legacy mixed runs keep `store_id` null. Postgres treats those nulls as distinct.
- `Employee.store_id` stays nullable in the first migration. The sync sets `NOT NULL` only on a full `--yes` run that leaves zero null employees. A `--tenant` run must not alter the column. Schema keeps `String?` until that alter has shipped as its own migration after production is filled. Application create still requires a branch.
- No new permission. Branch access and `VIEW_CONSOLIDATED_REPORTS` are the gates. Report `storeId` resolves with `VIEW_LEDGER`. Other drawer or hidden employee is `404`. A branch the caller cannot use is `403`.
- `packages/database` has no build step. `bootstrap-accounting.js` and `payment-method.seed.js` are the files Node runs. Every edit to the `.ts` twin is ported to the `.js` in the same commit.
- Sync is dry-run unless `--yes`. Optional `--tenant=<uuid>`. Idempotent. One transaction per tenant. An unplaceable drawer voucher aborts that tenant and writes nothing.
- Nine locales: en, bn, ms, hi, de, fr, es, ur, ar. UI uses `PageShell`, `ModalShell`, `blue-600`, `formatBDT`. Money is never a literal `$`.
- Do not commit `TODO.md` in a docs-only commit. Do not commit on `main`. Author `Nayeem Ahmad <nayeem.ahmad@gmail.com>`. No `Co-Authored-By` trailer.
- Jest flag is `--testPathPatterns`. Run backend tests from `apps/backend`.

## Review Focus

- A `BANK_TRANSFER` or `CHECK` between branches must credit and debit the same shared bank and must not touch either drawer. Company bank total stays flat. Task 8.
- Re-running the planner on an already-folded KH snapshot must emit no line moves, no new drawer, and no second Cash method. Task 1.
- A category `cash` account linked from a `Mobile Wallet` method stays shared even when its name is not `bKash Account` or `Nagad Account`. Task 1.
- Department delete of a row whose only employees sit at the other branch is still refused, and the error string contains neither a count nor an employee name. Task 11.
- `GET /fund-transfers/:id` for a transfer the caller is not a side of is `404`, including when they know the id. Task 8.

---

### Task 1: Fold planner

**Files:**
- Create: `packages/database/prisma/sync-branch-books.utils.ts`
- Test: `apps/backend/src/accounting/sync-branch-books.spec.ts`

**Interfaces:**
- Produces:
  - `isCashDrawer(account: { id: string; name: string; category: string }, walletAccountIds: ReadonlySet<string>): boolean`
  - `mainBranch(branches: BranchRef[]): BranchRef | null` where `BranchRef = { id: string; name: string; createdAt: string }` and a name equal to `ONLINE_BRANCH_NAME` (case-insensitive) is skipped. Oldest `createdAt`, then `id`.
  - `planBranchBooks(input: BranchBooksInput): BranchBooksPlan`
  - `planEmployeeBranch(input: EmployeeBranchInput): { storeId: string; fallbackToMain: boolean }`
  - `planPayrollStore(employeeStoreIds: readonly (string | null)[]): string | null`
  - `planCashMethods(input: CashMethodInput): CashMethodPlan`

`BranchBooksInput` fields: `branches: BranchRef[]`, `accounts: { id, name, code, category, createdAt, storeId: string | null }[]`, `walletAccountIds: string[]`, `lines: { detailId, voucherId, voucherNumber, voucherDate, accountId, storeId: string | null, sourceStoreId: string | null, partyStoreId: string | null, debit, credit }[]` (drawer lines only; the caller filters with `isCashDrawer`), `rulesAndMethodsPointingAt: { accountId: string }[]` (account ids still referenced by a posting rule or payment method).

`BranchBooksPlan` fields:
- `aborted: boolean`
- `unplaced: { voucherNumber, voucherDate, accountName, debit, credit }[]`
- `voucherBranches: { voucherId, storeId }[]`
- `drawerAssignments: { accountId, storeId }[]`
- `newDrawers: { storeId, name, cloneFromAccountId }[]`
- `lineMoves: { detailId, fromAccountId, toAccountId }[]`
- `retargets: { fromAccountId, toAccountId }[]`
- `retireAccountIds: string[]`
- `blockedRetire: { accountId, reason: string }[]`

Place a null `storeId` from `sourceStoreId`, else `partyStoreId`, else the only physical branch. Anything left aborts: `aborted` true, `unplaced` filled, every other array empty.

Assign each drawer account to the branch with the most of its lines (after placement). Tie: older branch. Each branch's drawer is the assigned account with the most of that branch's lines. Tie: account whose lines are mostly that branch (higher share of its own lines), then oldest `createdAt`, then `id`. A branch with lines and no assigned account gets `newDrawers` named after the account those lines leave most often (`cloneFromAccountId` is that account). Lines not already on the branch drawer go in `lineMoves`. An account that is not a chosen drawer and has no lines left is retired. Retarget only when every moved line from it went to one `toAccountId`. Otherwise `blockedRetire` and it is not in `retireAccountIds`. Lines already on the chosen drawer are not in `lineMoves`.

`planEmployeeBranch`: one physical branch → that branch, `fallbackToMain` false. Else exactly one id in `userStoreIds` → that id, false. Else the punch store with the strictly highest `count` in `punchCounts: { storeId, count }[]`. Tie or no punches → `mainBranch`, `fallbackToMain` true.

`planPayrollStore`: one distinct non-null id and no nulls → that id. Empty, mixed, or any null → null.

`planCashMethods`: methods with `type === 'Cash'`. The existing row whose `accountId` is a drawer is narrowed to `{ methodId, accountId: drawerId, storeId: drawer.storeId }`. Each other branch's drawer that has no Cash method yet is a create `{ name: 'Cash', storeId, accountId, copyFromMethodId }`. A Cash method already pointing at that branch's drawer with `allBranches: false` and `storeIds` equal to that one store produces no update and no create. Non-Cash methods are ignored.

- [ ] **Step 1: Write the failing tests** in `apps/backend/src/accounting/sync-branch-books.spec.ts`. Import from `@erp71/database/prisma/sync-branch-books.utils`.

Cover, with the KH ids from Global Constraints:
- `isCashDrawer` is false for Premier Bank (`category: 'bank'`), false for `bKash Account` and `Nagad Account`, false for a category `cash` id present in `walletAccountIds` even when named `Upay`, true for Main Cash (CF) and Cash in Hand.
- Null-store drawer line with `sourceStoreId` Press Club is placed on Press Club. A line with no source and no party aborts: `aborted` true, that voucher number in `unplaced`, `lineMoves` empty.
- Press Club lines on CF move to LT. The 1,341 already on LT are absent from `lineMoves`. Babu Bazar lines on Cash in Hand move to CF. A Premier Bank line is not in the input and cannot appear in `lineMoves`. Cash in Hand is in `retireAccountIds` with retarget to CF. CF is assigned Babu Bazar. LT is assigned Press Club.
- One shared cash account used by two branches, majority Babu Bazar: Babu Bazar keeps it, Press Club gets `newDrawers` with that account's name, Press Club lines move to the new drawer key (use `toAccountId` equal to `new:<storeId>` until the script allocates an id).
- Employee with a single `userStoreIds` entry gets that store and `fallbackToMain` false. Employee with two accesses and a punch tie gets the main branch (older store, not `Online Store`) and `fallbackToMain` true.
- `planPayrollStore(['bb', 'bb'])` is `bb`. `planPayrollStore(['bb', 'pc'])` is null. `planPayrollStore(['bb', null])` is null.
- Second `planBranchBooks` call on the post-fold snapshot (LT store already Press Club, CF already Babu Bazar, Cash in Hand gone, lines only on those drawers) returns empty `lineMoves`, empty `newDrawers`, empty `retireAccountIds`.
- `planCashMethods` splits one all-branches Cash on CF into an update for Babu Bazar and a create for Press Club → LT. A second call with two Cash methods already narrowed returns no updates and no creates. A Bank method is ignored.

- [ ] **Step 2: Run the test**

Run from `apps/backend`: `npx jest --testPathPatterns=src/accounting/sync-branch-books.spec.ts --forceExit`

Expected: FAIL, module not found.

- [ ] **Step 3: Implement the five functions** in `packages/database/prisma/sync-branch-books.utils.ts`. No Prisma import. New drawer ids in `lineMoves.toAccountId` and `retargets.toAccountId` are `new:<storeId>`.

- [ ] **Step 4: Re-run the test**

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/database/prisma/sync-branch-books.utils.ts apps/backend/src/accounting/sync-branch-books.spec.ts
git commit -m "feat: plan one cash drawer per branch"
```

---

### Task 2: Schema

**Files:**
- Modify: `packages/database/prisma/schema.prisma` (`Account` ~4213, `Employee` ~5842, `PayrollRun` ~6336, `Store` relation back-refs)
- Create: `packages/database/prisma/migrations/20261028140000_branch_cash_drawers/migration.sql`
- Modify: every `account.findUnique({ where: { tenant_id_name` on `Account` — `apps/backend/src/accounting/accounting.service.ts` (create ~404, update ~716), `apps/backend/src/platform-accounting/platform-accounting.service.ts` (~657), `packages/database/prisma/bootstrap-accounting.ts` (~750, ~964, ~993) and the same sites in `bootstrap-accounting.js`. Account group lookups stay.

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: `Account.store_id String?` relation `Store` `onDelete: Restrict`, index `@@index([tenant_id, store_id])`. `Employee.store_id String?` same relation and index. `PayrollRun.store_id String?` same relation. Payroll `@@unique([tenant_id, year, month, kind, store_id])`. No `@@unique([tenant_id, name])` on `Account`.

Shared-name lookup becomes `findFirst({ where: { tenant_id, name, store_id: null } })`. Drawer names may repeat, so a clash on create/update is a shared account (`store_id` null) with that name, or another drawer of the same branch (enforced in Task 4). Do not use `findUnique` on the dropped key.

Migration SQL:
- `ALTER TABLE accounts ADD COLUMN store_id TEXT` plus FK to `"Store"(id)` `ON DELETE RESTRICT` and index `(tenant_id, store_id)`.
- Drop the accounts `(tenant_id, name)` unique index (Prisma name `accounts_tenant_id_name_key`).
- `CREATE UNIQUE INDEX accounts_shared_name_key ON accounts (tenant_id, name) WHERE store_id IS NULL`
- `CREATE UNIQUE INDEX accounts_one_drawer_per_branch ON accounts (tenant_id, store_id) WHERE store_id IS NOT NULL`
- `ALTER TABLE accounts ADD CONSTRAINT accounts_store_id_cash_only CHECK (store_id IS NULL OR category = 'cash')`
- `ALTER TABLE "Employee" ADD COLUMN store_id TEXT` nullable, FK, index. Do not set NOT NULL.
- `ALTER TABLE payroll_runs ADD COLUMN store_id TEXT` nullable, FK.
- Drop `payroll_runs_tenant_id_year_month_kind_key`. Create unique `(tenant_id, year, month, kind, store_id)`.

- [ ] **Step 1: Write a migration SQL file and update `schema.prisma`.** Then replace Account `tenant_id_name` lookups listed above with `findFirst` on `tenant_id + name + store_id: null`. Port the bootstrap lookups into `bootstrap-accounting.js`.

- [ ] **Step 2: Generate the client**

`npx prisma generate --schema packages/database/prisma/schema.prisma`

Expected: generate succeeds. Then `npx jest --testPathPatterns=src/accounting/account-crud.spec.ts --forceExit` from `apps/backend`. Expected: PASS (mocks still satisfy `findFirst` if the spec calls `findUnique`; update those mocks to `findFirst` in the same step so this command passes).

- [ ] **Step 3: Commit**

```bash
git add packages/database/prisma/schema.prisma packages/database/prisma/migrations/20261028140000_branch_cash_drawers/migration.sql packages/database/prisma/bootstrap-accounting.ts packages/database/prisma/bootstrap-accounting.js apps/backend/src/accounting/accounting.service.ts apps/backend/src/accounting/account-crud.spec.ts apps/backend/src/platform-accounting/platform-accounting.service.ts
git commit -m "feat: add branch columns for drawers, employees, and payroll"
```

---

### Task 3: Sync script

**Files:**
- Create: `packages/database/prisma/sync-branch-books.ts`
- Modify: `packages/database/package.json` (script `"sync:branch-books": "tsx prisma/sync-branch-books.ts"`)

**Interfaces:**
- Consumes: `planBranchBooks`, `planEmployeeBranch`, `planPayrollStore`, `planCashMethods`, `isCashDrawer`, `mainBranch` from Task 1.
- Produces: CLI. Default dry-run prints the plan per tenant and rolls back. `--yes` commits. `--tenant=<uuid>` limits to one tenant. Exit code 1 if any tenant aborted or any `blockedRetire` is non-empty.

Load, per tenant: physical stores; accounts; payment methods of type `Mobile Wallet` (their `account_id`s are `walletAccountIds`) plus methods named such that the linked account is a wallet; voucher details whose account is a drawer, with voucher number, date, `store_id`, and a resolved `sourceStoreId` from the source document (sale, sale return, purchase, purchase return, expense, loan, loan payment, payroll/salary, customer payment via `CustomerCreditTransaction.store_id`, supplier payment via `SupplierCreditTransaction.store_id`, fund transfer initiate → `source_store_id`, fund transfer receive → `destination_store_id`). `partyStoreId` from the voucher line's customer or supplier `store_id`. Employees with `user_id`, that user's `UserStoreAccess` store ids, and attendance punch counts grouped by `store_id`. Payroll runs with their lines' employee ids.

Apply order inside one transaction: voucher `store_id` + `attribution = 'BRANCH'`; set drawer `store_id`; create `newDrawers` with `nextAccountCode` and the clone's group, subgroup, type, category `cash`, then rewrite `new:<storeId>` targets to the new id; move lines; retarget posting-rule debit/credit and payment-method `account_id`; delete retired accounts; narrow/create Cash methods (`all_branches` false, one `PaymentMethodStore` row, same `sort_order` as the copied Cash row); set employee `store_id` and print `fallbackToMain` rows as `<code> <name> → <branch name>`; set payroll `store_id` only when `planPayrollStore` returns an id.

Idempotent: do not update a voucher that already has `store_id`. Do not delete an account that still has details. After a full `--yes` (no `--tenant`) if `Employee.store_id` is null for zero rows, `ALTER TABLE "Employee" ALTER COLUMN store_id SET NOT NULL`. Skip that alter on `--tenant` or dry-run.

Dry-run prints, for KH-shaped data: LT holds its lines plus moved CF Press Club lines; CF holds its lines plus Cash in Hand lines and no Press Club lines; Cash in Hand retired; bank and wallet accounts not in assignments; Cash method create/update lines; employee fallbacks.

- [ ] **Step 1: Implement the script.** No new unit test; Task 1 locks the decisions. The script only loads and applies.

- [ ] **Step 2: Typecheck the script**

`npx tsc --noEmit --pretty false -p packages/database/tsconfig.json` if that project includes the prisma scripts; otherwise `npx tsx --eval "import './packages/database/prisma/sync-branch-books.ts'"` is wrong because the file runs `main()`. Instead run `npx tsx packages/database/prisma/sync-branch-books.ts --tenant=00000000-0000-0000-0000-000000000000` against the local database.

Expected: dry-run completes, prints that the tenant was not found or that there was nothing to do, exit 0, and no row changes (`git` is irrelevant; confirm the log says dry-run and does not say committed).

- [ ] **Step 3: Commit**

```bash
git add packages/database/prisma/sync-branch-books.ts packages/database/package.json
git commit -m "feat: add the branch-books sync script"
```

Do not run this against production.

---

### Task 4: Account create and update rules

**Files:**
- Modify: `apps/backend/src/accounting/accounting.service.ts` `createAccount` / `updateAccount`
- Modify: the account DTO that feeds those methods (same module)
- Test: `apps/backend/src/accounting/account-crud.spec.ts`

**Interfaces:**
- Consumes: `Account.store_id` from Task 2. `isCashDrawer` rule from Task 1, copied into `apps/backend/src/accounting/cash-drawer.ts` as `isCashDrawer(account, walletAccountIds)` with the same three exclusions. A short test in `cash-drawer.spec.ts` pins: bank false, `bKash Account` false, wallet-linked id false, plain cash true.
- Produces: `createAccount` / `updateAccount` accept `storeId?: string | null`.

Rules:
- New drawer (`isCashDrawer` after the save, or category `cash` and not a wallet name and not a wallet-linked id): `storeId` required. Reject when that branch already has a drawer (`409` or the existing bad-request style used for name clashes — use `BadRequestException` with `This branch already has a cash drawer.`).
- Category `bank`, a wallet, or any other non-drawer: `storeId` present → `BadRequestException` `Only a cash drawer belongs to a branch.`
- Shared name clash stays `An account with this name already exists.` when another `store_id` null account has the name. Two drawers may share a name.
- `findAccounts` is Task 5. This task only changes create/update.

- [ ] **Step 1: Add failing cases** to `account-crud.spec.ts`: bank with `storeId` rejected; second drawer for the same branch rejected; `bKash Account` with no `storeId` accepted; two `storeId`s each accepted once.

- [ ] **Step 2: Run** `npx jest --testPathPatterns=src/accounting/account-crud.spec.ts --forceExit` from `apps/backend`. Expected: FAIL on the new cases.

- [ ] **Step 3: Implement the checks and `cash-drawer.ts`.**

- [ ] **Step 4: Re-run.** Expected: PASS.

- [ ] **Step 5: Commit** `feat: require a branch on a new cash drawer`

---

### Task 5: Chart, ledger, cash book, bank book

**Files:**
- Modify: `apps/backend/src/accounting/accounting.service.ts` (`findAccounts`, `findLedger`, `getCashbook`, `getBankbook` / `buildBookReport`)
- Modify: `apps/backend/src/accounting/accounting.controller.ts` so those routes pass `storeId` through `branchScope.resolveStoreId(..., { permissions: VIEW_LEDGER })`
- Test: new `apps/backend/src/accounting/branch-books.spec.ts` (service-level, mocked db) or extend the existing report spec if one already mocks these methods. Prefer a focused spec file.

**Interfaces:**
- Consumes: `resolveStoreId` returns `string | undefined` (`undefined` means all branches).
- Produces: the four reads take `storeId: string | undefined`.

When `storeId` is a branch:
- Chart rows: shared accounts (`store_id` null) plus that branch's drawer. Omit other drawers. Balance sums voucher details whose voucher `store_id` equals that branch. Shared bank row is present.
- Ledger of another branch's drawer: `NotFoundException`.
- Ledger of a shared account: only that branch's vouchers.
- Cash book: that drawer only. Bank book: category `bank` and wallet accounts (category `cash`, `store_id` null), lines limited to the branch.
- `storeId === undefined` (consolidated): every drawer, every voucher including `store_id` null.

- [ ] **Step 1: Failing tests** for the limited member and the company view, using the KH account names only as fixture labels (no production calls).

- [ ] **Step 2: Run the spec.** Expected: FAIL.

- [ ] **Step 3: Implement the filters.** Do not add the filter inside `BranchScopeService` itself.

- [ ] **Step 4: Re-run.** Expected: PASS.

- [ ] **Step 5: Commit** `feat: filter chart and cash books by branch`

---

### Task 6: Other reports, export, balance sheet

**Files:**
- Modify: accounting report methods for AR/AP aging, comparative P&L, VAT/tax, financial ratios, cash flow, budget vs actual, cost-center P&L, Tally export, QuickBooks export, and the balance-sheet account query.
- Modify: their controller queries to resolve `storeId` with `VIEW_LEDGER` the same way Task 5 does. Statements that already resolve a scope must keep that behavior and also drop the other branch's drawer from a branch-scoped balance sheet.

**Interfaces:**
- Consumes: Task 5's rule: branch scope sums `voucher.store_id = branch` and omits drawers whose `store_id` is a different branch.
- Produces: the same `storeId` query param on each listed route.

- [ ] **Step 1: One failing balance-sheet test:** branch scope omits the other drawer and includes the shared bank at that branch's figure only. One failing aging test: the other branch's open invoice is absent.

- [ ] **Step 2: Run those specs.** Expected: FAIL.

- [ ] **Step 3: Thread `storeId` through the listed report queries.** Export uses the same where-clause as the ledger.

- [ ] **Step 4: Re-run the two specs plus the existing statement spec if one covers balance sheet.** Expected: PASS.

- [ ] **Step 5: Commit** `feat: scope aging, statements export, and drawer rows`

---

### Task 7: Posting resolution

**Files:**
- Create: `apps/backend/src/accounting/cash-account.ts` (or extend `payment-account.util.ts` if that file already chooses the tender account)
- Modify: `autoPostFromRules` callers that post a cash or bank leg without an override: expenses (`expenses.service.ts`), salary payment (`salary-payments.service.ts` `postSalaryPayment`), and any sale/purchase path that uses the rule's single cash account when no tender account was resolved. Manual voucher save in `accounting.service.ts` (`validateVoucherTypeRules` area and the create/update voucher path).
- Test: `apps/backend/src/accounting/cash-account.spec.ts` and a voucher-validation spec.

**Interfaces:**
- Consumes: `isCashDrawer` from `cash-drawer.ts`.
- Produces:
  - `resolveMoneyAccount(input: { mode: 'cash' | 'bank' | 'wallet'; storeId: string | null; tenderAccount: { id: string; storeId: string | null; category: string; name: string } | null; branchDrawer: { id: string; storeId: string } | null; sharedAccountId: string | null }): { accountId: string } | { error: 'NO_BRANCH' | 'DRAWER_BRANCH_MISMATCH' | 'NO_DRAWER' }`
  - Behavior: tender drawer whose `storeId` equals the voucher branch → that account. Tender drawer for another branch → `DRAWER_BRANCH_MISMATCH`. Tender bank/wallet → that shared account. No tender and mode `cash` → `branchDrawer` for `storeId`, else `NO_DRAWER`. Mode `cash` and `storeId` null → `NO_BRANCH`. Mode `bank` or `wallet` → `sharedAccountId`.

Manual voucher: a detail whose account is a drawer must have `account.store_id === voucher.store_id`. Mismatch or missing voucher branch → `BadRequestException`. A bank or wallet line is allowed on any branch.

Salary accrual has no cash leg. Stamp `storeId` with the employee's `store_id` (Task 12 wires the employee; this task only posts when `storeId` is passed). Salary payment uses `resolveMoneyAccount` mode `cash` and the employee's branch. Expense uses the expense's `store_id`.

- [ ] **Step 1: Failing unit tests:** Press Club cash with drawer LT returns LT. Babu Bazar drawer passed as the tender on a Press Club voucher returns `DRAWER_BRANCH_MISMATCH`. Press Club bank tender Premier Bank returns that same id. Cash with `storeId` null returns `NO_BRANCH`.

- [ ] **Step 2: Run.** Expected: FAIL.

- [ ] **Step 3: Implement and call it from the expense cash leg, salary payment, and manual voucher validation.** Where a caller already passes `overrideDebitAccountId` / `overrideCreditAccountId` from a resolved tender, keep the tender and run it through `resolveMoneyAccount` first.

- [ ] **Step 4: Re-run.** Expected: PASS.

- [ ] **Step 5: Commit** `feat: post cash to the branch drawer`

---

### Task 8: Fund transfers

**Files:**
- Modify: `apps/backend/src/fund-transfers/fund-transfers.service.ts` (`initiate`, `receive`, `get`)
- Test: `apps/backend/src/fund-transfers/fund-transfers.service.spec.ts` (create if the existing spec only mocks the module)

**Interfaces:**
- Consumes: `resolveMoneyAccount` from Task 7. `autoPostFromRules` already accepts `overrideCreditAccountId` and `overrideDebitAccountId`.
- Produces: no DTO field. Method stays `CASH | CHECK | BANK_TRANSFER`.

`initiate`: `CASH` overrides the credit with the source branch drawer (`NO_DRAWER` / `NO_BRANCH` → `BadRequestException`). `BANK_TRANSFER` and `CHECK` override the credit with the Bank payment method offered at the source store. That account must not be a drawer (`isCashDrawer` → `BadRequestException` `A bank transfer cannot use a cash drawer.`). Missing Bank method → `BadRequestException` `No bank account is set up for this branch.`

`receive`: `CASH` overrides the debit with the destination drawer. `BANK_TRANSFER` and `CHECK` override the debit with the credit account on the source voucher that is not Due from Branches.

`get`: load the transfer only when the caller can see `source_store_id` or `destination_store_id`. Otherwise `NotFoundException`. List already ORs the two stores; leave that filter, and still resolve a requested `storeId` through `BranchScopeService`.

- [ ] **Step 1: Failing tests** with Babu Bazar drawer CF `f5a45408-79b0-4b70-b3af-bc2fe806085d`, Press Club drawer LT `9df1d62c-b797-4111-9ffc-17a22862c4f0`, Premier Bank `110102`. Cash initiate credit override is CF. Cash receive debit override is LT. Bank initiate and receive both use Premier Bank and neither override is CF or LT. `get` of a transfer between two other stores throws `NotFoundException`.

- [ ] **Step 2: Run.** Expected: FAIL.

- [ ] **Step 3: Implement the overrides.** Do not add a bank-account column.

- [ ] **Step 4: Re-run.** Expected: PASS.

- [ ] **Step 5: Commit** `feat: post fund transfers to the drawer or the shared bank`

---

### Task 9: Payment-method invariant

**Files:**
- Modify: `apps/backend/src/payment-methods/payment-methods.service.ts` create and update
- Test: the existing payment-methods service spec, or `payment-methods.service.spec.ts` next to the service

**Interfaces:**
- Consumes: `isCashDrawer`.
- Produces: create/update return `BadRequestException` when the linked account is a drawer and (`all_branches` is true or any store id is not the drawer's `store_id`). A bank or wallet account does not trip the check. Message: `A cash drawer can only be used at its own branch.`

- [ ] **Step 1: Failing tests** for drawer + all branches, drawer + other branch, bank + all branches accepted.

- [ ] **Step 2: Run.** Expected: FAIL.

- [ ] **Step 3: Implement.**

- [ ] **Step 4: Re-run.** Expected: PASS.

- [ ] **Step 5: Commit** `feat: keep a cash-drawer method on its own branch`

---

### Task 10: Bootstrap and a new store

**Files:**
- Modify: `packages/database/prisma/bootstrap-accounting.ts` and `.js` (first store's Cash in Hand gets `store_id`)
- Modify: `packages/database/prisma/payment-method.seed.ts` and `.js` (Cash method `all_branches` false, one store row for that first store; Bank, bKash, Nagad stay `all_branches` true)
- Modify: the store-create path (`apps/backend/src/stores/`) so a later store creates one cash drawer (name `Cash in Hand`, next code, category `cash`, that `store_id`) and one Cash method for that store only. It does not copy banks or wallets.

**Interfaces:**
- Consumes: Task 2 columns, Task 9 invariant.
- Produces: `ensureBranchCashDrawer(client, tenantId, storeId): Promise<{ accountId: string; methodId: string }>` in the seed module the store service already calls, or beside it if no seed hook exists. Idempotent: if the branch already has a drawer, do not create another.

- [ ] **Step 1: Failing test** that a second store does not create an account named `Main Bank Account` or `bKash Account`, and does create one drawer with that `store_id` and one Cash method limited to it.

- [ ] **Step 2: Run.** Expected: FAIL.

- [ ] **Step 3: Implement.** Mirror `.js` files.

- [ ] **Step 4: Re-run.** Expected: PASS.

- [ ] **Step 5: Commit** `feat: open a branch with one cash drawer`

---

### Task 11: Employees and departments

**Files:**
- Modify: `apps/backend/src/employees/employees.service.ts` and DTOs
- Modify: `apps/backend/src/employees/employees.controller.ts` to resolve list `storeId` with the route's existing HR permission via `BranchScopeService`
- Test: employees service spec (create if absent)

**Interfaces:**
- Consumes: `Employee.store_id`.
- Produces: create/update require `storeId`. List and `findOne` filter to the resolved branch. An employee outside the caller's branches is `NotFoundException` on read, update, and delete. Moving branch is allowed only when the caller can see both the current and the next store; otherwise `404` on the employee or `403` from `resolveStoreId` for the destination. `deleteDepartment` and `deleteDesignation` still count every non-deleted employee in the tenant. Messages exactly `This department is still in use.` and `This designation is still in use.`

- [ ] **Step 1: Failing tests:** list for store A excludes store B; get of B's employee is `NotFoundException`; department list still returns a department whose employees are all at B; delete throws the exact department sentence and the error does not match `/\d/` or the employee name.

- [ ] **Step 2: Run.** Expected: FAIL.

- [ ] **Step 3: Implement.**

- [ ] **Step 4: Re-run.** Expected: PASS.

- [ ] **Step 5: Commit** `feat: give each employee one home branch`

---

### Task 12: Payroll and salary vouchers

**Files:**
- Modify: `apps/backend/src/payroll/payroll-runs.service.ts` (`computeLines` and create/approve/pay/reopen/cancel)
- Modify: `apps/backend/src/salary-payments/salary-payments.service.ts` accrual and payment `storeId`
- Test: payroll run spec

**Interfaces:**
- Consumes: `PayrollRun.store_id`, employee `store_id`, `resolveMoneyAccount` from Task 7.
- Produces: create requires `storeId`. Lines are active employees with that `store_id` only. A second run for the same branch, month, and kind is the existing conflict. A null `store_id` run does not block it. Approve, pay, reopen, cancel, and payslip of a null run require consolidated access (`canSeeAllBranches` or `VIEW_CONSOLIDATED_REPORTS`); otherwise `ForbiddenException`. Accrual voucher `storeId` is the employee's branch. A branch user running accrual selects only their branch's employees. Consolidated accrual still writes one voucher per employee, each stamped with that employee's branch.

- [ ] **Step 1: Failing tests:** a branch run's `computeLines` query filters `store_id`; a legacy null run's pay path throws `ForbiddenException` for a non-consolidated caller.

- [ ] **Step 2: Run.** Expected: FAIL.

- [ ] **Step 3: Implement.**

- [ ] **Step 4: Re-run.** Expected: PASS.

- [ ] **Step 5: Commit** `feat: run payroll for one branch`

---

### Task 13: Attendance, leave, and the sales-rep picker

**Files:**
- Modify: attendance and leave services (filter by the employee's `store_id`, not the punch's `store_id`)
- Modify: the sales-rep employee query used by customers and sales so a document branch only offers employees with that `store_id`

**Interfaces:**
- Consumes: Task 11's employee `store_id`.
- Produces: a punch whose `store_id` is the other branch remains visible to the home branch and hidden from the other branch, because the employee is hidden. Leave and overtime follow the home branch. Existing sales keep `sales_rep_id`.

- [ ] **Step 1: Failing test:** listing attendance for branch A returns a punch clocked at B when the employee’s home branch is A, and listing B does not return that employee’s punch.

- [ ] **Step 2: Run.** Expected: FAIL.

- [ ] **Step 3: Implement the filters on the employee relation.**

- [ ] **Step 4: Re-run.** Expected: PASS.

- [ ] **Step 5: Commit** `feat: filter HR activity by the home branch`

---

### Task 14: Frontend

**Files:**
- Account form (chart settings): branch required when the account is a cash drawer; hidden for a bank or wallet.
- Employee form and list: branch required, default the header branch, list follows the branch filter.
- Payment-method form: hide All branches when the linked account is a drawer; leave it for a bank or wallet.
- Ledger, chart, cash book, bank book: pass the header branch as `storeId`.
- Payroll create: branch required; a one-branch member sees it fixed.
- Locales: `apps/frontend/src/lib/localization/messages/{en,bn,ar,de,es,fr,hi,ms,ur}/` plus the catalog test. New keys in all nine.

**Interfaces:**
- Consumes: the API fields `storeId` from Tasks 4, 5, 9, 11, and 12.
- Produces: no new routes. Copy for the delete errors is the API sentence; do not re-translate a count that no longer exists.

- [ ] **Step 1: Failing component tests** (frontend Jest, from `apps/frontend`): drawer form requires a branch; employee form requires a branch; payment-method form hides All branches for a drawer and shows it for a bank.

- [ ] **Step 2: Run** `npx jest --testPathPatterns=<those tests> --forceExit` from `apps/frontend`. Expected: FAIL.

- [ ] **Step 3: Implement the forms, the report `storeId` query, and the nine locale keys.**

- [ ] **Step 4: Re-run the component tests and `catalog.test.ts`.** Expected: PASS.

- [ ] **Step 5: Lint the touched Next files** from `apps/frontend`: `npx next lint --quiet --file <path>`. Expected: no errors.

- [ ] **Step 6: Commit** `feat: ask for a branch on drawers, employees, and payroll`

---

## Self-review

- Spec §1 columns and partial uniques: Task 2. Employee NOT NULL timing: Global Constraints and Task 3.
- Spec §2 reads: Tasks 5, 6, 11, 13. Account picker follows Task 5's chart query; the voucher form uses that list.
- Spec §3 posting and fund transfers: Tasks 7 and 8.
- Spec §4 HR: Tasks 11, 12, 13.
- Spec §5 migration and KH checks: Tasks 1 and 3. Production `--yes` is out of this plan until a dry-run is reviewed.
- Spec §6 API: Tasks 4, 5, 6, 9, 11, 12.
- Spec §7 files: each task names them. `bootstrap-accounting.js` mirror is a global constraint.
- Spec §8 tests: mapped onto Tasks 1, 4, 5, 6, 7, 8, 11, 12, 14.
- Review Focus rows are Tasks 1, 8, and 11.
