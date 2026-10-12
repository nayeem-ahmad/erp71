# Branch-attached parties — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> Executed natively in the session that wrote it; the user asked for implementation straight away and reviews at the end.

**Goal:** Every customer, supplier, customer and supplier credit row, and
storefront order belongs to a branch. Visibility is strict per branch. The
lists, payment pages and home tiles follow the branch filter or header.

**Architecture:**
- `store_id` becomes required on five tables, filled by a pre-`db push` sync.
- Writers set it from a small set of rules: the form or header branch, the
  party's branch, the online branch, or the import's branch.
- Reads go through the existing `BranchScopeService` / `CustomerScopeService`
  pattern, plus a new `SupplierScopeService`.

**Tech stack:** NestJS + Prisma (Postgres), Next.js 15, Jest.

**Spec:** `docs/superpowers/specs/2026-10-10-branch-attached-parties-design.md`

## Global constraints

- Production runs `db push --accept-data-loss`, never `migrate deploy`.
  Anything that would make the push fail is filled **before** the push by
  `sync:party-branch`.
- The main branch is the oldest physical store: `created_at`, then `id`, and
  never the online branch.
- The online branch is a `Store` that `Tenant.online_store_id` points at. It
  is excluded from `maxStores`, and owners get access rows for it.
- A credit row's `store_id` is the party's `store_id` at write time. A
  payment voucher posts to the payment's `store_id`.
- Changing a party's branch requires owner or `VIEW_CONSOLIDATED_REPORTS`
  (`canSetBranch`).
- UI rules from CLAUDE.md apply. New strings go into all nine locales.

## Review focus

1. **Two first storefront sign-ups at once** must create one online branch,
   not two. `Tenant.online_store_id @unique` plus re-reading on conflict;
   tested in Task 2.
2. **A CSV row naming a branch by code or name in any case** ("dhk", "Dhaka
   Branch") must resolve. A row naming a branch the importer can't use fails
   alone; tested in Task 3.
3. **A tenant with no store** must not break the deploy. The sync reports it
   and skips; provisioning always creates a store; covered by a Task 1 test.
4. **A limited member editing a supplier must not move it to another
   branch.** Gated in Task 4.
5. **An owner on the Online Store header** sees online counts, and on a shop
   header sees 0. Task 6 test.

---

### Task 1: Schema, migration, backfill sync, read-only production report

**Files:**
- Modify: `packages/database/prisma/schema.prisma`: `Customer.store_id`
  required with `onDelete: Restrict`; `Supplier.store_id`,
  `CustomerCreditTransaction.store_id`, `SupplierCreditTransaction.store_id`
  and `StorefrontOrder.store_id` added, required, with relations and indexes;
  `Tenant.online_store_id String? @unique` with its relation; back-relations
  on `Store`.
- Create: `packages/database/prisma/migrations/20261010150000_party_branch/migration.sql`
  (add nullable, backfill, set not null, FKs).
- Create: `packages/database/prisma/sync-party-branch.ts`, plus the
  `sync:party-branch` script in `packages/database/package.json`.
- Create: `packages/database/prisma/party-branch-placement.ts`, the pure
  placement rules.
- Test: `packages/database/prisma/party-branch-placement.test.ts` (or
  `apps/backend` spec, wherever the database package's tests run).
- Modify: `apps/backend/scripts/db-prepare.sh`: a `sync:party-branch` step
  before `db push`.
- Create: `scripts/ops/party-branch-report.sh`, read-only: per tenant, how
  many parties would land on each branch.

**Interfaces (produces):**
- `placeParty(counts: { storeId: string; n: number; latest: Date }[], fallback: string): string`
- `mainStoreId(stores: { id: string; created_at: Date }[], onlineStoreId: string | null): string | null`

**Steps:**
- [ ] Tests for `placeParty` (most wins; tie goes to latest; none falls back)
  and `mainStoreId` (oldest physical; online skipped; none → null).
- [ ] Implement the placement module.
- [ ] Sync script, in order:
  1. Add the missing columns with `IF NOT EXISTS`.
  2. Per tenant, compute the main branch.
  3. Customers: null rows get the most-sales branch; else the online branch
     if `user_id` is set (create it); else main.
  4. Suppliers: the most-purchases branch, else main.
  5. Credit rows follow their party.
  6. Storefront orders go to the online branch (create it).
  7. Tenants with no store are logged and skipped.

  Every step runs as SQL `UPDATE … WHERE store_id IS NULL`, so the script
  is idempotent.
- [ ] Schema + migration; run `prisma generate`. The compiler now lists every
  writer. Note the count and fix them in Tasks 2–5. Don't commit a red
  build: Task 1 commits the schema together with Task 2–5 writer fixes as
  one "required branch" commit, or keeps the schema change unstaged until
  they're done.
- [ ] `db-prepare.sh` step and package script; the report script.
- [ ] Commit.

### Task 2: Online branch + storefront

**Files:**
- Create: `apps/backend/src/stores/online-branch.service.ts`, holding
  `ensureOnlineBranch(tenantId, tx?)`. It reuses the store-row creation:
  next code, owners' access rows, name "Online Store" or the next free name,
  and sets `Tenant.online_store_id`.
- Modify: `apps/backend/src/stores/stores.service.ts`: extract the shared
  `createStoreRow` part so the online service can reuse it.
- Modify: `apps/backend/src/subscription-plans/plan-entitlements.service.ts`:
  exclude the online store from the count.
- Modify: `apps/backend/src/storefront/storefront.service.ts`:
  - Customer creates (2 places) and checkout order create use the online
    branch.
  - `getOrders(tenantId, page, limit, storeId?)` filters by `store_id`.
  - `updateOrderStatus` checks the order's branch is allowed.
- Modify: `apps/backend/src/storefront/storefront.controller.ts`: the orders
  route takes `storeId`, resolved with `BranchScopeService.resolveStoreId`
  using `STOREFRONT_STAFF`.
- Modify: the `/auth/me` branch list builder marks `is_online` on the online
  branch.
- Test: `online-branch.service.spec.ts`, `storefront.service.spec.ts`
  additions, and `plan-entitlements` spec.

**Interfaces (produces):** `OnlineBranchService.ensure(tenantId: string, tx?: Prisma.TransactionClient): Promise<string>`

**Steps:**
- [ ] Failing tests:
  - creates once and returns the existing id after;
  - a P2002 race re-reads;
  - owners get access rows;
  - checkout stores the online branch;
  - the orders list filters by branch;
  - a status change on an order outside the caller's branches is refused;
  - plan count excludes online.
- [ ] Implement; make them pass. Commit.

### Task 3: Customers

**Files:**
- Modify: `apps/backend/src/customers/customer-visibility.ts`: strict
  `store_id IN`.
- Modify: `customers.service.ts`:
  - `create` takes `store_id` from the DTO (validated, must be in the
    caller's branches), defaulting to the header branch;
  - `importRows` takes a per-row `branch` plus a file `storeId`;
  - every credit-row writer sets `store_id: customer.store_id`.
- Modify: `customers.controller.ts` and `customer.dto.ts`: `store_id` on
  create; `storeId` on import.
- Modify: `resolve-inline-customer.util.ts` (document branch),
  `external-sync.service.ts` (connection branch), `demo-data/generator/write.ts`
  and `packages/database/prisma/seed.ts`.
- Modify: `sales/sales.service.ts` and `sales-returns/sales-returns.service.ts`:
  credit rows take the customer's branch.
- Modify: `external-sync/external-sync.impacts.ts`: credit rows take the
  party's branch.
- Test: customers spec (strict visibility, create default and validation,
  import row vs file branch, unknown branch fails the row); sales spec
  (credit row branch).

**Steps:** failing tests → implement → pass → commit.

### Task 4: Suppliers

**Files:**
- Create: `apps/backend/src/suppliers/supplier-visibility.ts` and
  `supplier-scope.service.ts`, mirroring the customer pair with
  `SUPPLIER_READ`.
- Modify: `suppliers.controller.ts`: the scope on every route; `storeId` on
  list; `canSetBranch` on update.
- Modify: `suppliers.service.ts`:
  - list, get, update, delete and credit reads take the scope;
  - create, import and update set the branch;
  - payments take the supplier's branch;
  - payment vouchers post with `storeId: payment.store_id`.
- Modify: `resolve-inline-supplier.util.ts`, `purchases/purchases.service.ts`
  and `purchase-returns.service.ts` (credit rows),
  `imports/imports.service.ts` (credit rows), external-sync, demo, seed.
- Test: suppliers spec (scope on list/get/payments; out-of-scope 404; branch
  change gated; payment takes supplier branch; voucher `storeId`).

**Steps:** failing tests → implement → pass → commit.

### Task 5: Payments lists, and customer payment vouchers

**Files:**
- Modify: `customers.service.ts` / `suppliers.service.ts` `listCreditPayments`:
  a `storeId` filter. Customer payment vouchers post with the payment's
  `store_id`, not the header.
- Modify: both controllers. `credit/payments` list resolves `storeId` with the
  credit-read permissions (`ListCustomerCreditPaymentsQueryDto` /
  `ListSupplierCreditPaymentsQueryDto` gain `storeId`).
- Modify: `apps/frontend/src/lib/api.ts`: `getCustomerCreditPayments` /
  `getSupplierCreditPayments` pass `storeId`.
- Test: services filter; the controller resolves through `branchScope`.

### Task 6: Home tiles

**Files:**
- Modify: `apps/backend/src/home-pulse/home-pulse.service.ts`: the storefront
  metric becomes `branchScoped`, counting `store_id`.
- Modify: `apps/frontend/src/components/app-shell/AppTiles.tsx`: send
  `storeId: getWorkspaceItem('store_id')`.
- Test: home-pulse spec, AppTiles test.

### Task 7: Frontend

**Files:**
- `components/payments/party-payments/PartyPaymentsWorkspace.tsx` +
  adapters: `useBranchScope()`, a `BranchFilter` in `PageHeader` actions,
  `apiStoreId` sent to `listPayments`, and the forbidden reset.
- `app/(app)/purchases/suppliers/page.tsx`: a Branch select on the form
  (required, defaulting to the header branch, read-only without
  `canSetBranch`), and a list `BranchFilter` (`startOnAll`) with a Branch
  column.
- `app/(app)/sales/customers/CustomerFormModal.tsx`: the branch is required
  on create and defaults to the header branch.
- Customer and supplier import dialogs: a "Branch for rows without one"
  select; the template gains a `branch` column.
- `app/(app)/sales/orders/StorefrontOrdersPanel.tsx`: pass the page branch,
  with a note on a shop branch.
- External-sync connection form: help text.
- Settings › Stores: an "Online" mark.
- Locales: all nine.
- Tests: the page suites for payments, suppliers, customers form, orders
  panel and AppTiles.

### Task 8: Wrap-up

- [ ] Full backend `jest src`, then the frontend full suite (sequentially).
  Then `tsc` for both apps and `next lint --quiet`.
- [ ] TODO.md: COMPLETED entry, follow-ups (spec §8), and the release note.
- [ ] Push, open a PR to `dev`, report.
