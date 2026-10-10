# Customers, suppliers and their payments belong to a branch — design

Status: **approved in conversation 2026-10-10**; this document awaits review.

Asked as: "customer supplier payment list need to be filtered using the branch
selected at the top", then "all customer and suppliers need to be attached to a
specific branch and also their payments."

## Decisions (confirmed 2026-10-10)

1. **Strict attachment.** A customer or supplier belongs to exactly one branch.
   Only members with access to that branch see or use it: lists, pickers,
   detail pages, ledgers, aging, payments. Owners and holders of
   `VIEW_CONSOLIDATED_REPORTS` see every party. Moving a party is an owner
   action.
2. **Backfill by trade.** A customer keeps the branch it was added at.
   Otherwise it goes to the branch where it has the most non-cancelled sales,
   else to the main branch. A supplier goes to the branch where it has the
   most purchases, else to the main branch.
3. **A payment belongs to its party's branch**, taken when the payment is
   recorded. If the party moves later, its old payments stay where they were.
4. **Required in the database.** `store_id` is `NOT NULL` on `Customer`,
   `Supplier`, `CustomerCreditTransaction` and `SupplierCreditTransaction`.
   With the column required, the compiler finds every writer that does not
   set it.
5. **The online storefront has its own branch**, "Online Store", and every
   customer the storefront creates belongs to it.
6. **External import:** everything an import brings in belongs to the branch
   chosen for that import.
7. **CSV import** (customers and suppliers): each row may name its branch;
   rows that don't take the one branch chosen for the whole file.

The **main branch** is the tenant's oldest physical `Store` (never the online
branch), by `created_at` then `id`. `Store` has no "default" or "main" flag,
and stores cannot be deleted.

## What changes for users

- On a multi-branch tenant, branch staff see only their own branches'
  customers and suppliers. Customers stop being visible "because they bought
  here".
- The customer list, supplier list, Customer Payments and Supplier Payments
  carry the header-linked branch filter. The filter is locked for a
  one-branch member. "All branches" is offered only to owners and
  consolidated-report holders.
- Creating a customer or supplier asks for a branch, defaulting to the header
  branch.
- Payment vouchers post to the payment's branch. Today customer payment
  vouchers post to whichever header branch the recorder had, and supplier
  payment vouchers post company-wide. Afterwards a branch's receivable and
  payable clear against its own sales and purchases.
- Single-branch tenants without a storefront, which is most of them, see no
  difference. The filter hides itself and everything lands on their one
  branch.
- A tenant whose storefront has customers gains an "Online Store" branch. A
  one-shop tenant therefore becomes two-branch: the header switcher and the
  branch filters appear. Staff see web customers only once an owner gives
  them access to the online branch. Owners get that access automatically.
- Importing a CSV of customers or suppliers asks which branch the file goes
  to, unless every row names its own.

## 1. Data model

| Model | Column | Notes |
|---|---|---|
| `Customer` | `store_id String` (was `String?`) | relation `onDelete: Restrict` (stores are never deleted today) |
| `Supplier` | `store_id String` (new) | relation + `@@index([tenant_id, store_id])` |
| `CustomerCreditTransaction` | `store_id String` (new) | every row: payment, payout, credit sale, adjustment, write-off |
| `SupplierCreditTransaction` | `store_id String` (new) | every row: payment, payout, credit purchase, adjustment |

| `Tenant` | `online_store_id String? @unique` (new) | the tenant's online branch; null until the storefront first needs it |

A credit row's branch is its party's branch at the moment the row is written.
That covers the ledger as well as payments, so a party's history never splits
across branches unless the party is moved.

### The online branch

- **Created on first need**, by `ensureOnlineBranch(tenantId)`: when the
  storefront creates its first customer, and in the sync below for tenants
  that already have storefront customers.
- **Created like any other branch.** It reuses the stores service's row
  creation: name "Online Store" (or the next free name), the next store code,
  and access rows for every owner. `Tenant.online_store_id` points at it, and
  its unique constraint keeps one per tenant.
- **Not counted against `maxStores`** in `plan-entitlements.service.ts`. It is
  not a physical location, and a one-store plan must still be able to run a
  storefront.
- **Labelled as online.** The branch list in `/auth/me` and the store settings
  page mark it, so it can be told apart from a shop.
- **Storefront orders stay branchless** (`StorefrontOrder` has no store). Only
  the customer is placed on the online branch.

### Rollout: pre-`db push` sync

Production never runs `prisma migrate deploy`. It runs `db push
--accept-data-loss` from `apps/backend/scripts/db-prepare.sh`, and Postgres
refuses to make a column `NOT NULL` while it still holds nulls. A new step,
`sync:party-branch` (`packages/database/prisma/sync-party-branch.ts`), runs
**before** `db push`, following the `sync:board-slug` pattern:

1. `ALTER TABLE … ADD COLUMN IF NOT EXISTS "store_id" TEXT` on `Supplier`,
   `CustomerCreditTransaction` and `SupplierCreditTransaction`.
2. Customers with a null branch get the branch with the most non-cancelled
   sales. Ties go to the branch of the latest such sale. A customer with no
   such sale and a storefront account (`user_id` set) goes to the online
   branch, which the step creates if needed. Every other customer gets the
   main branch.
3. Suppliers with a null branch get the branch with the most active purchases,
   using the same `ACTIVE_PURCHASE` filter the services use. Ties go to the
   latest purchase; suppliers with none get the main branch.
4. Credit rows with a null branch get their party's branch.
5. The step is idempotent: it fills nulls only and never moves an assigned
   party. It is a no-op on a fresh database.
6. If a tenant has no `Store` at all, its rows stay null and `db push` fails
   loudly. The plan must confirm that tenant provisioning (signup, admin
   creation, demo) always creates a store, and must say what to do otherwise.

`db push` then applies `NOT NULL`, the foreign keys and the index. A migration
(`…_party_branch`) does the same as add-nullable, backfill, set-not-null, so
dev databases and `migrate dev` stay in step.

## 2. Writers

Every writer must set `store_id`. The compiler lists them once the column is
required. The rule for each:

| Writer | Branch |
|---|---|
| Customer create (`POST /customers`) | `store_id` from the form; defaults to the header branch. Must be a branch the caller may use. |
| Customer import (CSV) | the row's `branch` column (name or code) if set, else the branch picked for the file. The import dialog requires that pick, defaulting to the header branch. A row naming an unknown branch, or one the caller may not use, fails on its own. |
| Inline customer (sale, quote, order, POS quick-add) | the document's branch |
| Storefront sign-up / checkout customer | the online branch (`ensureOnlineBranch`) |
| External-sync import customer / supplier | the import's branch: `ExternalSyncConnection.store_id`, already required when a connection is set up and already used for the imported sales and purchases. A party matched to an existing record keeps its branch. |
| Demo data, seed | the tenant's first store |
| Supplier create / update / CSV import / inline quick-add | same rules as customers |
| Customer and supplier credit rows (payments, credit sale/purchase, returns, write-offs, imports) | the party's current branch |

Party edits: changing `store_id` requires owner or `VIEW_CONSOLIDATED_REPORTS`.
For customers this is the `canSetBranch` gate that already exists; suppliers
get the same gate. Moving a party moves its `due_balance` with it, because the
balance lives on the party. Existing credit rows keep their branch.

## 3. Visibility (strict)

- **Customers.** `customerInBranchesWhere` in `customer-visibility.ts` drops
  the "has a sale there" branch of its `OR` and becomes `store_id IN scope`.
  `CustomerScopeService` is unchanged: owners and consolidated-report holders
  get `null` (everything), everyone else gets their access branches, and a
  requested `storeId` narrows to one.
- **Suppliers.** A new `supplier-visibility.ts` and `SupplierScopeService`
  mirror the customer pair (`SUPPLIER_READ` permissions). The scope applies to
  every `/suppliers` route: list, get, update, delete, import, credit ledger,
  GL ledger, billing summary, payments list/get/update/delete/allocate, and
  record payment. `GET /suppliers` takes `storeId` like `GET /customers`.
- **Payments lists.** `GET /customers/credit/payments` and
  `GET /suppliers/credit/payments` take `storeId`. It is resolved through
  `BranchScopeService.resolveStoreId` with the credit-read permissions and
  filters `store_id`. The party scope still applies on top.
- **Pickers.** The sale, quote, order, POS and purchase pickers call
  `/customers` and `/suppliers`, so they show in-scope parties only and need
  no change. Owners selling at branch B to a branch-A customer remain allowed.

## 4. Posting

- Customer payment vouchers: `storeId` becomes the payment's branch, not the
  request's header branch.
- Supplier payment vouchers: `storeId` is now passed, as the payment's branch,
  so they become branch-attributed.
- Write-off vouchers, and every other customer and supplier posting, are
  unchanged.

## 5. Frontend

- **Customer form** (`sales/customers/CustomerFormModal.tsx`): the existing
  Branch select is required on create, defaults to the header branch, and is
  shown whenever the tenant has more than one branch. Members without
  `canSetBranch` see it read-only on edit.
- **Supplier form** (`purchases/suppliers/page.tsx`): the same Branch select,
  with the same rules.
- **Supplier list:** a `BranchFilter` (`useBranchScope({ startOnAll: true })`)
  and a Branch column for those who see all. This mirrors the customer list.
- **Customer and supplier payments**
  (`components/payments/party-payments/PartyPaymentsWorkspace.tsx`):
  `useBranchScope()` plus `BranchFilter` in the `PageHeader` actions.
  `apiStoreId` goes to `listPayments`, and the page starts on the header
  branch. A 403 goes through `useBranchForbiddenReset`. The KPI strip follows
  the filtered rows.
- **CSV import dialogs**, for customers and suppliers: a required Branch select
  ("for rows without a branch"), defaulting to the header branch. The template
  gains a `branch` column. Row errors name the branch that was not found.
- **External import:** the connection form already requires a branch. Its help
  text now says that customers and suppliers land there too.
- **Settings › Stores:** the online branch is marked "Online". It can be
  renamed, and the mark stays.
- **Locales:** new strings in all nine locales.

## 6. Testing

- **Sync script.** Unit tests for the placement rules (most sales or
  purchases, tie, none → main, existing branch kept, credit rows follow party,
  idempotent), against the script's pure placement function.
- **Backend services:**
  - customer visibility without the sales route
  - supplier scope on every route, including the 404 for an out-of-scope
    supplier
  - payment list filtered by `storeId`
  - record payment takes the party's branch
  - payment vouchers post to the payment's branch
  - supplier branch change gated
  - each writer sets a branch (inline, import, storefront, external sync)
  - `ensureOnlineBranch` creates one branch only, under concurrent sign-ups,
    gives owners access, and is excluded from the `maxStores` count
  - CSV import: a row's branch wins over the file's, and an unknown or
    forbidden branch fails that row only
- **Frontend:**
  - supplier form branch field
  - supplier list filter
  - payments pages send `storeId` and render the filter, with `useBranchScope`
    mocked
  - customer form create defaults
- `tsc` for both apps, `next lint --quiet`, and the full jest suites.
- Not possible locally: the sync against real data (the dev DB is drifted).
  Before release, run the placement as a read-only report against production
  (counts per branch) using an SSH script the user runs. The script must not
  write.

## 7. Out of scope (TODO.md)

- Customer reads outside `/customers` that are already listed: CRM campaign
  recipients, AI chat party tools, loyalty screens.
- Supplier reads outside `/suppliers`: purchase dashboard aggregates, AI chat,
  mobile pulse counts, external-sync matching.
- Document write paths (sales, purchases, quotes, orders) re-checking that the
  party is in the caller's scope. The pickers enforce it in the UI only, as
  with the open "write paths trust body store ids" item.
- A bulk "move to branch" action.
- Storefront orders carrying a branch, and moving an online order into a
  shop's sales.
