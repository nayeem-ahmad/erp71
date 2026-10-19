# Branch payment methods, per-user layouts, refund tenders, posting by linked account

**Date:** 2026-10-19
**Status:** Draft pending review (revision 2: branch-scoped methods)
**Asked as:** let each user add/remove and reorder the payment methods on sales,
purchase, sales return and purchase return entry, remembered for that user only.
Seed Cash, Bank, bKash, Nagad, Card, each connected to the right account. Then:
the cashier picks the refund methods on returns; posting must use the method's
linked account; payment methods get a branch, and users use only the methods of
their own branch.

## Decisions (confirmed in conversation 2026-10-19)

1. **Per-user layout.** Each user shows/hides and orders methods for sale,
   purchase, sales return and purchase return. Other users are unaffected.
2. **Returns get a tender.** The cashier picks how a refund moves
   (e.g. ৳500 cash + ৳200 bKash), and accounting follows it.
3. **Posting uses the linked account**, per tender, not the first method's.
4. **Methods belong to branches.** A method is for all branches or for a chosen
   set of one or more branches. On any document, a user is offered only the
   methods available at that document's branch.
5. **POS is left as it is.** It keeps its fixed Cash / bKash / Card boxes.

---

## Problem

1. **One layout for everyone.** The strip in
   `apps/frontend/src/components/document-entry/PaymentSection.tsx` shows the
   tenant's `PaymentMethod` rows with `show_on_entry`, by `sort_order`. Every
   user sees the same rows. The "+ Add method…" picker lasts for one document.
2. **No branches.** `PaymentMethod` has no branch. A shop with a bKash number
   per branch creates "bKash Gulshan" and "bKash Banani" as tenant-wide methods,
   and every cashier in every branch is offered both, so takings land in the
   wrong branch's account.
3. **Returns have no tender.** A sales return refunds by guessing from the
   original sale's first payment (`sales-returns.service.ts`,
   `returnPaymentMode`). A purchase return only lowers the supplier's due. The
   cashier session (`cashier-sessions.service.ts`) and the daily report
   (`daily-report.service.ts`) count every return as cash out of the drawer,
   even one that only reduced a credit customer's due.
4. **The linked account is ignored.** Entry screens send the canonical type as
   `paymentMethod` (`'Mobile Wallet'`, from `canonicalFor()`), and the backend
   resolves the account with `resolvePaymentMethodAccountId(tx, tenant,
   'Mobile Wallet')`, which matches by **name**. A method named "bKash" never
   matches, so bKash takings post to Main Bank Account (`classifyPaymentMode`
   sees "wallet" → `bank`). The client's `accountId` is stored on
   `PaymentRecord.account_id` and never read for posting. A split tender posts
   entirely to the first method's account (`postSaleVouchers`,
   `postPaidVoucher`).
5. **Editing can lose a payment.** `matchMethod` in the strip matches only the
   four type strings and only methods currently shown. A payment stored as
   `bKash`, `CASH`, `BKASH`, or on a method not shown, gets no row, and the
   first keystroke rebuilds the list without it. `TODO.md` already tracks this
   (~3,800 of ~9,500 production rows are affected). Per-user hiding would make
   it worse, so it is fixed here.
6. **Seeded methods have no account.** `payment-method.seed.ts` creates the five
   methods with `account_id` null, before `bootstrapDefaultAccountingForTenant`
   creates the accounts (`auth.service.ts`, `admin-tenants.service.ts`).

## Goals

- A payment method is **for all branches** (including branches opened later)
  or **for a chosen set of branches**. Every place that offers methods offers only those available at the
  document's branch, and the server refuses a new tender on a method from
  another branch.
- Each user's layout is stored per user, per branch, per context (sale,
  purchase, sale_return, purchase_return). A user who has never customised
  sees the tenant default for that branch.
- Sales return and purchase return entry get the payment strip.
- Every tender on a sale, purchase, sales return and purchase return posts to
  its method's linked account, one voucher line per account. A method with no
  linked account posts where it does today.
- Editing a document never drops a payment it already carries.
- New tenants get, for all branches and in this order:

  | Method | Type | Linked account |
  | --- | --- | --- |
  | Cash | Cash | Cash in Hand (110101) |
  | Bank | Bank | Main Bank Account |
  | bKash | Mobile Wallet | bKash Account |
  | Nagad | Mobile Wallet | Nagad Account |
  | Card | Card | Main Bank Account |

- Existing tenants: unlinked default-named methods get linked at deploy.
  Nothing is added, renamed, reordered or moved to a branch.
- The drawer's expected cash and the daily report count only cash tenders of a
  return.

## Non-goals

- POS (`sales/pos/page.tsx`) layout and branch filtering. It gets the posting
  fix through the fallback in [§4](#4-resolving-a-tenders-account).
- Sales exchanges, order deposits, expenses, salary, loans, investors: they do
  not load `PaymentMethod` rows today and keep their own lists.
- Creating a method from the entry screen (quick-create). Methods are still
  created in Settings → Payment Methods.
- Branch-level permission to *manage* methods. Managing stays behind
  `SETTINGS_ADMIN`, as today; only *using* methods is branch-limited.
- Restating historic vouchers. Old documents keep their vouchers until edited.

## Anti-goals

- A cashier able to put takings on a method that is not available at the document's branch.
- One user's layout changing another user's screen.
- A single-branch tenant, or a user who never customises, seeing any change in
  which methods appear.
- A refund that leaves the drawer, the customer's due and the ledger telling
  three different stories.
- Changing posting idempotency keys or which voucher a status read finds.

---

## Design

### 1. Branches on the method

`PaymentMethod` gains a flag, and a join table lists the branches when the flag
is off (the shape of `PrintTemplateStoreAssignment`):

```prisma
model PaymentMethod {
  // …existing fields…
  /// Offered at every branch, including branches opened later. When false,
  /// only at the branches in `stores`.
  all_branches Boolean              @default(true)
  stores       PaymentMethodStore[]
}

/// A branch a limited (all_branches = false) payment method is offered at.
model PaymentMethodStore {
  id                String   @id @default(uuid())
  tenant_id         String
  payment_method_id String
  store_id          String
  created_at        DateTime @default(now())

  tenant         Tenant        @relation(fields: [tenant_id], references: [id], onDelete: Cascade)
  payment_method PaymentMethod @relation(fields: [payment_method_id], references: [id], onDelete: Cascade)
  store          Store         @relation(fields: [store_id], references: [id], onDelete: Cascade)

  @@unique([payment_method_id, store_id])
  @@index([tenant_id, store_id])
}
```

- An explicit flag rather than "no rows means every branch": if a limited
  method ever lost its last branch row, it must become available nowhere, not
  everywhere. Saving `all_branches: false` with no branches is a 400.
- Existing rows default to `all_branches: true`, so nothing moves until an
  admin limits a method.
- Names stay unique per tenant (`@@unique([tenant_id, name])` unchanged). The
  name is what the no-id fallback (POS, external sync, imports) matches on and
  what receipts and the sales-by-method report print, so two "bKash" rows in
  one tenant would make all three ambiguous. A tenant with a number per branch
  names them "bKash Gulshan", "bKash Banani".
- Branch ids in the body must be the tenant's stores (400 otherwise).

**Available at branch S** means `is_active` and (`all_branches` or a
`PaymentMethodStore` row for S).

**The document's branch**, per screen:

| Screen | Branch |
| --- | --- |
| Sale entry, purchase entry | the header branch they post to (`storeId` in the body) |
| Sale edit, purchase edit | the document's `store_id` |
| Sales return, purchase return | the original document's `store_id`; the header branch for a return with no original |
| Customer / supplier payments | the payment's branch, i.e. the party's (`store_id` on the credit row) |

**Listing.** `GET /payment-methods` gains `storeId`:

- `storeId=S` → methods available at S. S goes through
  `BranchScopeService.resolveStoreId` with `TENDER_READ`, so a member cannot
  list a branch they have no access to.
- omitted → owners, `VIEW_CONSOLIDATED_REPORTS` holders and `SETTINGS_ADMIN`
  holders get every method (the settings page needs this); anyone else gets
  all-branch methods plus those available at any of their branches
  (`BranchScopeService.memberStoreIds`).

**Enforcement.** Every write that takes a tender checks it against the
document's branch:

- A **new** tender whose method is not available at the branch → 400 "That
  payment method isn't available at this branch."
- A tender the document **already carries** (same `payment_method_id` as the
  stored row) keeps its method on edit, even if the method has since been
  moved to another branch or switched off. Editing an old sale must not force
  a different tender.
- Applies to sale create/edit/draft finalize, purchase create/edit, both
  returns, and customer/supplier payments (`resolveCreditPaymentMethod` gains a
  `storeId` argument).

**Settings → Payment Methods.**

- The form gets a **Branches** field: an "All branches" checkbox (default on)
  and, when it is off, a checklist of the tenant's branches. Create and update
  DTOs gain `allBranches` and `storeIds`; the service replaces the join rows in
  the same transaction as the update.
- The list gets a Branches column ("All branches", or the branch names) and
  follows the header branch filter: a branch shows the methods available
  there; "All branches" (owners and consolidated holders) shows everything.
- On a single-branch tenant the field is hidden and every method stays
  "All branches".
- CSV import is unchanged: imported methods are all-branch.
- Moving a method to a branch where existing users have it in a layout needs
  nothing special: layouts only ever show available methods.

### 2. Per-user layout

**Storage** follows `TenantUser.invoice_print_prefs`, the existing
per-member preference: a new `payment_method_prefs Json?` on `TenantUser`.
It follows the person to any till within the workspace.

```json
{
  "<storeId>": {
    "sale":            { "order": ["<id>", "..."], "hidden": ["<id>"] },
    "purchase":        { "order": [], "hidden": [] },
    "sale_return":     { "order": [], "hidden": [] },
    "purchase_return": { "order": [], "hidden": [] }
  }
}
```

**Resolving the strip** for user U, branch S, context C:

1. Start from the methods available at S.
2. No saved entry for S/C → the tenant default: those with `show_on_entry`, by
   `sort_order`. This is what a new user sees the first time.
3. Saved entry → visible = available methods not in `hidden`, ordered by
   `order`. An available method in neither list (added by an admin since the
   user last saved) is appended, visible, in `sort_order`.
4. Saved ids that are no longer available (deleted, switched off, moved to
   another branch) are skipped, not errors.

**Endpoints** on the payment-methods controller, `TENDER_READ`, `tenant_id`
from `TenantInterceptor`, user from the JWT, `storeId` through
`BranchScopeService.resolveStoreId`:

- `GET /payment-methods/layout?storeId=&context=` →
  `{ customised, visible: Method[], available: Method[] }`.
- `PUT /payment-methods/layout?storeId=&context=` body
  `{ order: string[], hidden: string[] }`. Every id must be available at the
  branch (400 otherwise). Updates only that branch/context sub-key, inside a
  transaction that locks the `TenantUser` row, so two devices saving different
  screens do not overwrite each other.
- `DELETE …` removes the sub-key → back to the default.

**Strip** (`PaymentSection.tsx`) takes required `context` and `storeId` props
and renders the resolved layout. The generic fallback (no active methods →
Cash / Mobile Wallet / Card / Bank) stays.

**Customise.** A "Customise" text button in the strip header, beside the
settled chip, opens a `ModalShell`:

- every method available at this branch, in the user's order;
- a show/hide checkbox and ↑ / ↓ buttons per row (`min-h-touch`, ends
  disabled);
- "Reset to default", "Cancel", "Save".

Amounts already typed survive a save. Errors go through the global `Toaster`.
Read-only renders do not show the button.

**Which rows appear** on the strip: the resolved layout, plus any method added
from the picker for this document, plus **any method that already carries
money on the document**, even if hidden, unavailable or inactive (shown with
`(inactive)`, as today). A payment that matches no method is shown as its own
row under its stored label. A payment is never dropped.

**Matching a saved payment to a row**, in order:

1. `payment_method_id`;
2. the `payment_method_name` snapshot;
3. case-insensitive legacy match: `CASH` → the Cash-type method, `BKASH` /
   `bKash` → the method named bKash, `Nagad` → the method named Nagad, then the
   first method of that type available at the branch.

The Jest reproductions recorded in `docs/dynamic-payment-methods-plan.md` §2.4
become regression tests.

**Wiring:** sale entry and sale edit → `sale`; purchase entry → `purchase`;
sales return screen → `sale_return`; purchase return modal →
`purchase_return`. Customer/supplier payment screens filter their chips by
branch but get no Customise (not asked for).

### 3. Tenders carry the method

The strip sends `paymentMethodId` with each tender (absent for the generic
fallback). `paymentMethod` stays the canonical type string, so readers of it
(the drawer's `isCashTender`, reports) are unchanged.

- DTOs gain optional `paymentMethodId`: `CreatePaymentDto`, `UpdatePaymentDto`,
  `CreatePurchasePaymentDto`, and the new return payment DTO. The global
  `ValidationPipe` has `forbidNonWhitelisted`, so DTO and client ship in the
  same PR.
- `PaymentRecord` and `PurchasePayment` gain `payment_method_id String?`
  (FK, `onDelete: SetNull`) and `payment_method_name String?` (the name when
  saved, for prints and history). `PurchasePayment` also gains
  `account_id String?`, matching `PaymentRecord`.
- The client's `accountId` is ignored. The server resolves the account (§4) and
  writes it to the row. The DTO field stays so an older client does not 400.
- Invoices, the sales-by-method report and the cashier-session breakdown show
  `payment_method_name` when present, else today's string.

### 4. Resolving a tender's account

In `accounting/payment-account.util.ts`:

```ts
resolveTender(tx, tenantId, storeId, tender: { paymentMethodId?, paymentMethod }, opts: { stored?: StoredTender })
  → { methodId?, methodName?, accountId?, canonical }
```

1. **With an id:** the method, tenant-scoped (foreign id → 400), branch-checked
   per §1 (skipped when it matches the stored tender). Its `account_id` if set.
2. **Without an id** (POS, offline-queued POS sales, external sync, imports,
   the mobile app): match by name among methods available at the branch, then
   today's tenant-wide name match. This is what lets POS's `'BKASH'` reach the
   bKash method's account.
3. **Nothing found, or the linked account no longer exists:** no account; the
   caller uses the rule's account for `classifyPaymentMode(name ?? type)`.
   Classifying by name first means an unlinked "bKash" still lands in bKash
   Account, not the bank.

### 5. Split tenders in one voucher

`autoPostFromRules` gains an optional input:

```ts
/** Replaces the single cash/mode leg with one line per account. */
tenderLegs?: { side: 'debit' | 'credit'; lines: { accountId?: string; mode: PaymentMode; amount: number }[] };
```

- The rule is looked up by `conditionValue` (the first tender's mode) and
  supplies the **other** side (Sales Revenue, Purchase Payable…) and the
  voucher type. `amount` must equal the sum of the lines.
- A line without `accountId` takes the cash-side account of the rule for its
  own `mode`. One rule lookup per distinct mode.
- Lines on the same account merge: one detail row per account on the tender
  side, one on the other side.
- Account validation, party tagging, idempotency key, numbering and approval
  are unchanged. The override inputs keep working for callers that do not pass
  `tenderLegs`.

One voucher per event, on the same key and `legKey` as today, so
`voidAutoPostedVoucher`, `loadPostingSummary` and reconciliation need no change.
Vouchers already carry the document's `store_id`, so branch filters on the
ledger see each branch's own takings.

### 6. Callers

| Where | Today | After |
| --- | --- | --- |
| `SalesService.postSaleVouchers`, fully paid | one line, first method, name lookup | `tenderLegs` debit, a line per tender |
| same, paid portion of a credit sale (`legKey 'paid'`) | same | same |
| `postSaleReceiptVoucher` (overpayment) | first method | first tender's resolved account (my call: rare and small; pro rata adds nothing) |
| `PurchasesService.postPaidVoucher` (`legKey 'paid'`) | first method, name lookup | `tenderLegs` credit, a line per tender |
| draft finalize; sale and purchase edit restate | re-read `payment_method` | re-read `payment_method_id`, name and `account_id` from stored rows when no payments are sent |
| sales return, purchase return | guessed mode / no money | §7 |

`postSaleVouchers` and `postPaidVoucher` take the tender list instead of
`primaryPaymentMethod`. The limitation comment in `classify-payment-mode.ts`
is updated to point at §4.

### 7. Returns

**Storage.** New `SalesReturnPayment` and `PurchaseReturnPayment`
(`return_id`, cascade), each with `payment_method` (canonical),
`payment_method_id?`, `payment_method_name?`, `account_id?`, `amount`, the five
instrument columns, `created_at`, `@@index([return_id])`.

**DTOs.** Create and update DTOs of both returns gain optional
`payments: { paymentMethod, paymentMethodId?, amount, …instrument }[]`.
Omitted `payments` (older clients, the mobile app, imports) keeps today's
behaviour exactly.

**Sales return.** `refunded = sum(payments)`, `adjusted = total − refunded`.

- `refunded > total` → 400.
- `adjusted > 0` needs the original sale's customer; without one, payments
  must equal the total (400 "Refund the full amount, or pick the customer's
  sale").
- `adjusted` comes off the customer's due through the existing
  `CustomerCreditTransaction` ADJUSTMENT, **not clamped** to the current due:
  the excess becomes an advance (negative due), which
  `sale-overpayment.util.ts` already treats as normal.
- Posting mirrors `postSaleVouchers`. With `adjusted > 0`: the primary voucher
  (no `legKey`) on `sale_return/credit` (Dr Sales Revenue / Cr Accounts
  Receivable, party-tagged), and the refund on `legKey 'paid'` with
  `tenderLegs` credit. With `adjusted = 0`: one voucher, no `legKey`,
  `tenderLegs` credit.
- **Pre-fill**, so a cashier who changes nothing gets today's result: a sale
  with a due → `min(total, customer's due)` adjusted, the rest in the original
  sale's first tender (if that method is available at the branch, else the
  user's first visible method); a paid sale → the whole total in that tender;
  no sale → the whole total in the user's first visible method. The chip reads
  "Adjusted against due ৳X".

**Purchase return.** `received = sum(payments)`.

- `received > total` → 400.
- The supplier is `purchase.supplier_id`, else the return's `supplier_id`.
  With neither, payments must equal the total.
- The bill voucher is unchanged: `purchase_return` / `none`, Dr Purchase
  Payable / Cr Purchases, full total. `received > 0` posts a second voucher,
  `legKey 'received'`, on `supplier_payment` / `payment_direction: 'receive'`
  (Dr Cash in Hand / Cr Purchase Payable) with `tenderLegs` debit — purchase
  entry's pattern turned round.
- The supplier's due moves by `total − received`, not clamped. Today the due
  is clamped at zero while the voucher moves the payable by the full total;
  after this they agree.
- **Pre-fill:** nothing received, the whole total against the payable — today's
  behaviour. No supplier → the whole total in the user's first visible method.
  The chip reads "Adjusted against payable ৳X".

**Edit and delete.** Today neither return service's `update` or `remove`
touches the voucher or the due — a pre-existing gap that money tenders make
untenable.

- `remove` voids every voucher the return posted (primary and `legKey`),
  writes an opposite ADJUSTMENT for its due change, and the payment rows go
  with the cascade.
- `update` with new items or payments does the same unwind, then settles and
  posts as if newly entered. A reason-only update touches nothing.
- The unwind reads what was written, not what would be posted now: the due
  change is the sum of credit rows with `reference_type` `SALES_RETURN` /
  `PURCHASE_RETURN` and `reference_id` = the return; the vouchers are the
  posting events for the return's id. So a return saved before this change
  unwinds correctly too.
- `voidAutoPostedVoucher` applies `assertFiscalPeriodOpen`, so a return in a
  closed month cannot be edited or deleted.

**Drawer and daily report.** A return's cash out = its payments that pass
`isCashTender`. A return with no payment rows (saved before this change)
counts `total_refund`, as today, so closed shifts and past reports do not move.

### 8. Accounts, seeding and deploy

- `PaymentMethod.account_id` becomes a real relation (`onDelete: SetNull`).
  Production applies schema with `db push` from
  `apps/backend/scripts/db-prepare.sh`, and Postgres refuses the FK while any
  dangling id exists, so a sync step that nulls dangling ids must run **before**
  the push (the `sync:user-mobile-unique` pattern). The account-delete guard in
  `accounting.service.ts` also counts linked methods.
- `DEFAULT_PAYMENT_METHODS`: Cash 1, Bank 2, bKash 3, Nagad 4, Card 5, all
  branches (`all_branches: true`), each naming the account to link.
- `linkDefaultPaymentMethodAccounts(tx, tenantId)` in `payment-method.seed.ts`:
  for each default name, if the method exists with `account_id` null and an
  account with that exact name exists, link it. Idempotent; never overwrites.
- Called right after `bootstrapDefaultAccountingForTenant` in `auth.service.ts`
  and `admin-tenants.service.ts`, same transaction, and from `seed.ts`.
- Existing tenants: `sync:payment-method-accounts` runs the same function for
  every tenant, as a step in `db-prepare.sh` after the push. It runs on its own
  at deploy; nothing to run by hand.
- A Prisma migration for the dev history, per `CLAUDE.md`: `all_branches` on
  `PaymentMethod`, the `PaymentMethodStore` table, the `account_id` FK, `payment_method_prefs` on `TenantUser`, the payment
  columns, and the two return payment tables. All additive or nullable.

---

## Relation to `docs/dynamic-payment-methods-plan.md`

That plan (2026-09-26, unbuilt) is superseded where they overlap:

- **Taken from it:** payments remember their method (id + name snapshot),
  legacy matching on edit and never dropping a payment, posting per tender,
  linking seeded methods after accounting bootstraps, the `account_id` FK and
  delete guard, `db push` / `sync:*` constraints.
- **Replaced:** its per-side "Shown / When needed / Off" visibility on the
  method is replaced by per-user, per-branch, per-context layouts. The tenant's
  `show_on_entry` remains the default a new user starts from.
- **Still open after this, not in scope:** quick-create from the picker, POS
  and order deposits on method ids, settings-page i18n, delete returning 409
  for a method in use.

Its §2.4 defects and the TODO entries "Editing a sale silently drops payments…"
and "A bank-paid purchase credits Cash in Hand" are closed by this work.

## Testing

Backend (jest, `--maxWorkers=2`, affected dirs only):

- branch: a method limited to branches A and B is offered at both and not at
  C; an all-branch method reaches a branch created afterwards; a limited
  method with no branches is refused; foreign store ids refused; listing
  with/without `storeId` for owner, limited member, settings admin; a member cannot list a foreign branch; a new tender on
  another branch's method → 400; an edit keeps a stored tender whose method has
  since moved; customer/supplier payment refuses another branch's method.
- layout: default with no saved entry; saved order and hidden; newly added
  method appended; unavailable ids skipped on read and refused on write; user A
  invisible to user B; branch A's layout does not show in branch B; two
  contexts saved concurrently both survive.
- `resolveTender`: id, foreign id, stored tender on a moved/inactive method,
  name at branch before tenant-wide, `BKASH` → bKash's account, no link →
  rule by name, deleted account → rule.
- `autoPostFromRules` with `tenderLegs`: split across linked accounts;
  unlinked line uses its own mode's rule; same-account merge; sum mismatch
  fails; party tag still on the control leg.
- sale: bKash-linked tender → bKash Account; cash + bKash split → two debit
  lines; credit sale with split down-payment; edit restate; draft finalize.
- purchase: split paid leg; bank tender credits the bank, not cash.
- sales return: split full refund; partial refund + due; excess → advance; no
  customer + partial → 400; omitted payments = today; edit and delete unwind,
  including a legacy return.
- purchase return: received split + payable; omitted = today; edit and delete
  unwind.
- drawer and daily report: only cash tenders; legacy return counted as today.
- seed: new tenant linked; link function idempotent, never overwrites; dangling
  account ids nulled before the FK.

Frontend:

- `PaymentSection`: layout per branch and context; Customise hide/reorder/
  save/reset; amounts survive a save; a hidden method carrying money still
  shows; legacy strings match; sends `paymentMethodId`; the §2.4 reproductions.
- settings: All-branches checkbox and branch checklist; column; list follows
  the header branch; field hidden on a single-branch tenant.
- sales return page, purchase return modal: pre-fill rules, chip, payload.
- party payments: chips limited to the payment's branch.

Page tests under `(app)` run with `--runTestsByPath`.

## Release

One PR `dev` → `main`, after `next lint --quiet` over `apps/frontend`. The
deploy's `db-prepare.sh` nulls dangling account ids, pushes the schema and
links default methods. Check `/health` after. Live tenants with custom lists
(KH Tradind, Press Club, Babu Bazar) only gain links on unlinked
default-named methods, and every existing method stays "All branches" until
an admin limits it to chosen branches.

## Left to the builder

- Copy and placement of the Customise button and modal within the UI rules.
- Whether the layout fetch is a shared query hook.
- Internal shape of the tender list passed between services.
- How the return screens fetch the customer's current due for the pre-fill.
- Whether the sync that nulls dangling account ids is its own step or part of
  `sync:payment-method-accounts` run in two phases.
