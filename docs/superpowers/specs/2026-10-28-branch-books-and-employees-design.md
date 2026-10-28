# Branch tills, filtered books, and branch employees

**Date:** 2026-10-28
**Status:** Draft pending review
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

1. **Cash and bank accounts belong to one branch.** Category `cash` or `bank`
   requires `store_id`. The same name may exist at two branches. Codes stay
   unique per tenant. Every other account stays shared (`store_id` null).
2. **A branch user sees one branch at a time**, the branch filter that
   already exists. They see that branch's tills, and on a shared account only
   the balance of that branch's vouchers. Owners and holders of
   `VIEW_CONSOLIDATED_REPORTS` see every till and the full balances. "All
   branches" stays behind that permission.
3. **A payment method whose account is a till is offered only at that till's
   branch.** `all_branches` is false and the method has that one store.
4. **A cash or bank voucher has a branch.** Where history has none, the
   branch is taken from the source document, then from the customer or
   supplier on the voucher. A tenant that still has a till line with no
   branch is printed and not migrated.
5. **KH Trading's two cash drawers stay what they already are.** Main Cash
   (CF) is Babu Bazar. Main Cash (LT) is Press Club. The 801 Press Club
   vouchers still on Main Cash (CF) move to Main Cash (LT). They do not
   become a third account named Main Cash (CF) at Press Club.
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

- A branch user cannot read another branch's till, that till's ledger, or
  that till's balance, including by calling the API with the other branch's
  id.
- On Sales, Purchases, Rent and the other shared accounts, the same user
  sees only their branch's vouchers. The company total is unchanged for
  someone who can see every branch.
- A tender, an expense, or a salary payment at branch A posts to branch A's
  till. Branch B's method cannot be selected.
- HR lists, attendance, leave, salary and payroll follow the employee's
  branch. Departments and designations stay shared.
- Existing books are split by a dry-run sync. KH Trading is the checked
  case: after it, Press Club cash is Main Cash (LT) only, and Babu Bazar
  cash is Main Cash (CF) plus the three-line Cash in Hand.

## Non-goals

- A second full chart per branch, or due-to / due-from books. Inter-branch
  fund transfers stay as they are.
- Splitting departments, designations, account groups, or posting-rule rows
  per branch.
- Two employee records for one person, or a phone number reused at two
  branches.
- Rewriting a historical payroll run that contained both branches into two
  runs.
- Copying tills automatically when a branch is opened later. The owner adds
  that branch's accounts and methods. A new tenant's first branch still
  receives the template tills.
- Changing who may edit departments and designations. The same people as
  today can rename Sales for the whole business.
- A new permission. Branch access and `VIEW_CONSOLIDATED_REPORTS` are the
  gates that already exist.

---

## What changes for users

- The chart, on one branch, lists shared accounts and that branch's tills.
  "Main Cash" at Babu Bazar and "Main Cash" at Press Club are different
  rows. The other branch's row is absent, not shown at zero.
- Shared-account balances, the ledger, the cash book, the bank book, aging
  and the export follow the branch filter. P&L, balance sheet and trial
  balance already do. The balance sheet drops tills that are not the branch
  being viewed, so a till with no activity in the period is omitted rather
  than printed at zero from the other branch.
- Settings → Payment Methods: a method linked to a till has one branch, the
  till's branch. The All branches box is not available for that method.
- A new till account asks for a branch. A manual voucher that uses a till
  must be that till's branch.
- Employees ask for a branch, defaulting to the header branch. The list
  follows the branch filter. Department and designation screens stay one
  list, with no headcount from the other branch.
- Payroll asks for a branch. A member of one branch has that choice fixed.
- Someone who can see every branch keeps today's company view, and sees
  every till as its own row.

Single-branch tenants see no new filter. Their one branch is written onto
the tills and the employees.

---

## 1. Data model

### Accounts

`Account.store_id String?`, relation to `Store`, `onDelete: Restrict`,
indexed `(tenant_id, store_id)`.

A check constraint keeps the rule in the database:

```text
(category IN ('cash', 'bank')) = (store_id IS NOT NULL)
```

`@@unique([tenant_id, name])` is dropped. Two partial unique indexes replace
it, which Prisma cannot express, so they live in the migration SQL:

- `(tenant_id, name)` where `store_id` is null
- `(tenant_id, store_id, name)` where `store_id` is not null

Codes stay unique per tenant by the existing allocator (`nextAccountCode`).
A cloned till takes the next free code. `110101` stays on the original row.

### Payment methods

No new column. The service refuses `all_branches: true`, or more than one
store, when `account_id` points at a till. A method with no account, or an
account that is not a till, may still be offered at every branch.

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

| Caller | Tills | Shared-account balance | Employees |
|---|---|---|---|
| Branch filter on branch A | A's tills only | vouchers with `store_id = A` | employees with `store_id = A` |
| All branches (owner or `VIEW_CONSOLIDATED_REPORTS`) | every till | every voucher, including `store_id` null | every employee |
| A member naming a branch they cannot use | `403` | `403` | `403` |

A till ledger for a branch the caller cannot use is `404` (the account is
not in their chart). A shared-account ledger with no `storeId` resolves
like the other branch reads: the header branch for a limited member, every
branch for someone who may see all.

Company vouchers (`store_id` null) stay in the company view only. After the
migration, a till line is never on one of those.

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

Posting rules stay one set per tenant. A rule may still point at a till
account. That pointer is not used for another branch. At post time the
cash or bank leg is chosen in this order:

1. A tender that already resolved a payment method uses that method's
   account. The account's branch must be the voucher's branch, or the post
   is refused.
2. Otherwise the payment mode (a sale, an expense, a salary payment) uses
   the active method of that mode offered at the voucher's branch, and that
   method's account. Press Club cash then posts to Main Cash (LT), because
   that is where the Press Club Cash method points after the migration.
   Babu Bazar cash posts to Main Cash (CF).
3. Otherwise, when the rule account is a till, it is replaced by the
   account of the same name and category at the voucher's branch.

If none of those yields an account at the voucher's branch, the post is
refused with the mode or account name and the branch name. Nothing is
written to another branch's till. A till post with no branch is refused.

Salary accrual has no cash leg. Its voucher takes the employee's branch.
Salary payment takes the employee's branch and resolves the till through
the mode, as above. An expense takes the expense's branch.

Manual vouchers: every till line's account branch equals `voucher.store_id`.
Shared accounts are allowed on any branch. Saving a till line without a
branch is a `400`.

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
`--yes`. Optional `--tenant=<id>`. Idempotent: a till that already has the
right `store_id`, and a line already on that till, is left alone. The
1,341 Press Club lines already on Main Cash (LT) are not moved again.

Per tenant, in one transaction:

1. **Give every till voucher a branch.** For each voucher that has a till
   line and `store_id` null, take the branch from the source document
   (sale, purchase, return, expense, loan, payroll, customer or supplier
   payment, each side of a fund transfer). If it names none, take the
   customer or supplier on a voucher line. If the tenant has one branch,
   use that. Anything still blank aborts that tenant. The script prints
   voucher number, date, account and amount, and writes nothing for that
   tenant.
2. **Give every till account a branch.** The branch is the one with the
   most lines on that account. A tie goes to the oldest physical store
   (the main branch used by party backfill: `created_at`, then `id`, never
   the online branch). An account with no lines goes to the main branch.
3. **Move lines that disagree.** A line whose voucher branch is not the
   account's branch moves as follows.
   - Same name and category already exist at the voucher's branch: move
     the line there.
   - The source account is the primary cash account of its own branch
     (the category-`cash` account assigned to that branch with the most
     lines), and the voucher's branch has its own primary cash account:
     move the line to that primary account. This is what sends KH
     Trading's 801 Press Club vouchers from Main Cash (CF) to Main Cash
     (LT). It does not move bKash, Nagad, or a bank.
   - Otherwise clone the account for the voucher's branch (same name,
     category, group and subgroup, next code) and move the line.
4. **Split methods that point at a till and are still offered at more than
   that till's branch.** The existing row keeps the account's branch,
   `all_branches` false, and one store row. Each other branch where the
   method was offered gets a new method, same name and type, linked to
   that branch's account of the same name, or to that branch's primary
   cash account when step 3 used the primary-cash rule. Bank (DBBL) is
   already Babu Bazar only and stays one method.
5. **A method offered at a branch that has no copy of its till** (Nagad at
   Press Club, for example) gets a cloned till with no historical lines,
   then a method pointing at it. Empty bank accounts that no method offers
   at the other branch stay on the main branch and are not copied.
6. **Employees.** One branch on the tenant: that branch. Otherwise the
   linked user's only `UserStoreAccess` store. Otherwise the store on the
   majority of that employee's attendance punches that have a store. A tie,
   or no signal, uses the main branch, and the script prints the employee
   code and name as assigned to the main branch.
7. **Payroll runs.** If every employee on the run belongs to one branch
   after step 6, stamp the run with it. If they don't, leave `store_id`
   null.

KH Trading after the sync, checked by the dry-run before `--yes`:

- Main Cash (CF) is Babu Bazar and has only Babu Bazar lines.
- Main Cash (LT) is Press Club and holds the 1,341 lines already there
  plus the Press Club lines moved off CF (801 on 2026-10-28). The dry-run
  prints the live count, and that count is reviewed before `--yes`.
- Premier Bank 186 stays Babu Bazar. Press Club gets a new Premier Bank
  186 for its 5 vouchers. Bank and Card at Press Club point at that copy.
  Babu Bazar's Bank and Card keep the original.
- bKash Account is Press Club. Babu Bazar gets a new bKash Account because
  the bKash method is offered there, with no historical lines.
- Cash in Hand is Babu Bazar.
- Nagad is cloned for Press Club the same way. The original, which has no
  lines, stays on the main branch (Babu Bazar).
- DBBL and the other unused bank accounts stay on Babu Bazar. DBBL's
  method is already that branch only.
- Both employees have a branch. The script prints anyone who fell through
  to the main branch.

A new tenant's bootstrap attaches the template tills (Cash in Hand, Main
Bank Account, bKash Account, Nagad Account) to the first store, and the
seeded methods point at those accounts with `all_branches` false. A store
created afterwards does not receive copies.

---

## 6. API

No new resources. Existing routes gain the behaviour above.

- Account create and update take `storeId`. It is required when the
  category is cash or bank, and rejected otherwise. The name may repeat
  across branches and may not repeat inside one branch, or among shared
  accounts.
- Ledger, cash book, bank book, aging, the other reports listed in §2,
  and the export take `storeId` and resolve it with `BranchScopeService`
  and `VIEW_LEDGER`, the same permission the voucher list uses.
- Employee create and update take `storeId`, required. List takes
  `storeId`, resolved with the route's existing HR permission.
- Payroll create takes `storeId`, required. A second run for the same
  branch, month and kind is the existing conflict. A legacy null run does
  not block it.
- Payment-method create and update return `400` when a till account is
  combined with all branches or with any branch other than the account's.

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

- Account constraint: a cash account without a branch is rejected, a
  shared account with a branch is rejected, two branches may both have
  "Cash in Hand", one branch may not.
- Ledger and chart balances for a limited member exclude the other
  branch's vouchers and do not return the other branch's till. Naming
  the other branch is `403`. The company view still returns both.
- Balance sheet at branch scope omits the other branch's till.
- Posting a Press Club tender uses the Press Club till. A Babu Bazar
  method id on that voucher is refused.
- The sync dry-run fixture covers: a null-branch voucher repaired from
  a customer payment, a tenant aborted when one till voucher has no
  source and no party, a primary-cash move (the CF → LT case), a bank
  cloned for the smaller branch, an empty till not copied, a method
  split, an employee assigned from their only store and one printed as
  a main-branch fallback.
- Employee list for a one-branch member does not include the other
  branch. Department list still returns a department that has employees
  only at the other branch. Delete of that department is refused with
  the nameless message.
- A branch payroll run ignores the other branch's employees. A legacy
  run with no branch is `403` for a member without consolidated access.
- Frontend: the till form requires a branch, the employee form requires
  a branch, and the payment-method form hides All branches when the
  linked account is a till.

---

## 9. Key decisions

- Shared books, private tills. Balances of Sales and the rest are
  filtered. The till itself is a different account, so it cannot leak
  as a zero row.
- KH Trading's named cash drawers are the primary-cash rule, not a
  hard-coded tenant id. Any tenant that already kept one cash account
  per branch by name is treated the same way.
- The 801 Press Club vouchers on Main Cash (CF) move. The 1,341 already
  moved on 2026-10-28 stay where they are.
- Departments stay shared. The leak to close is the employee list behind
  them, not the department row.
- An employee who cannot be placed from a login or from attendance goes
  to the main branch and is printed, rather than blocking the tenant.
  A till voucher that cannot be placed does block that tenant, because
  a wrong till is money in the wrong drawer and a wrong home branch can
  be edited afterwards.
