# Branch Payment Methods, Per-User Layouts, Refund Tenders, Posting by Linked Account — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Payment methods belong to all or chosen branches; each user arranges the methods on sale, purchase, sales return and purchase return entry; returns record how the refund moved; every tender posts to its method's linked account.

**Architecture:** `PaymentMethod` gains `all_branches` plus a `PaymentMethodStore` join table. One resolver (`resolveTenders`) turns submitted tenders into method id, name, account and posting mode, enforcing the branch rule. `autoPostFromRules` gains `tenderLegs` so one voucher carries one line per account, on unchanged idempotency keys. Per-user layouts live in `TenantUser.payment_method_prefs` JSON (the `invoice_print_prefs` precedent), resolved server-side.

**Tech Stack:** NestJS, Prisma/PostgreSQL, Next.js 15, Jest, Testing Library.

**Spec:** `docs/superpowers/specs/2026-10-19-payment-method-layout-and-tender-posting-design.md`

## Global Constraints

- Available at branch S = `is_active` and (`all_branches` or a `PaymentMethodStore` row for S).
- Branch refusal copy, exactly: `That payment method isn't available at this branch.`
- Sales return without a customer, partial refund, copy: `Refund the full amount, or pick the customer's sale`.
- Return chips: `Adjusted against due {amount}` (sales return), `Adjusted against payable {amount}` (purchase return); money via `formatBDT()`.
- Default methods, in order, all branches: Cash→Cash in Hand (110101), Bank→Main Bank Account, bKash→bKash Account, Nagad→Nagad Account, Card→Main Bank Account.
- Method names stay unique per tenant (`@@unique([tenant_id, name])` unchanged).
- Idempotency keys unchanged. Leg keys: `'paid'` (sale, sales return refund), `'received'` (purchase return money).
- Global `ValidationPipe` uses `forbidNonWhitelisted`: a DTO field and the client that sends it ship together.
- Production applies schema with `db push` in `apps/backend/scripts/db-prepare.sh`; backfills are `sync:*` steps there. Dev history still gets a Prisma migration (`CLAUDE.md`).
- After touching `schema.prisma` or `packages/shared-types`: `npx prisma generate --schema packages/database/prisma/schema.prisma` and `npm run build --workspace packages/shared-types`.
- UI rules (`CLAUDE.md`): `ModalShell`, `blue-600` accent, `min-h-touch` targets, global `Toaster` only, no `rounded-2xl`, no hex classes.
- POS (`sales/pos/page.tsx`) is not touched.
- Jest: backend `--maxWorkers=2 --workerIdleMemoryLimit=600MB`, only affected dirs; `(app)` page tests via `--runTestsByPath`. Never run backend and frontend suites in parallel.

## Review Focus

1. **Overpaid split sale** — Cash 1000 + bKash 200 on an 1100 sale: Cash in Hand gets 1000 and bKash Account 200 across the sale and receipt vouchers. Test in Task 6.
2. **Editing a sale whose tender's method has since moved branch or been switched off**, changing only a quantity: saves, tender and account unchanged. Test in Task 6.
3. **A fully-adjusted new-style sales return** (refund 0, all against due) must not count as drawer cash, while a legacy return still does. This is why returns get `tenders_recorded` (Task 1). Test in Task 14.
4. **Legacy payment strings on edit** (`CASH`, `BKASH`, `bKash`, `Nagad`, `Mobile Wallet` meaning Nagad) reopen in the right box and survive a save. Test in Task 10.
5. **Credit-sale return larger than the current due** (due 100, return 300, refund 0): due becomes −200 (advance), the AR leg is 300, the drawer is untouched. Test in Task 12.

---

## File Map

| File | Responsibility |
| --- | --- |
| `packages/database/prisma/schema.prisma` | new columns and models (Task 1) |
| `packages/database/prisma/migrations/20261019120000_branch_payment_methods/migration.sql` | dev migration |
| `packages/shared-types/payment-layout.ts` (+ export from `index.ts`) | `PaymentLayoutContext`, `PaymentLayoutEntry`, `PaymentMethodPrefs`, `PaymentLayoutResponse` |
| `packages/database/prisma/payment-method.seed.ts` | defaults, `linkDefaultPaymentMethodAccounts` |
| `packages/database/prisma/sync-payment-method-account-fk.ts` | pre-push: null dangling `account_id` |
| `packages/database/prisma/sync-payment-method-accounts.ts` | post-push: link defaults on every tenant |
| `apps/backend/src/payment-methods/payment-method-branches.ts` | branch availability `where` + predicate |
| `apps/backend/src/payment-methods/payment-layout.ts` | pure layout resolution and prefs merge |
| `apps/backend/src/accounting/payment-account.util.ts` | `resolveTenders`, `allocateTenders`, `sameTenders` |
| `apps/backend/src/accounting/posting.utils.ts` | `tenderLegs` |
| `apps/backend/src/common/return-payment.dto.ts` | `ReturnPaymentDto` |
| `apps/backend/src/sales-returns/return-cash.util.ts` | `returnCashOut` for drawer and daily report |
| `apps/frontend/src/components/document-entry/PaymentSection.tsx` | layout-driven strip, matching, ids |
| `apps/frontend/src/components/document-entry/PaymentLayoutModal.tsx` | Customise modal |
| `apps/frontend/src/components/document-entry/payment-match.ts` | `matchPaymentToMethod` |
| `apps/frontend/src/lib/return-refund-prefill.ts` | `refundPrefill` |

---

### Task 1: Schema, migration, shared types

**Files:**
- Modify: `packages/database/prisma/schema.prisma`
- Create: `packages/database/prisma/migrations/20261019120000_branch_payment_methods/migration.sql`
- Create: `packages/shared-types/payment-layout.ts`; Modify: `packages/shared-types/index.ts`

**Interfaces:**
- Produces (Prisma): `PaymentMethod.all_branches Boolean @default(true)`, `PaymentMethod.stores PaymentMethodStore[]`, `PaymentMethod.account Account? (account_id, onDelete: SetNull)`; model `PaymentMethodStore` exactly as spec §1; `TenantUser.payment_method_prefs Json?`; on `PaymentRecord` and `PurchasePayment`: `payment_method_id String?` (FK PaymentMethod, SetNull) and `payment_method_name String?`; `PurchasePayment.account_id String?` (FK Account, SetNull); models `SalesReturnPayment` (`return_id` → SalesReturn cascade) and `PurchaseReturnPayment` (`return_id` → PurchaseReturn cascade), each: `payment_method String`, `payment_method_id String?` (SetNull), `payment_method_name String?`, `account_id String?` (SetNull), `amount Decimal @db.Decimal(12, 2)`, the five instrument columns as on `PurchasePayment`, `created_at`, `@@index([return_id])`; `SalesReturn.tenders_recorded Boolean @default(false)` and `PurchaseReturn.tenders_recorded Boolean @default(false)`; back-relations on `Tenant`, `Store`, `Account`, `SalesReturn` (`payments`), `PurchaseReturn` (`payments`).
- Produces (shared-types):
  ```ts
  export type PaymentLayoutContext = 'sale' | 'purchase' | 'sale_return' | 'purchase_return';
  export const PAYMENT_LAYOUT_CONTEXTS: readonly PaymentLayoutContext[];
  export interface PaymentLayoutEntry { order: string[]; hidden: string[] }
  export type PaymentMethodPrefs = Record<string /* storeId */, Partial<Record<PaymentLayoutContext, PaymentLayoutEntry>>>;
  export interface PaymentLayoutResponse<M> { customised: boolean; visible: M[]; available: M[] }
  ```

`tenders_recorded` is not in the spec: it is how the drawer tells a new-style return with no refund (all against due) from a legacy return with no payment rows (Review Focus 3).

- [ ] **Step 1:** Edit the schema as above. Doc-comment every new field in the file's style (why, not what).
- [ ] **Step 2:** Run `npx prisma validate --schema packages/database/prisma/schema.prisma`. Expected: `The schema ... is valid`.
- [ ] **Step 3:** Generate the migration SQL schema-to-schema; the local DB has no migration history, so `migrate dev` is unusable. Run `git show HEAD:packages/database/prisma/schema.prisma > "$TMPDIR/prev.prisma" && npx prisma migrate diff --from-schema-datamodel "$TMPDIR/prev.prisma" --to-schema-datamodel packages/database/prisma/schema.prisma --script > packages/database/prisma/migrations/20261019120000_branch_payment_methods/migration.sql`. Before the `ADD CONSTRAINT` for `PaymentMethod.account_id`, insert `UPDATE "PaymentMethod" pm SET account_id = NULL WHERE account_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM accounts a WHERE a.id = pm.account_id);`.
- [ ] **Step 4:** Add `payment-layout.ts` to shared-types and export it from `index.ts`.
- [ ] **Step 5:** Run `npx prisma generate --schema packages/database/prisma/schema.prisma && npm run build --workspace packages/shared-types`. Expected: both succeed.
- [ ] **Step 6:** Run `npx tsc --noEmit -p apps/backend`. Expected: no errors. Nothing writes the new required columns yet; every new column is optional or defaulted.
- [ ] **Step 7:** Commit: `feat(db): branch-scoped payment methods, per-user layouts, return tenders`.

---

### Task 2: Seed links, deploy syncs, account-delete guard

**Files:**
- Modify: `packages/database/prisma/payment-method.seed.ts`, `packages/database/prisma/seed.ts`, `packages/database/package.json`, `apps/backend/scripts/db-prepare.sh`
- Modify: `apps/backend/src/auth/auth.service.ts:1426`, `apps/backend/src/admin-tenants/admin-tenants.service.ts:1039`, `apps/backend/src/accounting/accounting.service.ts:770-790`
- Create: `packages/database/prisma/sync-payment-method-account-fk.ts`, `packages/database/prisma/sync-payment-method-accounts.ts`
- Test: `apps/backend/src/payment-methods/payment-method-seed.spec.ts`, `apps/backend/src/accounting/account-crud.spec.ts`, `auth.service.spec.ts` / `admin-tenants.service.spec.ts` mocks

**Interfaces:**
- Produces: `DEFAULT_PAYMENT_METHODS: { name; type; sort_order; link_to: string }[]` (Cash 1 `Cash in Hand`, Bank 2 `Main Bank Account`, bKash 3 `bKash Account`, Nagad 4 `Nagad Account`, Card 5 `Main Bank Account`); `linkDefaultPaymentMethodAccounts(tx: any, tenantId: string): Promise<{ linked: string[] }>`, exported from `@erp71/database`.

- [ ] **Step 1: Write the failing tests** in `payment-method-seed.spec.ts`:
  ```ts
  it('links each unlinked default method to the account of that exact name', async () => {
      // tx.paymentMethod.findMany → [{id:'pm-cash',name:'Cash',account_id:null},{id:'pm-bk',name:'bKash',account_id:null}]
      // tx.account.findMany → [{id:'a-cash',name:'Cash in Hand'},{id:'a-bk',name:'bKash Account'}]
      await expect(linkDefaultPaymentMethodAccounts(tx, 't1')).resolves.toEqual({ linked: ['Cash', 'bKash'] });
      expect(tx.paymentMethod.update).toHaveBeenCalledWith({ where: { id: 'pm-cash' }, data: { account_id: 'a-cash' } });
  });
  it('never overwrites an existing link and skips names with no matching account', ...);
  it('lists defaults in the order Cash, Bank, bKash, Nagad, Card', () => {
      expect(DEFAULT_PAYMENT_METHODS.map((m) => m.name)).toEqual(['Cash', 'Bank', 'bKash', 'Nagad', 'Card']);
  });
  ```
  In `account-crud.spec.ts`: deleting an account that a payment method links to is refused, with the same error the existing `paymentRecord` count produces.
- [ ] **Step 2:** Run `cd apps/backend && npx jest src/payment-methods src/accounting/account-crud.spec.ts --maxWorkers=2 --workerIdleMemoryLimit=600MB`. Expected: FAIL (function not exported; guard missing).
- [ ] **Step 3: Implement.**
  - Reorder `DEFAULT_PAYMENT_METHODS` and add `link_to`.
  - `linkDefaultPaymentMethodAccounts` reads only default-named methods with `account_id: null`, then accounts by those `link_to` names, then updates each match.
  - Call it right after `bootstrapDefaultAccountingForTenant` in both services, in the same `tx`, and from `seed.ts` after the demo tenant's accounting bootstrap.
  - Add `paymentMethod.count({ where: { account_id: id } })`, `purchasePayment.count(...)`, `salesReturnPayment.count(...)` and `purchaseReturnPayment.count(...)` to the delete guard's `Promise.all`.
  - Add jest mocks of the new export to the two service specs that mock `@erp71/database`.
- [ ] **Step 4: Sync scripts.**
  - `sync-payment-method-account-fk.ts` runs before the push. It uses raw SQL because the client may be ahead of the database. It nulls dangling `"PaymentMethod".account_id` with the `UPDATE` from Task 1 Step 3, accepts `--dry-run`, and is a no-op when the table is missing. Follow the header style of `sync-purchase-date.ts`.
  - `sync-payment-method-accounts.ts` runs after the push. It loops over tenants and calls `linkDefaultPaymentMethodAccounts`, printing `tenant <id>: linked Cash, bKash` lines, with a `--dry-run` that rolls back.
  - Add `sync:payment-method-account-fk` and `sync:payment-method-accounts` to `packages/database/package.json`.
  - In `db-prepare.sh`, add `step sync:payment-method-account-fk` before `step "prisma db push"` (next to `sync:purchase-date`) and `step sync:payment-method-accounts` after `step sync:accounting`.
- [ ] **Step 5:** Re-run the Step 2 command plus `npx jest src/auth src/admin-tenants --maxWorkers=2 --workerIdleMemoryLimit=600MB`. Expected: PASS.
- [ ] **Step 6:** Commit: `feat(payment-methods): link seeded methods to their accounts, at signup and at deploy`.

---

### Task 3: Branch availability in the payment-methods API

**Files:**
- Create: `apps/backend/src/payment-methods/payment-method-branches.ts`
- Modify: `apps/backend/src/payment-methods/payment-methods.{dto,service,controller}.ts`
- Test: `payment-methods.service.spec.ts`, Create: `payment-methods.controller.branch-scope.spec.ts` (pattern: `accounting/accounting.controller.branch-scope.spec.ts`)

**Interfaces:**
- Produces:
  ```ts
  export function availableAt(storeIds: string[]): Prisma.PaymentMethodWhereInput; // is_active && (all_branches || stores.some.store_id in storeIds)
  export function isAvailableAt(m: { is_active: boolean; all_branches: boolean; stores: { store_id: string }[] }, storeId: string): boolean;
  // service
  findAll(tenantId: string, opts?: { type?: PaymentMethodType; storeIds?: string[] }): Promise<PaymentMethodResponseDto[]>; // storeIds undefined = every method
  ```
- DTOs: `CreatePaymentMethodDto`/`UpdatePaymentMethodDto` gain `@IsOptional() @IsBoolean() all_branches?: boolean` and `@IsOptional() @IsArray() @IsString({ each: true }) store_ids?: string[]`. `PaymentMethodResponseDto` gains `all_branches: boolean; store_ids: string[]`. Snake case matches the existing DTO fields.

- [ ] **Step 1: Write the failing tests.**
  - service: `creates a method limited to two branches`: `paymentMethodStore.createMany` called with both store ids.
  - `refuses all_branches false with no branches` → `BadRequestException`.
  - `refuses a store id that is not the tenant's` → `BadRequestException`.
  - `update replaces the branch rows`: deleteMany then createMany in one `$transaction`.
  - `findAll with storeIds filters to methods available there`: the `where` passed to `findMany` contains `availableAt(['s1'])`.
  - controller: `storeId=S` goes through `branchScope.resolveStoreId(ctx, 'S', { permissions: TENDER_READ })` and filters to `[S]`. Omitted, an owner gets `storeIds: undefined`. Omitted, a limited member gets `storeIds: memberStoreIds`. A member naming a foreign branch → `ForbiddenException` from the scope service.
- [ ] **Step 2:** Run `cd apps/backend && npx jest src/payment-methods --maxWorkers=2 --workerIdleMemoryLimit=600MB`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - Write the join rows in the same transaction as the method.
  - `findAll` includes `stores: { select: { store_id: true } }` and maps `store_ids`.
  - Controller `GET /payment-methods` takes `@Query('storeId')`.
  - The settings page sends its header-filter branch (or `all`), so the omitted case covers only old clients: owners and `canSeeAllBranches` get all, everyone else `memberStoreIds`. This settles the spec's "SETTINGS_ADMIN holders get every method" in favour of the settings page following the header filter, which the spec's settings bullet already says.
  - Inject `BranchScopeService`; `DatabaseModule` already exports it.
- [ ] **Step 4:** Re-run. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(payment-methods): methods for all or chosen branches`.

---

### Task 4: Settings page — branches field

**Files:**
- Modify: `apps/frontend/src/app/(app)/settings/payment-methods/page.tsx`, `apps/frontend/src/lib/api.ts:5719`
- Test: `apps/frontend/src/app/(app)/settings/payment-methods/page.test.tsx`

**Interfaces:**
- Consumes: Task 3 response fields `all_branches`, `store_ids`; `api.getStores()`.
- Produces: `api.getPaymentMethods(type?: string, storeId?: string)`. The second argument is new; existing callers are unchanged.

- [ ] **Step 1: Write the failing tests:**
  - `shows an All branches checkbox, checked by default, and a branch checklist when unchecked`
  - `saves all_branches false with the ticked store_ids`
  - `refuses to save with All branches off and no branch ticked`, with inline field error text `Pick at least one branch` and no request sent
  - `shows a Branches column with branch names or "All branches"`
  - `hides the field on a single-branch tenant` (`getStores` → one store)
  - `lists methods for the header branch` (`getPaymentMethods` called with the workspace `store_id`)
- [ ] **Step 2:** Run `cd apps/frontend && npx jest --runTestsByPath "src/app/(app)/settings/payment-methods/page.test.tsx"`. Expected: FAIL.
- [ ] **Step 3:** Implement within the UI rules. Read the branch filter the same way the customer list does (header-linked; "All branches" only for owners and consolidated holders).
- [ ] **Step 4:** Re-run. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(settings): choose the branches a payment method is offered at`.

---

### Task 5: Tender resolution and split-tender posting

**Files:**
- Modify: `apps/backend/src/accounting/payment-account.util.ts`, `apps/backend/src/accounting/posting.utils.ts`, `apps/backend/src/sales/classify-payment-mode.ts` (comment only)
- Test: `apps/backend/src/accounting/payment-account.util.spec.ts`; Create: `apps/backend/src/accounting/posting-tender-legs.spec.ts` (copy the `buildTx` shape from `posting-party.spec.ts`, with `postingRule.findFirst` answering per `condition_value`)

**Interfaces:**
- Produces:
  ```ts
  export interface TenderInput { paymentMethod: string; paymentMethodId?: string | null; amount: number }
  export interface StoredTender { payment_method: string; payment_method_id: string | null; payment_method_name: string | null; account_id: string | null; amount: unknown }
  export interface ResolvedTender {
      paymentMethod: string;          // canonical string as submitted — what PaymentRecord.payment_method stores
      methodId: string | null;
      methodName: string | null;
      accountId: string | null;
      mode: PaymentMode;              // classifyPaymentMode(methodName ?? paymentMethod)
      amount: number;
  }
  export async function resolveTenders(db: Client, tenantId: string, storeId: string, tenders: TenderInput[], stored?: StoredTender[]): Promise<ResolvedTender[]>;
  export function storedToTenderInputs(rows: StoredTender[]): TenderInput[];
  export function allocateTenders(tenders: ResolvedTender[], amount: number): { lines: TenderLegLine[]; rest: ResolvedTender[] };
  export function sameTenders(a: { methodId: string | null; paymentMethod: string; amount: number }[], b: typeof a): boolean;
  // posting.utils.ts
  export interface TenderLegLine { accountId?: string | null; mode: string; amount: number }
  AutoPostInput.tenderLegs?: { side: 'debit' | 'credit'; lines: TenderLegLine[] };
  ```

**Rules `resolveTenders` must follow** (spec §4):
- With an id: `findFirst({ id, tenant_id })`, including `stores`. Missing → 400 `That payment method does not exist or is switched off.` If the id is among `stored[].payment_method_id`, accept it as is, whatever its branch or `is_active`. Otherwise `isAvailableAt(method, storeId)` must hold, else 400 with the Global Constraints copy.
- Without an id: a case-insensitive name match among `availableAt([storeId])`, then today's exact-name tenant-wide match (`resolvePaymentMethodAccountId`'s query). With no match, the method fields are null.
- Batch the lookups into one or two queries, not one per tender.

**`allocateTenders` algorithm** (not determined by the signature): walk the tenders in order, taking `min(remaining, tender.amount)` into `lines` (`{ accountId, mode, amount }`). Any part of a tender beyond `amount` goes to `rest` with its amount reduced. If the tenders run out before `amount`, append `{ accountId: null, mode: 'cash', amount: shortfall }`, which is today's `'cash'` default for a sale posted with no payments. Round to 2 decimals.

**`tenderLegs` in `autoPostFromRules`:**
- Look the rule up as today, from `conditionValue`. It supplies the opposite side's account and the voucher type.
- For each line without `accountId`, take the tender-side account of the rule for `(eventType, conditionKey, line.mode)`. If there's none, use the found rule's tender-side account. Cache by mode.
- Merge lines by account and drop zero lines. If the sum differs from `input.amount` by more than 0.005, fail `AUTO_POSTING_TENDER_SUM_MISMATCH` the way `AUTO_POSTING_ACCOUNT_INVALID` fails.
- Validate all accounts belong to the tenant and that the opposite account is not among the tender accounts.
- Write one detail row per merged account plus one opposite row, tagging every row with `partyFieldsFor`.
- Without `tenderLegs`, the code path is byte-for-byte today's.

- [ ] **Step 1: Write the failing tests.**
  - `resolveTenders`:
    - `resolves an id to its name and linked account`
    - `refuses a foreign id`
    - `refuses a new tender on a method not available at the branch` (message equals the constraint copy)
    - `refuses a new tender on a switched-off method`
    - `accepts a stored tender whose method moved branch or was switched off`
    - `matches POS's BKASH by name at the branch before tenant-wide`
    - `leaves account null for an unknown name; mode comes from the name` (`'Upay'` → `'cash'`, `'bKash'` → `'bkash'`)
  - `allocateTenders`:
    - `caps at the amount and returns the tail`: Cash 1000 + bKash 200 at 1100 → lines `[Cash 1000, bKash 100]`, rest `[bKash 100]`
    - `pads a shortfall with a cash line`
  - `sameTenders`: `true for the same tenders in another order`; `false when an amount or method differs`
  - `posting-tender-legs.spec.ts`:
    - `writes one debit line per linked account and one revenue credit`
    - `an unlinked bkash line takes the bkash rule's account, not the first tender's`
    - `merges two lines on the same account`
    - `fails on a sum mismatch`
    - `tags the party on the control leg only`
    - `without tenderLegs the voucher is unchanged`
- [ ] **Step 2:** Run `cd apps/backend && npx jest src/accounting/payment-account.util.spec.ts src/accounting/posting-tender-legs.spec.ts src/accounting/posting-party.spec.ts --maxWorkers=2 --workerIdleMemoryLimit=600MB`. Expected: FAIL.
- [ ] **Step 3:** Implement the interfaces and rules above. Update the limitation comment in `classify-payment-mode.ts` to point at `resolveTenders`.
- [ ] **Step 4:** Re-run, plus `npx jest src/accounting --maxWorkers=2 --workerIdleMemoryLimit=600MB`. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(accounting): resolve tenders to their linked accounts and post one line per account`.

---

### Task 6: Sales post by tender

**Files:**
- Modify: `apps/backend/src/sales/sale.dto.ts:71,301`, `apps/backend/src/sales/payment-record-data.ts`, `apps/backend/src/sales/sales.service.ts` (create ~301, `applySalePostings` 734, `postSaleVouchers` 982, `postSaleReceiptVoucher` 1071, `createDraft` 1206, `finalizeDraft` 1262-1340, `update` 1770-1826, `restateSaleAccount` 1881, `restateSaleLedger` 2011)
- Test: `apps/backend/src/sales/sales.service.spec.ts`, `apps/backend/src/sales/payment-record-data.spec.ts`

**Interfaces:**
- Consumes: Task 5 `resolveTenders`, `storedToTenderInputs`, `allocateTenders`, `sameTenders`, `tenderLegs`.
- Produces:
  - `CreatePaymentDto` and `UpdatePaymentDto` gain `@IsOptional() @IsString() paymentMethodId?: string`.
  - `paymentRecordData(payment: CreatePaymentDto | UpdatePaymentDto, tender: ResolvedTender): PaymentRecordData`. The result adds `payment_method_id`, `payment_method_name` and `account_id: tender.accountId`; the client's `accountId` is ignored.
  - Every `primaryPaymentMethod: string` input becomes `tenders: ResolvedTender[]`: `postSaleVouchers`, `postSaleReceiptVoucher`, `restateSaleAccount.next`, `restateSaleLedger.input`.

**Behaviour:**
- Branch for resolution: `dto.storeId` on create and draft, `sale.store_id` on finalize and edit. Stored rows are passed as `stored` on finalize and edit.
- **Fully paid:** the sale voucher uses `tenderLegs: { side: 'debit', lines: allocateTenders(tenders, total).lines }`.
- **Credit sale's `'paid'` leg:** `allocateTenders(tenders, amountPaid).lines`.
- **Overpayment receipt voucher:** `tenderLegs` debit from the `rest` of the sale allocation. This refines the spec's "first tender's account": each account then receives exactly what was tendered on it (Review Focus 1).
- **`tenderChanged`** in the restate paths = `!sameTenders(next, stored)`. It replaces `samePaymentMethod`, which is deleted if unused.
- **When an edit sends no `payments`:** tenders come from `resolveTenders(..., storedToTenderInputs(sale.payments), sale.payments)`.

- [ ] **Step 1: Write the failing tests** in `sales.service.spec.ts`. Assert on the `voucher.create` details the existing spec captures.
  - `a bKash tender linked to bKash Account debits bKash Account`
  - `cash + bKash split posts two debit lines in one voucher`
  - `credit sale with a split down-payment posts the paid leg per tender`
  - `overpaid split: Cash 1000 + bKash 200 on 1100 → sale voucher Cash 1000 / bKash 100, receipt voucher bKash 100`
  - `stores payment_method_id, name and server-resolved account_id, ignoring the client accountId`
  - `refuses a new tender on another branch's method` (constraint copy)
  - `editing quantity on a sale whose tender's method has since moved branch keeps the tender and its account`
  - `finalizing a draft posts with the stored tenders' accounts`
  - `a payment with no paymentMethodId (POS 'BKASH') still posts to bKash's linked account`
- [ ] **Step 2:** Run `cd apps/backend && npx jest src/sales --maxWorkers=2 --workerIdleMemoryLimit=600MB`. Expected: the new tests FAIL.
- [ ] **Step 3:** Implement the interface changes and behaviour above.
- [ ] **Step 4:** Re-run `npx jest src/sales src/common --maxWorkers=2 --workerIdleMemoryLimit=600MB`. `src/common` holds `branch-list-endpoints.spec.ts`, which calls `SalesController` positionally. Expected: PASS.
- [ ] **Step 5:** Commit: `fix(sales): each tender posts to its method's linked account`.

---

### Task 7: Purchases post by tender

**Files:**
- Modify: `apps/backend/src/purchases/purchase.dto.ts:49-62`, `apps/backend/src/purchases/purchases.service.ts` (create 187-405, `postPaidVoucher` 521, update 889-1165)
- Test: `apps/backend/src/purchases/purchases.service.spec.ts`

**Interfaces:**
- Consumes: Task 5.
- Produces:
  - `CreatePurchasePaymentDto.paymentMethodId?: string`.
  - `postPaidVoucher(tx, tenantId, paid: { purchaseId; purchaseNumber; amount; storeId; supplierId?; tenders: ResolvedTender[]; date? })`, posting with `tenderLegs: { side: 'credit', lines: allocateTenders(tenders, amount).lines }`.
  - `purchasePayment.createMany` rows gain `payment_method_id`, `payment_method_name` and `account_id`.

Resolve inside the transaction with `storeId = dto.storeId` on create and the purchase's `store_id` on edit, passing stored rows on edit. Replace the `sameMethod(bill.payments[0]...)` comparison at 896 with `sameTenders`. The supplier ledger note `Paid on purchase … (methods)` lists `methodName ?? paymentMethod`.

- [ ] **Step 1: Write the failing tests:**
  - `a bank tender credits the linked bank account, not Cash in Hand`
  - `cash + bKash split credits two accounts in one voucher`
  - `stores method id, name and account on PurchasePayment`
  - `editing a bill whose tender's method moved branch keeps it`
  - `refuses a new tender on another branch's method`
- [ ] **Step 2:** Run `cd apps/backend && npx jest src/purchases --maxWorkers=2 --workerIdleMemoryLimit=600MB`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Re-run. Expected: PASS.
- [ ] **Step 5:** Commit: `fix(purchases): each tender posts to its method's linked account`.

---

### Task 8: Customer and supplier payments respect the branch

**Files:**
- Modify: `apps/backend/src/accounting/payment-account.util.ts` (`resolveCreditPaymentMethod`), `apps/backend/src/customers/customers.service.ts:938,1073`, `apps/backend/src/suppliers/suppliers.service.ts:886,1040`
- Modify: `apps/frontend/src/components/payments/party-payments/usePaymentMethods.ts`, `PaymentEntryForm.tsx`, `PartyPaymentsWorkspace.tsx`
- Test: `payment-account.util.spec.ts`, `customers.service.spec.ts`, `suppliers.service.spec.ts`, `apps/frontend/src/app/(app)/sales/customer-payments/page.test.tsx`

**Interfaces:**
- Produces:
  - `resolveCreditPaymentMethod(db, tenantId, methodId, storeId: string)`. It adds `...availableAt([storeId])` to the `where`, and a miss returns the constraint copy.
  - `usePaymentMethods(storeId?: string)`, which calls `api.getPaymentMethods(undefined, storeId)` and refetches when `storeId` changes.

Pass the party's `store_id`, which the credit row already uses. Edits that keep the stored method go through `storedPaymentMethodAccountId` as today and are not branch-checked. `PaymentEntryForm` passes the picked party's `store_id`, falling back to the workspace `store_id`.

- [ ] **Step 1: Write the failing tests:**
  - `resolveCreditPaymentMethod refuses a method not available at the party's branch` (constraint copy)
  - customers and suppliers: `recording a payment on another branch's method → 400`
  - frontend: `the method chips list only methods of the picked customer's branch`
- [ ] **Step 2:** Run `cd apps/backend && npx jest src/accounting/payment-account.util.spec.ts src/customers src/suppliers --maxWorkers=2 --workerIdleMemoryLimit=600MB`, then separately `cd apps/frontend && npx jest --runTestsByPath "src/app/(app)/sales/customer-payments/page.test.tsx" "src/app/(app)/purchases/supplier-payments/page.test.tsx"`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Re-run both. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(payments): customer and supplier payments offer only the party branch's methods`.

---

### Task 9: Per-user layout API

**Files:**
- Create: `apps/backend/src/payment-methods/payment-layout.ts`, `apps/backend/src/payment-methods/payment-layout.spec.ts`
- Modify: `payment-methods.{dto,service,controller}.ts`
- Test: `payment-methods.service.spec.ts`, `payment-methods.controller.branch-scope.spec.ts`

**Interfaces:**
- Consumes: Task 1 types, Task 3 `availableAt`.
- Produces:
  ```ts
  // payment-layout.ts (pure)
  export function resolvePaymentLayout<M extends { id: string; show_on_entry: boolean; sort_order: number }>(
      available: M[], saved: PaymentLayoutEntry | undefined): { customised: boolean; visible: M[] };
  export function setLayoutEntry(prefs: unknown, storeId: string, context: PaymentLayoutContext, entry: PaymentLayoutEntry | null): PaymentMethodPrefs;
  export function readLayoutEntry(prefs: unknown, storeId: string, context: PaymentLayoutContext): PaymentLayoutEntry | undefined;
  // service
  getLayout(ctx: TenantContext, storeId: string, context: PaymentLayoutContext): Promise<PaymentLayoutResponse<PaymentMethodResponseDto>>;
  saveLayout(ctx: TenantContext, storeId: string, context: PaymentLayoutContext, entry: PaymentLayoutEntry): Promise<PaymentLayoutResponse<PaymentMethodResponseDto>>;
  resetLayout(ctx: TenantContext, storeId: string, context: PaymentLayoutContext): Promise<PaymentLayoutResponse<PaymentMethodResponseDto>>;
  ```
- DTOs: `PaymentLayoutQueryDto { @IsString() storeId; @IsIn(PAYMENT_LAYOUT_CONTEXTS) context }`, `SavePaymentLayoutDto { @IsArray() @IsString({ each: true }) order; same for hidden }`.
- Routes: `GET`, `PUT` and `DELETE /payment-methods/layout`, `TENDER_READ`, declared above `@Get(':id')`. `storeId` goes through `branchScope.resolveStoreId(ctx, storeId, { permissions: TENDER_READ, allowAll: false })`.

`resolvePaymentLayout` follows spec §2 steps 1–4. Available methods arrive sorted by `sort_order`. With no saved entry, visible = those with `show_on_entry`. With a saved entry, visible = available minus `hidden`, ordered by `order`, and any id in neither list is appended in `sort_order`. Unknown saved ids are skipped. `prefs` that isn't an object reads as `{}`.

`saveLayout` refuses ids that are not available at the branch (400). It runs in `$transaction`: `SELECT 1 FROM "TenantUser" WHERE tenant_id = $1 AND user_id = $2 FOR UPDATE`, re-read `payment_method_prefs`, `setLayoutEntry`, update. Only that branch and context change.

- [ ] **Step 1: Write the failing tests:**
  - pure: `no entry → show_on_entry methods by sort_order`; `entry → order kept, hidden removed`; `a method added since is appended visible`; `unavailable ids skipped`; `setLayoutEntry leaves other branches and contexts untouched`; `null entry removes the key`
  - service:
    - `user A's saved layout does not reach user B`: B's `tenantUser.findUnique` returns null prefs → `customised: false`
    - `branch A's layout does not show in branch B`
    - `save refuses an id not available at the branch`
    - `save locks the membership row before writing`: `$queryRaw` called before `tenantUser.update`
    - `reset removes only that branch/context`
  - controller: `a member cannot read a layout for a branch they have no access to`
- [ ] **Step 2:** Run `cd apps/backend && npx jest src/payment-methods --maxWorkers=2 --workerIdleMemoryLimit=600MB`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Re-run. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(payment-methods): per-user, per-branch payment method layouts`.

---

### Task 10: Strip — layout, method ids, never drop a payment

**Files:**
- Create: `apps/frontend/src/components/document-entry/payment-match.ts` (+ `payment-match.test.ts`)
- Modify: `apps/frontend/src/components/document-entry/PaymentSection.tsx`, `apps/frontend/src/lib/api.ts`, `apps/frontend/src/lib/hooks/useNewSaleCart.ts:68-76`
- Modify: `apps/frontend/src/app/(app)/sales/components/PaymentSection.tsx`, `SaleEntryLayout.tsx`, `sales/new/page.tsx:447-456`, `sales/[id]/page.tsx:237-240`, `purchases/components/PurchasePaymentSection.tsx`, `PurchaseEntryLayout.tsx`, `usePurchaseEntry.ts:205-211`
- Test: `apps/frontend/src/app/(app)/sales/components/PaymentSection.test.tsx`, `sales/new/page.test.tsx`, `sales/[id]/page.test.tsx`, `purchases/new/page.test.tsx`

**Interfaces:**
- Consumes: Task 9 routes.
- Produces:
  ```ts
  // api.ts — the frontend shape of PaymentMethodResponseDto
  export interface PaymentMethodRow { id: string; name: string; type: string; account_id?: string | null; is_active: boolean; sort_order: number; show_on_entry: boolean; all_branches: boolean; store_ids: string[] }
  getPaymentLayout(storeId: string, context: PaymentLayoutContext): Promise<PaymentLayoutResponse<PaymentMethodRow>>;
  savePaymentLayout(storeId: string, context: PaymentLayoutContext, entry: PaymentLayoutEntry): Promise<PaymentLayoutResponse<PaymentMethodRow>>;
  resetPaymentLayout(storeId: string, context: PaymentLayoutContext): Promise<PaymentLayoutResponse<PaymentMethodRow>>;
  // useNewSaleCart.ts
  Payment.paymentMethodId?: string;
  // payment-match.ts
  export function matchPaymentToMethod<M extends { id: string; name: string; type: string }>(methods: M[], p: Payment): M | undefined;
  // PaymentSection props (shared strip and both wrappers)
  context: PaymentLayoutContext; storeId: string;
  ```

**`matchPaymentToMethod` order** (spec §2): match `paymentMethodId`; else a case-insensitive `label`/name match; else legacy (`CASH`→the Cash-type method, `BKASH`/`bkash`→the method named bKash, `NAGAD`/`nagad`→the method named Nagad, then the first method whose canonical type equals `p.method`, compared case-insensitively). Matching runs against **all available methods plus inactive ones from `getPaymentMethods`**, not just visible rows.

**Rows rendered:** layout `visible`, plus methods picked for this document, plus every method matched by a payment with an amount. A payment matching nothing gets its own row keyed `legacy-<index>`, labelled with `p.label || p.method`, editable, and re-emitted unchanged except for its amount. The picker lists `available` methods not already shown. The emitted `Payment` carries `paymentMethodId`, `label`, `method: canonicalFor(type)`. The sale and purchase submit mappers forward `paymentMethodId`.

`storeId`: the workspace `store_id` on `sales/new` and `purchases/new`; the document's `store_id` on `sales/[id]`.

- [ ] **Step 1: Write the failing tests.**
  - Replace the `getPaymentMethods` mock with `getPaymentLayout` + `getPaymentMethods`.
  - Port the existing 17 tests.
  - `payment-match.test.ts`: one test per legacy string; `a Mobile Wallet payment labelled Nagad matches Nagad, not bKash`.
  - `PaymentSection.test.tsx`:
    - `renders the user's visible methods in layout order`
    - `requests the layout for the given storeId and context`
    - `৳60 CASH + ৳40 BKASH reopens filled; typing 5 into Card emits [CASH 60, BKASH 40, Card 5]`
    - `৳50 Cash + ৳30 bKash + ৳20 Nagad reopens with all three filled`
    - `a payment on a hidden method still shows with its amount`
    - `an unmatched payment shows as its own row and survives a change elsewhere`
    - `emits paymentMethodId for a defined method`
  - Page tests: the submitted body carries `paymentMethodId`.
- [ ] **Step 2:** Run `cd apps/frontend && npx jest src/components/document-entry` and `npx jest --runTestsByPath "src/app/(app)/sales/components/PaymentSection.test.tsx" "src/app/(app)/sales/new/page.test.tsx" "src/app/(app)/sales/[id]/page.test.tsx" "src/app/(app)/purchases/new/page.test.tsx"`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Re-run. Check the suite count in the output matches the number of paths passed. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(entry): payment strip follows the user's layout and never drops a saved payment`.

---

### Task 11: Customise modal

**Files:**
- Create: `apps/frontend/src/components/document-entry/PaymentLayoutModal.tsx`, `PaymentLayoutModal.test.tsx`
- Modify: `PaymentSection.tsx` (header button and labels), `purchases/components/PurchasePaymentSection.tsx` (labels), `apps/frontend/src/lib/localization/messages/{ar,bn,de,en,es,fr,hi,ms,ur}/purchases.ts` (`purchaseShared.paymentLayout`)

**Interfaces:**
- Consumes: Task 10 api calls.
- Produces: `PaymentLayoutModal({ methods: PaymentMethodRow[] /* available, in current order */, hiddenIds: string[], onSave(entry: PaymentLayoutEntry): Promise<void>, onReset(): Promise<void>, onClose(), labels })`. `PaymentSectionLabels` gains `customise: 'Customise'`, `customiseTitle: 'Payment methods on this screen'`, `resetLayout: 'Reset to default'`, `saveLayout: 'Save'`, `cancelLayout: 'Cancel'`, `moveUp: 'Move {method} up'`, `moveDown: 'Move {method} down'`, `showMethod: 'Show {method}'`.

Built on `ModalShell`. Each row has a checkbox and ↑/↓ `Button`s with `min-h-touch`, disabled at the ends. Save sends `{ order: all ids in shown order, hidden: unchecked ids }`. Typed amounts survive the refresh. A failed save toasts through the global `Toaster` and keeps the modal open. The button is not rendered when `readOnly`. Purchase-side labels come from `t.purchaseShared.paymentLayout`, translated in all nine locales.

- [ ] **Step 1: Write the failing tests:**
  - `moving a method up and saving sends the new order`
  - `unchecking hides it on save`
  - `↑ disabled on the first row, ↓ on the last`
  - `Reset calls resetPaymentLayout and closes`
  - `a failed save keeps the modal open and toasts`
  - `amounts already typed survive a layout save` (in `PaymentSection.test.tsx`)
  - `no Customise button when readOnly`
- [ ] **Step 2:** Run `cd apps/frontend && npx jest src/components/document-entry --runTestsByPath "src/app/(app)/sales/components/PaymentSection.test.tsx"`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Re-run, plus `npx tsc --noEmit -p apps/frontend`, which catches a missing locale key. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(entry): customise which payment methods show, and their order`.

---

### Task 12: Sales return tenders, posting, edit and delete

**Files:**
- Create: `apps/backend/src/common/return-payment.dto.ts`
- Modify: `apps/backend/src/sales-returns/sales-returns.dto.ts`, `sales-returns.service.ts` (create 25-268, findOne 307, update 326, remove 507)
- Test: `apps/backend/src/sales-returns/sales-returns.service.spec.ts`

**Interfaces:**
- Consumes: Task 5.
- Produces:
  - `class ReturnPaymentDto extends PaymentInstrumentDto { paymentMethod: string; paymentMethodId?: string; amount: number /* @Min(0) */ }`.
  - `CreateSalesReturnDto.payments?: ReturnPaymentDto[]` and `UpdateSalesReturnDto.payments?: ReturnPaymentDto[]`, with `@ValidateNested({ each: true }) @Type(() => ReturnPaymentDto)`.
  - Private `unwindSalesReturn(tx, tenantId, ret): Promise<void>` and `settleSalesReturn(tx, tenantId, userId, ret, input: { total: number; tenders: ResolvedTender[] | null; sale })`.
  - `findOne` and `findAll` include `payments`.

**Behaviour** (spec §7). `tenders === null` is the legacy path: the code that runs today, unchanged.
- **With tenders:** reject `refunded > total`. `adjusted > 0` with no sale customer → 400 with the constraint copy.
- **Customer:** `total_spent` decrements as today. `adjusted` writes an ADJUSTMENT of `−adjusted`, with `balance_after = due − adjusted`, not clamped.
- **Posting with `adjusted > 0`:** the primary voucher uses `sale_return`/`credit` for `adjusted` (party-tagged), and the `'paid'` leg uses `sale_return`/first tender's mode with `tenderLegs: { side: 'credit', lines: allocateTenders(tenders, refunded).lines }` when `refunded > 0`.
- **Posting with `adjusted = 0`:** one keyless voucher with `tenderLegs` credit.
- **Saving:** create `salesReturnPayment` rows and set `tenders_recorded: true`.
- **`unwindSalesReturn`:**
  - void `('sale_return', id)` and `('sale_return', id, 'paid')`;
  - sum `customerCreditTransaction.amount` where `reference_type: 'SALES_RETURN', reference_id: id`, and when non-zero write the opposite ADJUSTMENT (notes `Reversed return <number>`) and restore `due_balance`;
  - restore `total_spent += total_refund` when the sale has a customer, so a re-settle does not decrement twice;
  - delete `salesReturnPayment` rows.
- **`update` with items or payments:**
  - unwind, apply the item changes as today, then settle.
  - Payments omitted on a `tenders_recorded` return → re-use the stored payments. If their sum exceeds the new total → 400 `The refund is more than the new return total — change the refund too.`
  - Payments omitted on a legacy return → settle legacy.
  - A reason-only update touches nothing.
- **`remove`:** unwind first.

- [ ] **Step 1: Write the failing tests:**
  - `split full refund: one keyless voucher crediting Cash and bKash accounts; drawer-relevant payment rows saved; tenders_recorded true`
  - `partial refund on a credit sale: AR voucher for the adjusted part + 'paid' voucher for the refund`
  - `credit sale, due 100, return 300, refund 0 → due −200 and an AR leg of 300` (Review Focus 5)
  - `no customer and a partial refund → 400 with the exact copy`
  - `refund above total → 400`
  - `omitted payments posts exactly as today` (assert the legacy `conditionValue`)
  - `update re-settles: old vouchers voided, opposite ADJUSTMENT written, total_spent not double-decremented`
  - `update of a legacy return unwinds its legacy ADJUSTMENT and voucher`
  - `update with items only keeps stored payments; refuses when they exceed the new total`
  - `remove unwinds vouchers and due`
  - `a return in a closed fiscal period cannot be edited` (from `voidAutoPostedVoucher`)
- [ ] **Step 2:** Run `cd apps/backend && npx jest src/sales-returns --maxWorkers=2 --workerIdleMemoryLimit=600MB`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Re-run. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(sales-returns): the cashier picks the refund tenders; edits and deletes unwind the books`.

---

### Task 13: Purchase return tenders, posting, edit and delete

**Files:**
- Modify: `apps/backend/src/purchase-returns/purchase-return.dto.ts`, `purchase-returns.service.ts` (create 20-174, findOne 213, update 229, remove 348)
- Test: `apps/backend/src/purchase-returns/purchase-returns.service.spec.ts`

**Interfaces:**
- Consumes: Task 5, Task 12 `ReturnPaymentDto`.
- Produces: `payments?: ReturnPaymentDto[]` on both purchase return DTOs; private `unwindPurchaseReturn`, `settlePurchaseReturn`; `findOne` and `findAll` include `payments`.

**Behaviour:**
- `tenders === null` is today's path.
- **With tenders:** reject `received > total`. The supplier is `purchase.supplier_id ?? return.supplier_id`; with none, payments must equal the total (400 `Record the full amount received, or pick the supplier's purchase`).
- **Supplier ledger:** an ADJUSTMENT of `−(total − received)`, not clamped.
- **Vouchers:** the bill voucher is unchanged (`purchase_return`/`none`, full total). When `received > 0`, a second `autoPostFromRules` posts `eventType: 'supplier_payment'`, `conditionKey: 'payment_direction'`, `conditionValue: 'receive'`, `legKey: 'received'`, `sourceType: 'purchase_return'` with `tenderLegs: { side: 'debit', lines: allocateTenders(tenders, received).lines }`, party-tagged.
- **Unwind:** void `('purchase_return', id)` and `('supplier_payment', id, 'received')`, reverse the summed `SupplierCreditTransaction` rows with `reference_type: 'PURCHASE_RETURN'`, and delete the payment rows.
- **Update:** the same rules as Task 12, with the copy `The amount received is more than the new return total — change it too.`

- [ ] **Step 1: Write the failing tests:**
  - `received split: bill voucher full total + 'received' voucher debiting each tender account`
  - `due 100, return 300, received 200 → due 0; payable nets to the same`
  - `nothing received, no clamp: due 100, return 300 → due −200`
  - `no supplier and partial → 400`
  - `omitted payments = today's posting and clamp`
  - `update and remove unwind, including a legacy return`
- [ ] **Step 2:** Run `cd apps/backend && npx jest src/purchase-returns --maxWorkers=2 --workerIdleMemoryLimit=600MB`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Re-run. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(purchase-returns): record money received back by tender; edits and deletes unwind the books`.

---

### Task 14: Drawer and daily report count only cash refunds

**Files:**
- Create: `apps/backend/src/sales-returns/return-cash.util.ts` (+ `.spec.ts`)
- Modify: `apps/backend/src/cashier-sessions/cashier-sessions.service.ts:358-399`, `apps/backend/src/daily-report/daily-report.service.ts:150-160,336-351`
- Test: `cashier-sessions.service.spec.ts`, `daily-report.service.spec.ts`

**Interfaces:**
- Produces: `returnCashOut(ret: { total_refund: unknown; tenders_recorded: boolean; payments: { payment_method: string; amount: unknown }[] }): number`. It returns `tenders_recorded ? sum of payments where classifyPaymentMode(payment_method) === 'cash' : Number(total_refund)`.

Both queries select `tenders_recorded` and `payments: { select: { payment_method: true, amount: true } }`. Update the comment at `cashier-sessions.service.ts:397`.

- [ ] **Step 1: Write the failing tests:**
  - `legacy return counts its total`
  - `new return with Cash 500 + bKash 200 counts 500`
  - `new return fully adjusted against due counts 0` (Review Focus 3)
  - session and daily-report tests: the expected cash moves by the cash refund only
- [ ] **Step 2:** Run `cd apps/backend && npx jest src/sales-returns/return-cash.util.spec.ts src/cashier-sessions src/daily-report --maxWorkers=2 --workerIdleMemoryLimit=600MB`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Re-run. Expected: PASS.
- [ ] **Step 5:** Commit: `fix(till): only cash refunds come out of the drawer`.

---

### Task 15: Method names on invoices and breakdowns

**Files:**
- Modify: `apps/backend/src/sales-reports/sales-reports.service.ts:1759-1789` (sales by payment method), `apps/backend/src/cashier-sessions/cashier-sessions.service.ts:384-393` (`byMethod`), `apps/backend/src/sales/sales.service.ts` (`getInvoiceData` 2396), `apps/backend/src/purchases/purchases.service.ts` (`getInvoiceData` 1210)
- Test: `sales-reports.service.spec.ts`, `cashier-sessions.service.spec.ts`, `sales.service.spec.ts`, `purchases.service.spec.ts`

**Interfaces:**
- Produces: `paymentDisplayName(row: { payment_method: string; payment_method_name?: string | null }): string` in `apps/backend/src/accounting/payment-account.util.ts`. It returns `payment_method_name ?? payment_method`.

Group and label by `paymentDisplayName`. Rows without a name keep today's string, so legacy `Mobile Wallet` rows stay their own bucket (spec: the backfill does not guess). Invoice payment lines print the display name.

- [ ] **Step 1: Write the failing tests:**
  - `sales by payment method separates bKash and Nagad saved with names`
  - `a legacy Mobile Wallet row stays its own bucket`
  - `session breakdown keys by display name`
  - `invoice data prints bKash, not Mobile Wallet`
- [ ] **Step 2:** Run `cd apps/backend && npx jest src/sales-reports src/cashier-sessions src/sales src/purchases --maxWorkers=2 --workerIdleMemoryLimit=600MB`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Re-run. Expected: PASS.
- [ ] **Step 5:** Commit: `fix(reports): payments show the method they were taken on`.

---

### Task 16: Return screens

**Files:**
- Create: `apps/frontend/src/lib/return-refund-prefill.ts` (+ `.test.ts`)
- Modify: `apps/frontend/src/app/(app)/sales/returns/new/page.tsx` (panel ~340, submit 209-240), `sales/returns/[id]/page.tsx` (edit ~114), `purchases/returns/CreatePurchaseReturnModal.tsx` (summary ~490, submit 240-249), `purchases/returns/[id]/page.tsx` (edit ~133), the nine `purchases.ts` locale files (`purchaseReturns.refund`)
- Test: `sales/returns/page.test.tsx` and `sales/returns/[id]/page.test.tsx`, `purchases/returns/page.test.tsx` and `purchases/returns/[id]/page.test.tsx`

**Interfaces:**
- Consumes: Task 10 strip (`context: 'sale_return' | 'purchase_return'`), Tasks 12–13 payloads and `payments` on GET.
- Produces:
  ```ts
  export function refundPrefill(input: {
      context: 'sale_return' | 'purchase_return';
      total: number;
      originalTenders: Payment[];        // the original document's payments, first one used
      partyDue: number | null;           // customer's or supplier's current due; null = no party
      firstVisible: { id: string; name: string; type: string } | null;
  }): Payment[];
  ```
  - **sale_return:** with a due, the refund is `total − min(total, due)` in the original document's first tender, else in `firstVisible`. With no due, the whole total goes in that tender. With no party, the whole total goes in `firstVisible`.
  - **purchase_return:** `[]` when there's a party; otherwise the whole total in `firstVisible`.

Strip labels: sales return `keepingDue: 'Adjusted against due {amount}'`. The purchase return modal uses `t.purchaseReturns.refund.keepingDue` = `Adjusted against payable {amount}` (translated). `blockedReason` is set when there's no party and the strip is not settled. The `[id]` pages render the strip read-only in view mode and editable in edit mode, prefilled from the stored `payments`. Edits send `payments`.

- [ ] **Step 1: Write the failing tests.**
  - `refundPrefill`: one test per branch above.
  - Pages:
    - `sales return opens with the refund prefilled and submits payments with paymentMethodId`
    - `sales return chip reads "Adjusted against due ৳…" for a partial refund`
    - `purchase return modal submits payments and shows the payable chip`
    - `return detail lists recorded payments; edit sends payments`
- [ ] **Step 2:** Run `cd apps/frontend && npx jest src/lib/return-refund-prefill.test.ts` and `npx jest --runTestsByPath "src/app/(app)/sales/returns/page.test.tsx" "src/app/(app)/sales/returns/[id]/page.test.tsx" "src/app/(app)/purchases/returns/page.test.tsx" "src/app/(app)/purchases/returns/[id]/page.test.tsx"`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Re-run and check the suite count. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(returns): pick refund tenders on sales and purchase returns`.

---

### Task 17: Release readiness

**Files:**
- Modify: `TODO.md`, `docs/dynamic-payment-methods-plan.md` (status line only)

- [ ] **Step 1:** Run `cd apps/frontend && npx next lint --quiet`. Expected: no output.
- [ ] **Step 2:** Run `npx tsc --noEmit -p apps/backend && npx tsc --noEmit -p apps/frontend`. Expected: no errors.
- [ ] **Step 3:** Run the backend dirs touched, one command: `cd apps/backend && npx jest src/payment-methods src/accounting src/sales src/purchases src/sales-returns src/purchase-returns src/customers src/suppliers src/cashier-sessions src/daily-report src/sales-reports src/auth src/admin-tenants src/common --maxWorkers=2 --workerIdleMemoryLimit=600MB`. Expected: all pass. Then, separately, the frontend paths from Tasks 4, 8, 10, 11 and 16. Expected: all pass.
- [ ] **Step 4:** Update `TODO.md`:
  - Move to COMPLETED, dated 2026-10-19: "Editing a sale silently drops payments…", "A bank-paid purchase credits Cash in Hand", and the split-tender item ("One counter payment, one cash account…").
  - Add an item: "Post-deploy: check `sync:payment-method-accounts` output in the deploy log for KH Tradind, Press Club, Babu Bazar".
  - Set the status line of `docs/dynamic-payment-methods-plan.md` to "Superseded in part by `docs/superpowers/specs/2026-10-19-payment-method-layout-and-tender-posting-design.md`".
- [ ] **Step 5:** Commit: `docs(todo): branch payment methods and tender posting`.
