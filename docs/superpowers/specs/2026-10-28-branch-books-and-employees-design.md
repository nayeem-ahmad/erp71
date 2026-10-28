# Branch tills, filtered books, and branch employees

**Date:** 2026-10-28
**Status:** Approved for implementation 2026-10-28
**Asked as:** accounting and payment methods should be branch-wise, so a user
of one branch cannot see another branch's accounts or balances, and cannot
use the other branch's payment methods. Then: employees should be branch-wise
too; departments and designations stay tenant-wide.

---

## Problem

The chart of accounts is one list for the tenant. Cash, bank, bKash and Nagad
are single accounts, and several screens add up every branch's vouchers:
the chart balances, the account ledger, the cash book, the bank book, aging,
and the Tally and QuickBooks export. A branch user who opens Cash in Hand
sees the other branch's money.

Payment methods can already be limited to branches (`all_branches` and
`PaymentMethodStore`), and a tender is refused at the wrong branch. Methods
are created as all branches, and the account they post to is still the shared
till, so limiting the method does not hide the balance.

Employees, payroll, attendance and leave are tenant-wide. A branch user who
can open HR sees every employee's salary. Payroll is one run per company per
month (`@@unique([tenant_id, year, month, kind])`).

KH Trading (stored as "KH Tradind", tenant
`5e7c7f4a-3d21-4c6d-bf4b-f909e57b54f7`) is the shape this has to fit. It has
Babu Bazar (CF) and Press Club (LT). Main Cash (CF) and Main Cash (LT) were
created as two named tills because the chart cannot hold two accounts of one
name. On 2026-10-28, 1,341 imported payments with no voucher branch were
stamped Press Club and their cash lines were moved from Main Cash (CF) to
Main Cash (LT). After that, the tills look like this:

| Account | Branch on the voucher | Vouchers |
|---|---|---|
| Main Cash (CF) `110101` | Babu Bazar | 5,376 |
| Main Cash (CF) `110101` | Press Club | 801 |
| Main Cash (LT) `110112` | Press Club | 1,341 |
| Premier Bank 186 `110102` | Babu Bazar | 133 |
| Premier Bank 186 `110102` | Press Club | 5 |
| bKash Account `110103` | Press Club | 3 |
| Cash in Hand `110113` | Babu Bazar | 3 |

Nagad and the other bank accounts have no voucher lines. Cash, Bank, bKash,
Nagad and Card are payment methods offered at both branches. Bank (DBBL) is
already limited to Babu Bazar. The tenant has two employees.

## Decisions

1. **Only the physical cash drawer belongs to a branch.** One drawer per
   branch. Bank accounts stay shared: any branch may post to them, because
   there is nothing physical to separate. bKash and Nagad stay shared for
   the same reason. They are mobile wallets, not a drawer, even though the
   chart stores them as category `cash`.
2. **A branch user sees one branch at a time**, the branch filter that
   already exists. They see their own drawer and not the other branch's.
   On a shared account, including a bank or a wallet, they see only the
   balance of their branch's vouchers. They can still post to that bank.
   Owners and holders of `VIEW_CONSOLIDATED_REPORTS` see every drawer and
   the full balances. "All branches" stays behind that permission.
3. **The Cash payment method is offered only at the branch whose drawer it
   posts to.** Bank, card and wallet methods may be offered at every
   branch, and an existing branch limit on one of those methods is kept.
4. **A voucher that hits a cash drawer has a branch.** Where history has
   none, the branch is taken from the source document, then from the
   customer or supplier on the voucher. A tenant that still has a drawer
   line with no branch is printed and not migrated.
5. **Each branch's cash is folded onto the drawer it already uses most.**
   Press Club's drawer is Main Cash (LT). Every Press Club line on any
   other cash drawer moves there, including the 801 still on Main Cash
   (CF). Babu Bazar's drawer is Main Cash (CF). Every Babu Bazar line on
   a different cash drawer moves there, which is the 3 lines on Cash in
   Hand. Bank lines and wallet lines stay on their own accounts.
6. **An employee belongs to exactly one branch.** The other branch does not
   see that person, their salary, their leave, or their attendance. Phone and
   employee code stay unique for the whole tenant. Two people may share a
   name. A login's branch access (`UserStoreAccess`) is unchanged: a person
   employed at Press Club may still be allowed to sign in at Babu Bazar.
7. **Departments and designations stay one list for the tenant.** No
   `store_id`. Renaming one still renames it everywhere. Deleting one is
   refused while any employee in the business is assigned to it, and the
   error does not name those employees or say how many.
8. **Payroll is one run per branch per month.** A branch user runs and reads
   only their branches. An old run that mixed branches stays unmarked and is
   visible only to someone who can see every branch.

## Goals

- A branch user cannot read another branch's cash drawer, its ledger, or
  its balance, including by calling the API with the other branch's id.
- On Sales, Purchases, Rent, the banks and the wallets, the same user sees
  only their branch's vouchers, and can still post to those shared
  accounts. The company total is unchanged for someone who can see every
  branch.
- A cash tender, expense, or salary payment at branch A posts to branch
  A's drawer. Branch B's Cash method cannot be selected. A bank or wallet
  method offered at A posts to the shared account.
- HR lists, attendance, leave, salary and payroll follow the employee's
  branch. Departments and designations stay shared.
- Existing cash is folded by a dry-run sync. KH Trading is the checked
  case: Press Club cash ends on Main Cash (LT) only, and Babu Bazar cash
  ends on Main Cash (CF) only.

## Non-goals

- A second full chart per branch, or a new due-to / due-from design.
  Inter-branch transfers stay two vouchers on the shared clearing
  accounts. The cash leg uses each branch's drawer. A bank or cheque
  leg uses one shared bank. See §3.
- Splitting departments, designations, account groups, or posting-rule rows
  per branch.
- Two employee records for one person, or a phone number reused at two
  branches.
- Rewriting a historical payroll run that contained both branches into two
  runs.
- Copying bank or wallet accounts when a branch is opened. Those stay one
  account for the business. A new branch does get its own empty cash
  drawer and a Cash method pointed at it.
- Changing who may edit departments and designations. The same people as
  today can rename Sales for the whole business.
- A new permission. Branch access and `VIEW_CONSOLIDATED_REPORTS` are the
  gates that already exist.

---

## What changes for users

- The chart, on one branch, lists the shared accounts (including every
  bank and wallet) and that branch's cash drawer. The other branch's
  drawer is absent, not shown at zero. Premier Bank is one row at both
  branches.
- Shared-account balances, the ledger, the cash book, the bank book, aging
  and the export follow the branch filter. P&L, balance sheet and trial
  balance already do. The cash book shows that branch's drawer. The bank
  book shows the shared banks, limited to that branch's vouchers. The
  balance sheet omits the other branch's drawer.
- Settings → Payment Methods: Cash is one branch, the drawer's branch.
  The All branches box is not available for Cash. Bank, card and wallet
  methods may stay on All branches.
- A new cash drawer asks for a branch, and a branch can have only one.
  A manual voucher that uses a drawer must be that drawer's branch. A
  bank line is allowed on any branch's voucher.
- Employees ask for a branch, defaulting to the header branch. The list
  follows the branch filter. Department and designation screens stay one
  list, with no headcount from the other branch.
- Payroll asks for a branch. A member of one branch has that choice fixed.
- Someone who can see every branch keeps today's company view, and sees
  every drawer as its own row.

Single-branch tenants see no new filter. Their one branch is written onto
the cash drawer and the employees.

---

## 1. Data model

### Accounts

`Account.store_id String?`, relation to `Store`, `onDelete: Restrict`,
indexed `(tenant_id, store_id)`.

A check constraint keeps the rule in the database:

```text
store_id IS NULL OR category = 'cash'
```

`store_id` set means "this is that branch's cash drawer". Category `bank`
always has `store_id` null. A category `cash` account with `store_id` null
is a wallet (bKash, Nagad), shared like a bank. `@@unique([tenant_id, name])`
cannot stay, because two drawers may share a name. Two partial unique
indexes replace it. Prisma cannot express them, so they live in the
migration SQL:

- `(tenant_id, name)` where `store_id` is null, so banks, wallets and the
  rest of the chart still cannot share a name
- `(tenant_id, store_id)` where `store_id` is not null, so a branch has
  one drawer

Codes stay unique per tenant by the existing allocator (`nextAccountCode`).
`110101` stays on Main Cash (CF). A drawer created for a new branch takes
the next free code.

### Payment methods

No new column. The service refuses `all_branches: true`, or any branch
other than the account's, when `account_id` points at a drawer. A method
whose account is a bank, a wallet, or empty may be offered at every
branch.

### Employees

`Employee.store_id String`, required, `onDelete: Restrict`, indexed
`(tenant_id, store_id)`.

`@@unique([tenant_id, phone])` and `@@unique([tenant_id, employee_code])`
stay. `Department` and `Designation` are unchanged.

### Payroll runs

`PayrollRun.store_id String?`, `onDelete: Restrict`.

The unique key becomes `(tenant_id, year, month, kind, store_id)`. Legacy
rows that mixed branches keep `store_id` null. Postgres allows many nulls
in a unique column, so those rows do not collide with each other or with a
later per-branch run. A run created after this change always has a branch.

---

## 2. Who can see what

Reads go through `BranchScopeService`, the same way vouchers and the
statements already do.

| Caller | Cash drawer | Shared accounts, including banks and wallets | Employees |
|---|---|---|---|
| Branch filter on branch A | A's drawer only | vouchers with `store_id = A` | employees with `store_id = A` |
| All branches (owner or `VIEW_CONSOLIDATED_REPORTS`) | every drawer | every voucher, including `store_id` null | every employee |
| A member naming a branch they cannot use | `403` | `403` | `403` |

The other branch's drawer is `404` (it is not in their chart). A bank or
wallet ledger with no `storeId` resolves like the other branch reads: the
header branch for a limited member, every branch for someone who may see
all. The account is listed either way, so they can post to it.

Company vouchers (`store_id` null) stay in the company view only. After the
migration, a drawer line is never on one of those.

These reads gain the filter. Statements, the dashboard, KPIs, trends and
the voucher list already have it.

- `GET /accounting/accounts` (the balance on each row)
- `GET /accounting/reports/ledger/:accountId`
- `GET /accounting/reports/cashbook` and `bankbook`
- `GET /accounting/reports/ar-aging` and `ap-aging`
- `GET /accounting/reports/comparative-pl`, `vat-tax`, `financial-ratios`,
  `cash-flow`, `budget-vs-actual`, `cost-center-pl`
- the Tally and QuickBooks export
- the account picker (vouchers, payment methods, expenses)
- `GET /employees`, `GET /employees/:id`, attendance, leave, salary
  payments, payroll runs and payslips
- the sales-rep picker on customers and sales

`GET /employees/departments` and `GET /employees/designations` stay the
full tenant list. They do not include employees.

---

## 3. Posting

Posting rules stay one set per tenant. A rule may still point at one cash
drawer. That pointer is not used for another branch. At post time:

1. A tender that already resolved a payment method uses that method's
   account. If the account is a drawer, its branch must be the voucher's
   branch, or the post is refused. If the account is a bank or a wallet,
   any branch the method is offered at may use it.
2. Otherwise a cash mode (a sale, an expense, a salary payment) uses the
   Cash method offered at the voucher's branch, which points at that
   branch's drawer. Press Club cash posts to Main Cash (LT). Babu Bazar
   cash posts to Main Cash (CF).
3. Otherwise a bank or wallet mode uses the method of that mode offered at
   the voucher's branch and that method's shared account. The voucher
   still carries the branch, so the balance stays filtered.

A cash post with no branch is refused. Nothing is written to another
branch's drawer.

Salary accrual has no cash leg. Its voucher takes the employee's branch.
Salary payment takes the employee's branch and resolves cash through the
Cash method, as above. An expense takes the expense's branch.

Manual vouchers: a drawer line's account branch equals `voucher.store_id`.
Bank, wallet and other shared lines are allowed on any branch. Saving a
drawer line without a branch is a `400`.

### Fund transfers

A transfer stays two vouchers. Initiate is stamped with the source
branch (`attribution` `INTER_BRANCH`, counterparty the destination):
Dr Due from Branches, Cr the money account. Receive is stamped with the
destination: Dr the money account, Cr Due to Branches. Due from Branches
and Due to Branches stay shared. They are not cleared against each other.

- Method `CASH`: initiate credits the source branch's drawer. Receive
  debits the destination branch's drawer. While the transfer is in
  transit the source drawer is already down and the destination drawer
  is not yet up. Company cash is unchanged once both vouchers exist.
- Method `BANK_TRANSFER` or `CHECK`: both vouchers use one shared bank.
  Initiate credits the Bank method offered at the source branch. Receive
  debits that same account, taken from the source voucher, so a later
  change of payment methods cannot send the money to a different bank.
  The company bank total is unchanged. Each branch's filtered bank
  balance moves. The leg never uses a drawer.
- A cash transfer with no branch is refused. A bank or cheque transfer
  whose Bank method is missing, or whose account is a drawer, is refused.
- A branch user sees a transfer when they can see the source or the
  destination. They see the other branch's name. They do not see the
  other branch's drawer. Reading a transfer they are not a side of is
  `404`.

---

## 4. Employees, payroll, attendance

Creating an employee requires a branch. The form defaults to the header
branch. Update and delete of an employee the caller cannot see are `404`.
Moving an employee to another branch is allowed for someone who can see
both branches. Old sales keep `sales_rep_id`. The name still shows on those
documents. The picker for a new document offers only employees of that
document's branch.

Attendance punches keep the branch where the person clocked in. That can
differ from the home branch. The home branch's user sees the punch. The
other branch's user does not see the employee, so they do not see the punch.

Leave, overtime, salary payments and salary accrual follow the home branch.
Accrual is already one voucher per employee. That voucher's `store_id`
becomes the employee's branch. A branch user running accrual processes only
their branch's employees. Someone who can see every branch still runs
everyone, and each voucher is stamped with that employee's branch.

A payroll run is created for one branch and computes lines only for that
branch's active employees. Approve, pay, reopen, cancel and the payslip
check the run's branch. A legacy run with no branch is readable and payable
only with the consolidated permission, so a branch user does not pay the
other branch's people who were included in it.

Department and designation delete stays refused while any non-deleted
employee points at the row. The message is "This department is still in
use." The designation message is the same shape. No name and no count.

---

## 5. Migration

The new columns are added nullable. The script fills them. A follow-up in
the same release sets `Employee.store_id` to `NOT NULL` and adds the
account check constraint. Doing either before the script would reject the
rows that are already in production.

One script, `packages/database/prisma/sync-branch-books.ts`. Dry-run unless
`--yes`. Optional `--tenant=<id>`. Idempotent: a drawer that already has
the right `store_id`, and a line already on that drawer, is left alone.
The 1,341 Press Club lines already on Main Cash (LT) are not moved again.
Bank and wallet rows are not given a branch and are not cloned.

A **cash drawer** is a category `cash` account that is not the linked
account of a Mobile Wallet method, and is not named `bKash Account` or
`Nagad Account`. Everything else in the cash and bank group stays shared.

Per tenant, in one transaction:

1. **Give every drawer voucher a branch.** For each voucher that has a
   drawer line and `store_id` null, take the branch from the source
   document (sale, purchase, return, expense, loan, payroll, customer or
   supplier payment, each side of a fund transfer). If it names none, take
   the customer or supplier on a voucher line. If the tenant has one
   branch, use that. Anything still blank aborts that tenant. The script
   prints voucher number, date, account and amount, and writes nothing
   for that tenant. Bank and wallet vouchers are not part of this abort.
2. **Pick each branch's drawer.** Among drawer accounts, the one with the
   most lines whose voucher is that branch. A tie goes to the account
   whose own lines are mostly that branch, then to the oldest account.
   An account is assigned to only one branch: the branch with the most
   lines on it. The other branch then takes its next-best account, or
   receives a new drawer in step 3. Set `store_id` on the chosen
   account. For KH Trading this is Main Cash (LT) for Press Club and
   Main Cash (CF) for Babu Bazar.
3. **Fold the other cash lines onto that drawer.** Every drawer line for
   the branch that sits on a different drawer account moves. Press Club
   lines on Main Cash (CF) move to Main Cash (LT) (801 on 2026-10-28; the
   dry-run prints the live count). Babu Bazar lines on Cash in Hand move
   to Main Cash (CF) (3 on 2026-10-28). A branch that has lines and no
   drawer of its own gets a new account, same name as the account those
   lines are leaving, next code, and the lines move there. KH Trading
   does not need that clone.
4. **Retire an emptied drawer.** Payment methods and posting rules that
   still point at it are pointed at the branch drawer those lines moved
   to. The empty account is then deleted. Cash in Hand is the KH Trading
   case. If a remaining reference blocks the delete, the script stops
   and prints it rather than leaving a second drawer on the chart.
5. **Split the Cash method.** The existing Cash row keeps the branch of
   the drawer it now points at, `all_branches` false, and one store row.
   Each other branch gets a Cash method of the same name pointed at that
   branch's drawer. Bank, card and wallet methods are left as they are,
   including Bank (DBBL) limited to Babu Bazar.
6. **Employees.** One branch on the tenant: that branch. Otherwise the
   linked user's only `UserStoreAccess` store. Otherwise the store on the
   majority of that employee's attendance punches that have a store. A tie,
   or no signal, uses the main branch, and the script prints the employee
   code and name as assigned to the main branch.
7. **Payroll runs.** If every employee on the run belongs to one branch
   after step 6, stamp the run with it. If they don't, leave `store_id`
   null.

KH Trading after the sync, checked by the dry-run before `--yes`:

- Main Cash (LT) is Press Club and holds its 1,341 lines plus the Press
  Club lines moved off Main Cash (CF).
- Main Cash (CF) is Babu Bazar and holds its own lines plus the Cash in
  Hand lines. It has no Press Club lines.
- Cash in Hand is gone.
- Premier Bank 186, bKash, Nagad, DBBL and the other banks are unchanged
  shared accounts. Their voucher lines are not moved.
- The Cash method exists twice: Babu Bazar → Main Cash (CF), Press Club →
  Main Cash (LT). Bank, bKash, Nagad and Card stay offered at both
  branches. Bank (DBBL) stays Babu Bazar only.
- Both employees have a branch. The script prints anyone who fell through
  to the main branch.

A new tenant's bootstrap attaches the template Cash in Hand to the first
store and points the seeded Cash method at it, for that store only. Main
Bank Account, bKash Account and Nagad Account stay shared, and their
methods stay available at every branch. Opening another store creates one
cash drawer for it and one Cash method. It does not copy banks or wallets.

---

## 6. API

No new resources. Existing routes gain the behaviour above.

- Account create and update take `storeId`. It is required for a new
  cash drawer, rejected for a bank, a wallet, or any other shared
  account, and rejected when that branch already has a drawer. The
  drawer name may repeat across branches. A shared name may not.
- Ledger, cash book, bank book, aging, the other reports listed in §2,
  and the export take `storeId` and resolve it with `BranchScopeService`
  and `VIEW_LEDGER`, the same permission the voucher list uses.
- Employee create and update take `storeId`, required. List takes
  `storeId`, resolved with the route's existing HR permission.
- Payroll create takes `storeId`, required. A second run for the same
  branch, month and kind is the existing conflict. A legacy null run does
  not block it.
- Payment-method create and update return `400` when a drawer account is
  combined with all branches or with any branch other than the account's.
  A bank or wallet account does not trip that check.

Branch ids the caller cannot use stay `403` from `BranchScopeService`.
An account or employee outside the caller's branches is `404`.

---

## 7. Files

- `packages/database/prisma/schema.prisma` — `Account.store_id`,
  `Employee.store_id`, `PayrollRun.store_id`, the check constraint, the
  partial unique indexes, the payroll unique key.
- `packages/database/prisma/sync-branch-books.ts` — the migration in §5.
- `packages/database/prisma/bootstrap-accounting.ts` and
  `payment-method.seed.ts` — first-branch tills and methods.
- `apps/backend/src/accounting/` — account CRUD, ledger, books, aging,
  export, balance sheet till rows, posting resolution in
  `posting.utils.ts` and the expense and salary callers.
- `apps/backend/src/fund-transfers/` — cash credits the source drawer
  and debits the destination drawer; bank and cheque use one shared
  bank. `get` is limited to a side the caller can see.
- `apps/backend/src/payment-methods/` — the till / branch invariant.
- `apps/backend/src/employees/` — branch on create, list, read, update,
  delete. Department and designation messages.
- `apps/backend/src/payroll/` and `salary-payments/` — run branch, accrual
  branch.
- Attendance and leave services — filter by the employee's branch.
- `apps/frontend` chart, ledger, cash book, bank book, voucher form,
  payment-method settings, employee form and list, payroll.
- Strings in all nine locales for the new labels (branch on a till,
  branch on an employee, the payroll branch, the delete message).

---

## 8. Testing

- Account constraint: a bank account with a branch is rejected, a second
  drawer for the same branch is rejected, a wallet (bKash) with no
  branch is accepted, and two branches may each have one drawer.
- Ledger and chart balances for a limited member exclude the other
  branch's vouchers and do not return the other branch's drawer. The
  shared bank is returned, with only that member's branch in the
  balance. Naming the other branch is `403`. The company view still
  returns both drawers and the full bank balance.
- Balance sheet at branch scope omits the other branch's drawer and
  still includes the shared bank at that branch's figure.
- Posting Press Club cash uses Main Cash (LT). A Babu Bazar Cash method
  on that voucher is refused. Posting Press Club bank uses Premier Bank
  186, the same account Babu Bazar uses.
- A cash fund transfer from Babu Bazar to Press Club credits Main Cash
  (CF) and later debits Main Cash (LT). A bank transfer credits and
  debits Premier Bank 186 on both vouchers and does not touch a drawer.
- The sync dry-run fixture covers: a null-branch cash voucher repaired
  from a customer payment, a tenant aborted when one drawer voucher has
  no source and no party, Press Club lines moved off CF onto LT, Babu
  Bazar lines moved off a second cash account onto CF, a bank line left
  where it is, the emptied cash account deleted, the Cash method split,
  an employee assigned from their only store and one printed as a
  main-branch fallback.
- Employee list for a one-branch member does not include the other
  branch. Department list still returns a department that has employees
  only at the other branch. Delete of that department is refused with
  the nameless message.
- A branch payroll run ignores the other branch's employees. A legacy
  run with no branch is `403` for a member without consolidated access.
- Frontend: the drawer form requires a branch, the employee form requires
  a branch, the payment-method form hides All branches when the linked
  account is a drawer, and leaves it available for a bank or a wallet.

---

## 9. Key decisions

- Private cash drawers, shared banks. A bank is one account any branch
  can post to. Its balance on a branch screen is still only that
  branch's vouchers. bKash and Nagad are treated as banks for this
  purpose: no physical drawer, so they are not split and their lines
  are not folded into Main Cash.
- One drawer per branch, chosen as the cash account that branch already
  uses most. Press Club's is Main Cash (LT). Babu Bazar's is Main Cash
  (CF). Other cash lines of that branch move onto it. This is not a
  hard-coded tenant id.
- The 801 Press Club vouchers on Main Cash (CF) move to Main Cash (LT).
  The 3 Babu Bazar vouchers on Cash in Hand move to Main Cash (CF), and
  Cash in Hand is removed. The 1,341 already on Main Cash (LT) stay.
- Departments stay shared. The leak to close is the employee list behind
  them, not the department row.
- An employee who cannot be placed from a login or from attendance goes
  to the main branch and is printed, rather than blocking the tenant.
  A drawer voucher that cannot be placed does block that tenant, because
  a wrong drawer is money in the wrong till and a wrong home branch can
  be edited afterwards.
