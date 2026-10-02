# Dynamic payment methods on sales and purchases — plan

Status: **proposed, 2026-09-26.** Nothing here is built. Written in answer to
"In sales/purchase, payment methods should load dynamically. Some should show up
by default. Others can be added when needed."

The short version:

> Most of the mechanism already exists: a per-tenant `PaymentMethod` list, a
> "Show on Entry UI" flag, and an "Add method…" picker on sale and purchase
> entry. What is missing is (1) defaults that use it — every tenant is seeded
> with all five methods shown, (2) a separate choice for sales and for
> purchases, (3) a way to create a method in the middle of an entry, (4)
> payments that remember *which* method they were — today only a type string is
> stored, which breaks editing, posting, invoices and reports — and (5) the
> screens that still hard-code their methods or take none. Four phases, one PR
> each.

The edit-screen defects in §2.4 were reproduced by rendering the shared strip
under Jest with throwaway tests. Everything else was traced through the code.

## 1. What already exists

- **`PaymentMethod`** (`packages/database/prisma/schema.prisma:1186`) has these fields:
  - `name`
  - `type`: `Cash | Mobile Wallet | Card | Bank`, from `PaymentMethodType` in `packages/shared-types`
  - `account_id`: a plain column with no relation
  - `is_active`
  - `show_on_entry`
  - `sort_order`, shown as "Serial"
- **Settings → Payment Methods** (`/settings/payment-methods`) creates, edits,
  imports and deletes methods. "Show on Entry UI" and "Serial" came with the
  2026-07-14 sales-entry rework
  (`docs/superpowers/specs/2026-07-14-sales-entry-rework-design.md`, Parts 3–4).
- **The shared tender strip** is `components/document-entry/PaymentSection.tsx`.
  It is used by `/sales/new`, `/sales/[id]` (edit) and `/purchases/new`.
  - It calls `GET /payment-methods` once per mount.
  - It shows active `show_on_entry` methods as amount rows, in serial order.
  - It lists the other active methods in an "Add method…" select.
  - It falls back to generic Cash / Mobile Wallet / Card / Bank when the tenant
    has no active method.
- **Default methods:** `seedDefaultPaymentMethods`
  (`packages/database/prisma/payment-method.seed.ts`) gives a new tenant Cash,
  bKash, Nagad, Card and Bank. It is called at signup (`auth.service.ts:1229`)
  and at admin tenant creation (`admin-tenants.service.ts:828`).

## 2. What is wrong today

### 2.1 The split never happens

The seed creates all five methods with `show_on_entry: true`. Every tenant
therefore opens sale and purchase entry with five amount rows and an empty
picker. "Some by default, the rest when needed" is supported but never set up.

### 2.2 One flag for two screens

Sale entry and purchase entry read the same `show_on_entry` flag. A shop that
takes cash and bKash at the counter but pays suppliers in cash and by cheque
cannot set up both.

### 2.3 "Added when needed" stops at the existing list

- The picker offers only methods that are already defined.
- Adding a new one (Rocket, Upay, a second bank account) means leaving the
  half-entered document for Settings.
- A method added from the picker cannot be removed again. The July spec's
  remove button was never built.

### 2.4 Saved payments forget which method they were

The strip emits `{ method: canonicalFor(type), label: name, accountId }`. Both
entry pages then send only `paymentMethod: p.method` and `accountId`
(`sales/new/page.tsx:356-359`, `purchases/new/page.tsx:268-272`). The method's
name never reaches the server, so bKash and Nagad payments are both stored as
`Mobile Wallet`. `PaymentRecord.payment_method` ends up holding three
spellings: POS writes `CASH`/`BKASH`/`CARD`, the entry screens write the four
type strings, and older rows hold names such as `bKash` and `Nagad`. The
consequences:

- **Editing a sale can silently drop its payments.**
  - Only the four type strings match a row (`matchMethod`, case-sensitive).
  - A payment stored under any other string gets no amount box.
  - The first change to any amount box rebuilds the payment list without it, so
    saving records it as never paid.
  - **Reproduced:** ৳60 `CASH` + ৳40 `BKASH` reopens with every box empty.
    Typing 5 into Card emits `[Card 5]`.
  - **Reproduced:** ৳50 `Cash` + ৳30 `bKash` + ৳20 `Nagad` reopens with only Cash
    filled. Typing 5 into Card emits `[Cash 50, Card 5]`.
  - **Scale:** the production census recorded in `TODO.md` (search
    "overwhelmingly the *display* string") counted about 3,800 such rows out of
    about 9,500 (`bKash` 2297, `Nagad` 1360, `CASH` 58, `BKASH` 42, `CARD` 21).
- **A wallet payment from sale entry reopens as the first wallet.**
  `Mobile Wallet` carries no name, so a Nagad payment comes back in the bKash
  box and saves as bKash (reproduced).
- **A payment on a method that is not shown by default disappears on edit.**
  - Rows are the `show_on_entry` methods plus those added from the picker in
    this session.
  - **Reproduced:** a ৳100 bKash payment, with bKash not shown by default,
    reopens with no bKash row while the chip reads "✓ Settled".
- **A bKash or Nagad payment from sale entry posts to Main Bank Account.**
  - `classifyPaymentMode('Mobile Wallet')` matches the `wallet` substring and
    returns `bank`.
  - The account override `resolvePaymentMethodAccountId(tx, tenantId, 'Mobile Wallet')`
    looks a method up *by name* and finds none.
  - So even a tenant who linked bKash to "bKash Account" gets bKash takings in
    the bank. POS escapes this only because it sends `BKASH`.
- **A bank-paid purchase credits Cash in Hand.**
  - The purchase's paid leg uses the `supplier_payment/pay` rule, which credits
    Cash in Hand.
  - The only way around it is a method *named* `Bank` with an `account_id`; the
    seeded one has none.
  - The client's `accountId` is dropped on purchases
    (`purchases.service.ts:175-184`). On sales it is stored but never read for
    posting.
- **Reports and invoices print "Mobile Wallet".**
  - Sales-by-payment-method groups by the raw string
    (`sales-reports.service.ts:1759-1789`). bKash and Nagad merge into one
    bucket, while `Cash` and `CASH` are two.
  - The cashier-session breakdown (`cashier-sessions.service.ts:267-273`) has
    the same split.

Two defects are already tracked in `TODO.md` and this plan absorbs them:

- **Split tenders:** a split payment posts as one voucher on the first method
  ("One counter payment, one cash account…").
- **Edits don't re-post:** editing a posted sale does not re-post ("Editing a
  posted sale never moves the customer's due").

### 2.5 Screens that are not on the list

| Screen | Today |
|---|---|
| POS `/sales/pos` | Three fixed inputs: Cash, bKash, Card (`pos/page.tsx:83-85`, `:484-487`). The offline queue stores the same strings (`lib/pos-db.ts:34`). |
| Sales-order deposit `/sales/orders/[id]` | Always sends `'CASH'` (`:123`), while the label reads "Amount to Pay (Cash/Card)". |
| Customer payments `/sales/customer-payments` and the customer page | No method field. `RecordCreditPaymentDto` has none, so the payment posts to Cash in Hand. |
| Supplier payments `/purchases/supplier-payments` | No method field, so the payment posts to Cash in Hand. |
| Sales return | No refund method. It is derived from the sale's first payment (`sales-returns.service.ts:188-193`), with no account override. |

### 2.6 Any member can change them

> **Update 2026-10-01:** the gate half of this is fixed. `ba56ee88` ("require a
> permission on every route that any member could call") put create, import,
> update and delete behind `SETTINGS_ADMIN`, and reads behind `TENDER_READ` or
> `PAYMENT_ACCOUNTS_READ`. The dangling `account_id` and the account-delete
> guard below are still open. See §6 for what this means for the new permission.

- `PaymentMethodsController` applies only `JwtAuthGuard` and `TenantInterceptor`,
  with no `@RequireStorePermission`.
- So any member, a cashier included, can relink a method's ledger account or
  hard-delete it.
- `account_id` is a plain column, so deleting the account leaves the link
  dangling.
- The account-delete guard (`accounting.service.ts:772-790`) counts
  `PaymentRecord.account_id` but not `PaymentMethod.account_id`.

## 3. The model

### 3.1 Visibility per side

Each method gets one setting per side:

| | Sales side (money in) | Purchase side (money out) |
|---|---|---|
| **Shown** | an amount row on every document | same |
| **When needed** | listed in the "Add method…" picker | same |
| **Off** | not offered | not offered |

- **Sales side:** sale entry, POS, order deposits, customer payments and
  sales-return refunds.
- **Purchase side:** purchase entry and supplier payments.

The schema change is additive and nullable, so nothing needs a backfill and
production's `db push --accept-data-loss` has nothing to lose:

```prisma
model PaymentMethod {
  // …existing fields…
  /// SHOWN | ON_DEMAND | OFF. Null = never chosen: read as show_on_entry ? SHOWN : ON_DEMAND.
  sales_visibility    String?
  purchase_visibility String?
}
```

- `is_active` stays the master switch.
- `show_on_entry` stays too, read only as the fallback. Renaming or dropping it
  would make `db push` delete every tenant's choice.
- The service resolves the effective value, so clients never see null.

### 3.2 Payments remember their method

Add these columns to `PaymentRecord` and `PurchasePayment`. `OrderDeposit`,
`CustomerCreditTransaction` and `SupplierCreditTransaction` follow in Phase 4.

```prisma
  payment_method_id   String?   // FK → PaymentMethod, onDelete: SetNull
  payment_method_name String?   // the name at the time, for prints and history
```

- `payment_method` keeps the type string it holds today, so every existing
  reader keeps working.
- The DTOs gain `paymentMethodId`. It must land in the DTO in the same PR as the
  clients that send it: the global `ValidationPipe` sets
  `forbidNonWhitelisted`, so an unknown key fails the whole save with a 400.
- **With an id**, the server loads the method (tenant-scoped; a foreign id is a
  400) and takes the type, name and ledger account from that record. The
  client-sent `accountId` is no longer trusted.
- **Without an id**, the string path stays as it is. That covers POS until
  Phase 4, sales already queued offline, imports and legacy rows.

### 3.3 Ledger accounts

- **Posting** takes the cash leg from the method:
  1. `account_id`, when it is set;
  2. otherwise the mode, as today, but classified from the method's *name*
     first (so bKash and Nagad reach their own accounts) and its type second.
- **New tenants:** seed the methods *after*
  `bootstrapDefaultAccountingForTenant` and link them to the default accounts:

  | Method | Account (code) |
  |---|---|
  | Cash | Cash in Hand (110101) |
  | bKash | bKash Account (110103) |
  | Nagad | Nagad Account (110104) |
  | Bank, Card | Main Bank Account (110102) |

- **Existing tenants:** an idempotent `sync:payment-method-accounts` step fills
  `account_id`, but only where it is null and the method still has its seeded
  name and type.
- **The account link becomes a real relation:** `PaymentMethod.account_id` gets
  a foreign key with `onDelete: SetNull`.
  - A sync step that runs *before* `db push` must null dangling ids first.
    Otherwise Postgres refuses the foreign key and the backend never boots (see
    the `sync:user-mobile-unique` pattern in `apps/backend/Dockerfile`).
  - The account-delete guard must also count linked methods.

### 3.4 Posting per tender

A split tender posts one leg per method, instead of the whole amount on the
first. This is the rules-engine change already tracked in TODO: a `legKey` per
tender, with the void logic changed to match. It is the largest and riskiest
piece and needs its own review.

## 4. Behaviour on the entry screens

- **Which rows appear:**
  - methods marked **Shown** for this side, in serial order;
  - methods added from the picker for this document;
  - **any method that already carries money on the document** (the edit fix).
- **How a saved payment finds its row**, in this order:
  1. `payment_method_id`;
  2. the name snapshot;
  3. a case-insensitive match on the type or legacy key: `CASH` → Cash,
     `BKASH` → the wallet named bKash, otherwise the first method of that type.

  A payment that matches nothing is shown as its own row under its stored
  label. It is never dropped.
- **Removing:** a row added from the picker whose amount is empty gets a remove
  (×) that puts it back in the picker.
- **The picker** lists the **When needed** methods. For users allowed to manage
  methods it ends with "+ New payment method…":
  - it opens a `ModalShell` form: name, type, optional ledger account, and
    "Shown on sales / purchase";
  - on save, the new method joins the strip with its amount box focused.
- **Loading:** `usePaymentMethods(side)` replaces the per-mount fetch.
  - It makes one request per page load and keeps a module-level cache.
  - Quick-create and the settings page invalidate the cache.
  - It returns `{ shown, onDemand, all, byId }`.
  - POS also keeps a copy in IndexedDB for offline use.

## 5. Settings page

- Replace the single "Show on Entry UI" switch with two selects, each offering
  Shown / When needed / Off:
  - **Sales**
  - **Purchase**

  Show both values as chips on each row of the list.
- For a non-cash method with no linked account, show a hint: "Payments post to
  <default account>. Link an account to keep this method's money separate."
- Deleting a method that payments reference returns 409, "In use — deactivate
  it instead", and the button offers to deactivate.
- The page is English-only today. Its strings move to
  `t.settings.paymentMethods` in all nine locales.

## 6. Permissions

> **Update 2026-10-01:** mutations already require `SETTINGS_ADMIN` (see §2.6).
> A dedicated `MANAGE_PAYMENT_METHODS` is now only worth adding if an accountant
> should manage methods without full settings access. Decide this before Phase 1;
> if it goes ahead, follow the five-place checklist for a new `StorePermission`
> (shared-types, Prisma enum, migration, sync group, template-role backfill).

- Add a new `StorePermission.MANAGE_PAYMENT_METHODS`, in
  `packages/shared-types/index.ts` first.
- Require it on POST, PATCH, DELETE and import. Reads stay open to every member,
  because every entry screen needs the list. The `crm-message-templates`
  controller is the precedent: `MANAGE_CRM_SETTINGS` on mutations only.
- Add it to `ROLE_DEFAULT_PERMISSIONS` for MANAGER and ACCOUNTANT (the
  accountant owns the ledger link), but not CASHIER.
- Give it a group in `sync-role-permissions.ts`. Without that it reaches no
  existing tenant, and the OWNER bypass hides the gap from whoever tests it.
- Hide the quick-create option from users who lack it.

## 7. What will bite

- **Production runs `db push --accept-data-loss`.**
  - Columns are additive only, and nothing is renamed.
  - Backfills are `sync:*` steps in the backend `Dockerfile` CMD, not migration
    SQL.
  - The table is `"PaymentMethod"`. The `payment_methods` in migration
    `20260616193142` is a historical oddity.
- **`forbidNonWhitelisted`:** the DTO change and the client that sends the new
  key ship in the same PR.
- **Offline POS:** sales already queued in IndexedDB carry
  `{ paymentMethod: 'BKASH', amount }` and replay after the deploy. The string
  path must keep accepting them.
- **Draft finalize** rebuilds payments from the stored strings
  (`sales.service.ts:733-744`). It must carry the id and the name through.
- **Legacy `Mobile Wallet` rows** cannot be told apart after the fact. The
  backfill does not guess; reports keep them under "Mobile Wallet".
- **Seed and demo data:** `seed.ts` and the demo-data generator write payment
  strings directly. They need ids too, or demo data only ever exercises the
  legacy path.

## 8. Phases

Each phase ships on its own.

1. **Shown vs. when-needed, per side, plus the edit fixes.** No accounting
   change.
   - Schema from §3.1, plus the DTO, the service and the settings form (§5
     without delete protection).
   - Strip changes from §4: which rows appear, legacy matching, keeping
     unmatched payments, and the remove button.
   - Defaults for new tenants (§9, decision 1), and `MANAGE_PAYMENT_METHODS` on
     writes (§6).
   - The Jest reproductions become regression tests.
2. **Payments remember their method and post to the right account.**
   - §3.2, §3.3 and §3.4.
   - Invoices, the sales-by-method report and the cashier-session breakdown
     read the name.
   - Delete protection.
3. **Create a method when needed.** Quick-create from the picker, and the
   `usePaymentMethods` cache.
4. **The remaining screens.**
   - POS: chips for Shown methods plus "More", sending ids, with an IndexedDB
     cache.
   - Order deposits.
   - Customer and supplier payments: a method select, and posting through the
     method's account. This closes the "apply the override to the other
     cash-touching callers" follow-up in TODO.
   - Sales-return refund method, defaulting to the sale's first method.

## 9. Decisions (recommendation first)

1. **New-tenant defaults.**
   - Sales: Cash and bKash shown; Nagad, Card and Bank when needed.
   - Purchase: Cash and Bank shown; bKash, Nagad and Card when needed.
2. **Existing tenants: leave what they see alone.** Their visibility inherits
   today's `show_on_entry`, so nothing moves under a cashier mid-shift. A "Use
   recommended defaults" button on the settings page lets an owner opt in.
3. **Who can create a method mid-entry:** only holders of
   `MANAGE_PAYMENT_METHODS`. Everyone else picks from the list.
4. **Per-tender posting belongs in Phase 2.** A dynamic list is cosmetic if a
   split still books everything to the first method's account.

## 10. Out of scope

- **Other modules:** expenses, loans, investors, salary payments and fund
  transfers keep their own hard-coded lists:
  - `accounting/expenses/page.tsx:43`
  - `accounting/loans/page.tsx:55`
  - `accounting/investors/page.tsx:87`
  - `hr/salary-payments/page.tsx:35`
  - `accounting/inter-branch/fund-transfers`

  `usePaymentMethods` makes each of them a small follow-up.
- **Gateway checkout** (bKash/Nagad payment APIs): these are tenders a cashier
  records, not online payments.
- **Cheque lifecycle** (deposited, cleared, bounced): tracked separately in TODO
  ("Nothing reads the cheques back").
