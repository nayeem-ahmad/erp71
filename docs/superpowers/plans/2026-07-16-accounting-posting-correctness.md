# Accounting Posting Correctness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the accounting engine posting fabricated vouchers and silently skipping real ones, by deriving the default posting rules from what callers actually emit — then repair the bad data already written to real tenants.

**Architecture:** `bootstrap-accounting.ts` becomes the single, declarative source of truth for the default chart of accounts and posting rules. A contract test enumerates every `(eventType, conditionKey, conditionValue)` tuple the services can emit and asserts each one either resolves to a rule or is on an explicit skip list — and, in reverse, that no rule is unreachable. Existing tenants are migrated by a repair script, because the bootstrap only ever runs at tenant creation.

**Tech Stack:** NestJS 11, Prisma 5.22, PostgreSQL, Jest + ts-jest, TypeScript.

Spec: `docs/superpowers/specs/2026-07-16-accounting-posting-correctness-design.md`

## Global Constraints

- **Branch: `dev`.** `.githooks/` blocks commits on `main`. Never commit to `main`.
- **`packages/database` has NO build step.** `bootstrap-accounting.js` is a hand-maintained mirror of `bootstrap-accounting.ts`. TypeScript resolves imports against `index.ts`, Node against `index.js`. **Every change to a `.ts` file in `packages/database` MUST be mirrored into its `.js` twin in the same commit.** This has shipped broken three times (`9374ffc`, `6372327`, `seedBusinessTypeTemplate`). Files with `.js` mirrors: `accounting.constants`, `bootstrap-accounting`, `payment-method.seed`, `seed-demo`, `tenant-role.seed`. Standalone scripts (e.g. `backfill-voucher-store-id.ts`) have no mirror and need none.
- **Run backend tests from `apps/backend`:** `npx jest <path>`.
- **Inventory model is periodic.** Warehouse transfers, shrinkage and stock takes post **nothing**. This is intentional — do not "fix" it by adding rules.
- **Money is `Decimal(12,2)`.** Never use floats for amounts.
- **`autoPostFromRules` writes exactly two `VoucherDetail` rows.** It cannot express a multi-leg entry. Do not attempt COGS legs.
- `PostingRuleEventType` values: `sale`, `sale_return`, `purchase`, `purchase_return`, `inventory_adjustment`, `fund_movement`, `expense`, `loan_disbursement`, `loan_repayment`, `customer_payment`.
- `PostingRuleConditionKey` values: `payment_mode`, `reason_type`, `transfer_scope`, `loan_direction`, `payment_direction`, `none`.
- **After finishing, update `TODO.md`** per `CLAUDE.md`: tick items and move them to `## COMPLETED` with today's date.

---

## File Structure

| File | Responsibility |
|---|---|
| `packages/database/prisma/bootstrap-accounting.ts` (+ `.js`) | **Single source of truth.** Declarative `DEFAULT_ACCOUNTING_TEMPLATE` + new exported `DEFAULT_POSTING_RULES`; resolves account names → ids. |
| `apps/backend/src/accounting/posting-contract.ts` | **New.** Registry of every posting tuple callers emit + the documented skip list. |
| `apps/backend/src/accounting/posting-contract.spec.ts` | **New.** The contract test, both directions. |
| `packages/database/prisma/seed.ts` | Stops defining accounting; deletes its "Additional Accounts"/"Additional Posting Rules" blocks. |
| `apps/backend/src/accounting/posting.utils.ts` | Fiscal-period lock guard. |
| `apps/backend/src/accounting/accounting.service.ts` | Fiscal-period lock guard in `createVoucher`. |
| `apps/backend/src/sales/sales.service.ts` | `classifyPaymentMode` stops collapsing wallets. |
| `apps/backend/src/sales-returns/sales-returns.service.ts` | Stops hardcoding `'cash'`. |
| `apps/backend/src/purchases/purchases.service.ts` | Stops hardcoding `'credit'`. |
| `packages/database/prisma/repair-fabricated-vouchers.utils.ts` | **New.** Pure fingerprint logic — decides what is safe to delete. No Prisma, no side effects, unit-tested. |
| `packages/database/prisma/repair-fabricated-vouchers.ts` | **New.** The script: migrates existing tenants; deletes fabricated vouchers + harmful rules. |
| `apps/backend/test/repair-fabricated-vouchers.spec.ts` | **New.** Tests the fingerprint logic. |
| `.github/workflows/deploy.yaml` | Re-enables the three skipped spec suites. |

**Task order matters.** Task 1 writes a test that FAILS and stays failing until Task 3. That is intentional — the contract test *is* the specification.

---

### Task 1: The posting contract registry and its test

Establishes the contract. The test fails at the end of this task, listing every real gap. Tasks 2–3 make it pass.

**Files:**
- Create: `apps/backend/src/accounting/posting-contract.ts`
- Create: `apps/backend/src/accounting/posting-contract.spec.ts`
- Modify: `packages/database/prisma/bootstrap-accounting.ts` (extract rules to an exported const)
- Modify: `packages/database/prisma/bootstrap-accounting.js` (mirror)

**Interfaces:**
- Produces: `POSTING_CONTRACT: PostingContractEntry[]`, `PostingContractEntry { eventType, conditionKey, conditionValue, emittedBy, expectation: 'rule' | 'skip', skipReason? }` — consumed by Task 3's test run.
- Produces: `DEFAULT_POSTING_RULES: DefaultPostingRuleDefinition[]` from `bootstrap-accounting.ts`, where `DefaultPostingRuleDefinition { event_type, condition_key, condition_value, debit_account, credit_account, priority }` and `debit_account`/`credit_account` are **account names**, not ids. Consumed by Tasks 2, 3, 9.

- [ ] **Step 1: Extract the rules in `bootstrap-accounting.ts` into an exported declarative const**

Replace the inline `defaultRules` array inside `bootstrapDefaultAccountingForTenant` (currently `packages/database/prisma/bootstrap-accounting.ts:243-355`) with a module-level export. Add above `bootstrapDefaultAccountingForTenant`:

```ts
export interface DefaultPostingRuleDefinition {
    event_type: PostingRuleEventType;
    condition_key: PostingRuleConditionKey;
    condition_value: string | null;
    /** Account NAME — resolved to an id at bootstrap time. */
    debit_account: string;
    credit_account: string;
    priority: number;
}

/**
 * The default posting rules provisioned for every tenant.
 *
 * These are derived from the (eventType, conditionKey, conditionValue) tuples the
 * services actually emit — see apps/backend/src/accounting/posting-contract.ts and
 * its spec, which fail if this list and the callers drift apart.
 *
 * Deliberately absent: fund_movement and inventory_adjustment. Under the periodic
 * inventory model this system uses, warehouse transfers and stock write-offs are not
 * economic events (stock is expensed at purchase), so they must post NOTHING. A
 * condition_key:'none' rule here would be WORSE than no rule, because
 * autoPostFromRules falls back to it — that is what fabricated the Dr Bank / Cr Cash
 * vouchers this work removes.
 */
export const DEFAULT_POSTING_RULES: DefaultPostingRuleDefinition[] = [
    { event_type: 'sale', condition_key: 'payment_mode', condition_value: 'cash', debit_account: 'Cash in Hand', credit_account: 'Sales Revenue', priority: 10 },
    { event_type: 'sale', condition_key: 'payment_mode', condition_value: 'bank', debit_account: 'Main Bank Account', credit_account: 'Sales Revenue', priority: 20 },
    { event_type: 'sale_return', condition_key: 'payment_mode', condition_value: 'cash', debit_account: 'Sales Revenue', credit_account: 'Cash in Hand', priority: 10 },
    { event_type: 'sale_return', condition_key: 'payment_mode', condition_value: 'bank', debit_account: 'Sales Revenue', credit_account: 'Main Bank Account', priority: 20 },
    { event_type: 'purchase', condition_key: 'payment_mode', condition_value: 'cash', debit_account: 'General Operating Expense', credit_account: 'Cash in Hand', priority: 10 },
    { event_type: 'purchase', condition_key: 'payment_mode', condition_value: 'bank', debit_account: 'General Operating Expense', credit_account: 'Main Bank Account', priority: 20 },
    { event_type: 'purchase', condition_key: 'payment_mode', condition_value: 'credit', debit_account: 'General Operating Expense', credit_account: 'Purchase Payable', priority: 30 },
    { event_type: 'purchase_return', condition_key: 'none', condition_value: null, debit_account: 'Purchase Payable', credit_account: 'General Operating Expense', priority: 100 },
    { event_type: 'inventory_adjustment', condition_key: 'none', condition_value: null, debit_account: 'General Operating Expense', credit_account: 'Cash in Hand', priority: 100 },
    { event_type: 'fund_movement', condition_key: 'none', condition_value: null, debit_account: 'Main Bank Account', credit_account: 'Cash in Hand', priority: 100 },
    { event_type: 'expense', condition_key: 'payment_mode', condition_value: 'cash', debit_account: 'General Operating Expense', credit_account: 'Cash in Hand', priority: 10 },
    { event_type: 'expense', condition_key: 'payment_mode', condition_value: 'bank', debit_account: 'General Operating Expense', credit_account: 'Main Bank Account', priority: 20 },
    { event_type: 'expense', condition_key: 'none', condition_value: null, debit_account: 'General Operating Expense', credit_account: 'Cash in Hand', priority: 100 },
];
```

This step is a **pure refactor** — the list above is exactly today's behaviour, restated by name. Task 3 changes it.

Now rewrite the rule-application block inside `bootstrapDefaultAccountingForTenant`. Delete the old local `defaultRules` array (lines 243-355) and the five `const cashId = ...` lookups above it, and replace the whole region between `const accountByName = ...` and `await ensureLoanPostingSetup(...)` with:

```ts
    for (const rule of DEFAULT_POSTING_RULES) {
        const debitAccountId = accountByName.get(rule.debit_account);
        const creditAccountId = accountByName.get(rule.credit_account);

        if (!debitAccountId || !creditAccountId) {
            continue;
        }

        const existingRule = await db.postingRule.findFirst({
            where: {
                tenant_id: tenantId,
                event_type: rule.event_type,
                condition_key: rule.condition_key,
                condition_value: rule.condition_value,
            },
            select: { id: true },
        });

        if (existingRule) {
            await db.postingRule.update({
                where: { id: existingRule.id },
                data: {
                    debit_account_id: debitAccountId,
                    credit_account_id: creditAccountId,
                    priority: rule.priority,
                    is_active: true,
                },
            });
            continue;
        }

        await db.postingRule.create({
            data: {
                tenant_id: tenantId,
                event_type: rule.event_type,
                condition_key: rule.condition_key,
                condition_value: rule.condition_value,
                debit_account_id: debitAccountId,
                credit_account_id: creditAccountId,
                priority: rule.priority,
                is_active: true,
            },
        });
    }
```

- [ ] **Step 2: Mirror the change into `bootstrap-accounting.js`**

`packages/database/prisma/bootstrap-accounting.js` is hand-maintained. Port the same `DEFAULT_POSTING_RULES` const and loop, in that file's existing CommonJS style, and add `DEFAULT_POSTING_RULES` to its `module.exports`. Read the file first and match its conventions exactly.

- [ ] **Step 3: Verify the refactor changed no behaviour**

Run: `cd apps/backend && npx jest src/accounting/bootstrap-accounting.spec.ts`
Expected: PASS (2 tests). This suite is currently skipped in CI — Task 10 re-enables it. It must pass now.

- [ ] **Step 4: Commit the refactor**

```bash
git add packages/database/prisma/bootstrap-accounting.ts packages/database/prisma/bootstrap-accounting.js
git commit -m "refactor(accounting): extract DEFAULT_POSTING_RULES as a declarative export

Pure refactor - same rules, resolved by account name instead of
inline ids. Makes the default rule set testable against what the
calling services actually emit."
```

- [ ] **Step 5: Create the posting contract registry**

Create `apps/backend/src/accounting/posting-contract.ts`:

```ts
import type { PostingEventType } from './posting.utils';

export type PostingConditionKey =
    | 'payment_mode'
    | 'reason_type'
    | 'transfer_scope'
    | 'loan_direction'
    | 'payment_direction'
    | 'none';

export interface PostingContractEntry {
    eventType: PostingEventType;
    conditionKey: PostingConditionKey;
    conditionValue: string | null;
    /** Where this tuple is emitted — file:line, for whoever this test fails on. */
    emittedBy: string;
    /** 'rule' = a default rule must exist. 'skip' = posting nothing is correct. */
    expectation: 'rule' | 'skip';
    skipReason?: string;
}

/**
 * Every (eventType, conditionKey, conditionValue) tuple the services can emit.
 *
 * autoPostFromRules resolves a rule by exact match, then falls back to a
 * condition_key:'none' rule, and silently skips if neither exists. Both failure
 * modes are invisible at runtime: a missing rule posts nothing, and a wrong
 * fallback posts fiction. This registry plus posting-contract.spec.ts is the only
 * thing that makes either one fail loudly.
 *
 * WHEN YOU ADD OR CHANGE AN autoPostFromRules CALL, ADD ITS TUPLE HERE.
 */
export const POSTING_CONTRACT: PostingContractEntry[] = [
    // ── sales ────────────────────────────────────────────────────────────────
    { eventType: 'sale', conditionKey: 'payment_mode', conditionValue: 'cash', emittedBy: 'sales.service.ts:325', expectation: 'rule' },
    { eventType: 'sale', conditionKey: 'payment_mode', conditionValue: 'bank', emittedBy: 'sales.service.ts:325', expectation: 'rule' },
    { eventType: 'sale', conditionKey: 'payment_mode', conditionValue: 'bkash', emittedBy: 'sales.service.ts:325', expectation: 'rule' },
    { eventType: 'sale', conditionKey: 'payment_mode', conditionValue: 'nagad', emittedBy: 'sales.service.ts:325', expectation: 'rule' },
    { eventType: 'sale', conditionKey: 'payment_mode', conditionValue: 'credit', emittedBy: 'sales.service.ts:289', expectation: 'rule' },

    // ── sales returns ────────────────────────────────────────────────────────
    { eventType: 'sale_return', conditionKey: 'payment_mode', conditionValue: 'cash', emittedBy: 'sales-returns.service.ts:94', expectation: 'rule' },
    { eventType: 'sale_return', conditionKey: 'payment_mode', conditionValue: 'bank', emittedBy: 'sales-returns.service.ts:94', expectation: 'rule' },
    { eventType: 'sale_return', conditionKey: 'payment_mode', conditionValue: 'bkash', emittedBy: 'sales-returns.service.ts:94', expectation: 'rule' },
    { eventType: 'sale_return', conditionKey: 'payment_mode', conditionValue: 'nagad', emittedBy: 'sales-returns.service.ts:94', expectation: 'rule' },
    { eventType: 'sale_return', conditionKey: 'payment_mode', conditionValue: 'credit', emittedBy: 'sales-returns.service.ts:94', expectation: 'rule' },

    // ── purchases ────────────────────────────────────────────────────────────
    // Only 'credit' — and that is accurate, not a shortcut. CreatePurchaseDto has no
    // paidAmount field, purchases.service never writes Purchase.paid_amount (schema
    // default 0), and it books the full total as supplier credit. A purchase is
    // ALWAYS a payable in this data model. Recording a cash buy is a two-step flow:
    // purchase, then supplier payment. purchase/cash and purchase/bank rules would be
    // unreachable, so they do not exist. See TODO.md follow-ups.
    { eventType: 'purchase', conditionKey: 'payment_mode', conditionValue: 'credit', emittedBy: 'purchases.service.ts:140', expectation: 'rule' },
    { eventType: 'purchase', conditionKey: 'payment_mode', conditionValue: 'credit', emittedBy: 'purchase-orders.service.ts:137', expectation: 'rule' },

    // ── purchase returns ─────────────────────────────────────────────────────
    { eventType: 'purchase_return', conditionKey: 'none', conditionValue: null, emittedBy: 'purchase-returns.service.ts:83', expectation: 'rule' },

    // ── expenses ─────────────────────────────────────────────────────────────
    { eventType: 'expense', conditionKey: 'payment_mode', conditionValue: 'cash', emittedBy: 'expenses.service.ts:136', expectation: 'rule' },
    { eventType: 'expense', conditionKey: 'payment_mode', conditionValue: 'bank', emittedBy: 'expenses.service.ts:136', expectation: 'rule' },

    // ── customer payments ────────────────────────────────────────────────────
    // Rules are created lazily by ensureCustomerPaymentPostingSetup, which needs an
    // 'Accounts Receivable' account to exist. Asserted separately in the spec.
    { eventType: 'customer_payment', conditionKey: 'payment_direction', conditionValue: 'receive', emittedBy: 'customers.service.ts:566', expectation: 'skip', skipReason: 'Provisioned lazily by ensureCustomerPaymentPostingSetup, not by DEFAULT_POSTING_RULES. Covered by its own test.' },
    { eventType: 'customer_payment', conditionKey: 'payment_direction', conditionValue: 'pay', emittedBy: 'customers.service.ts:669', expectation: 'skip', skipReason: 'Provisioned lazily by ensureCustomerPaymentPostingSetup, not by DEFAULT_POSTING_RULES. Covered by its own test.' },

    // ── loans ────────────────────────────────────────────────────────────────
    { eventType: 'loan_disbursement', conditionKey: 'loan_direction', conditionValue: 'PAYABLE', emittedBy: 'loans.service.ts:83', expectation: 'skip', skipReason: 'Provisioned lazily by ensureLoanPostingSetup, not by DEFAULT_POSTING_RULES.' },
    { eventType: 'loan_disbursement', conditionKey: 'loan_direction', conditionValue: 'RECEIVABLE', emittedBy: 'loans.service.ts:83', expectation: 'skip', skipReason: 'Provisioned lazily by ensureLoanPostingSetup, not by DEFAULT_POSTING_RULES.' },
    { eventType: 'loan_repayment', conditionKey: 'loan_direction', conditionValue: 'PAYABLE', emittedBy: 'loans.service.ts:175', expectation: 'skip', skipReason: 'Provisioned lazily by ensureLoanPostingSetup, not by DEFAULT_POSTING_RULES.' },
    { eventType: 'loan_repayment', conditionKey: 'loan_direction', conditionValue: 'RECEIVABLE', emittedBy: 'loans.service.ts:175', expectation: 'skip', skipReason: 'Provisioned lazily by ensureLoanPostingSetup, not by DEFAULT_POSTING_RULES.' },

    // ── PERIODIC INVENTORY: these MUST post nothing ──────────────────────────
    { eventType: 'fund_movement', conditionKey: 'transfer_scope', conditionValue: 'inter_store', emittedBy: 'warehouse-transfers.service.ts:131', expectation: 'skip', skipReason: 'Periodic inventory: moving own stock between own warehouses is not an economic event. A none-fallback here fabricated Dr Bank / Cr Cash vouchers.' },
    { eventType: 'fund_movement', conditionKey: 'transfer_scope', conditionValue: 'intra_store', emittedBy: 'warehouse-transfers.service.ts:131', expectation: 'skip', skipReason: 'Periodic inventory: moving own stock between own warehouses is not an economic event. A none-fallback here fabricated Dr Bank / Cr Cash vouchers.' },
    { eventType: 'inventory_adjustment', conditionKey: 'reason_type', conditionValue: 'DISCREPANCY', emittedBy: 'stock-takes.service.ts:190', expectation: 'skip', skipReason: 'Periodic inventory: stock was expensed at purchase, so a count variance has no further journal entry.' },
    { eventType: 'inventory_adjustment', conditionKey: 'reason_type', conditionValue: '*', emittedBy: 'inventory-shrinkage.service.ts:69', expectation: 'skip', skipReason: 'Periodic inventory: written-off stock was already expensed at purchase. conditionValue is any InventoryReason.code, hence the wildcard.' },
];
```

- [ ] **Step 6: Write the contract test**

Create `apps/backend/src/accounting/posting-contract.spec.ts`:

```ts
import { DEFAULT_POSTING_RULES } from '@erp71/database';
import { POSTING_CONTRACT } from './posting-contract';

const ruleKey = (eventType: string, conditionKey: string, conditionValue: string | null) =>
    `${eventType}|${conditionKey}|${conditionValue ?? 'null'}`;

describe('posting contract — callers vs default rules', () => {
    const ruleKeys = new Set(
        DEFAULT_POSTING_RULES.map((rule) =>
            ruleKey(rule.event_type, rule.condition_key, rule.condition_value),
        ),
    );

    describe('every tuple a caller emits is accounted for', () => {
        const expectRule = POSTING_CONTRACT.filter((entry) => entry.expectation === 'rule');

        it.each(expectRule)(
            '$eventType/$conditionKey/$conditionValue (from $emittedBy) resolves to a default rule',
            (entry) => {
                expect(
                    ruleKeys.has(ruleKey(entry.eventType, entry.conditionKey, entry.conditionValue)),
                ).toBe(true);
            },
        );
    });

    describe('tuples that must post nothing have no rule and no none-fallback', () => {
        const expectSkip = POSTING_CONTRACT.filter((entry) => entry.expectation === 'skip');

        it.each(expectSkip)(
            '$eventType/$conditionKey/$conditionValue (from $emittedBy) has no default rule',
            (entry) => {
                expect(
                    ruleKeys.has(ruleKey(entry.eventType, entry.conditionKey, entry.conditionValue)),
                ).toBe(false);
            },
        );

        // The real hazard: autoPostFromRules falls back to condition_key:'none'.
        // A none-rule for a skip event posts fiction rather than nothing.
        it.each([...new Set(expectSkip.map((entry) => entry.eventType))])(
            '%s has no condition_key:none fallback rule',
            (eventType) => {
                expect(ruleKeys.has(ruleKey(eventType, 'none', null))).toBe(false);
            },
        );
    });

    it('has no unreachable rules', () => {
        const emitted = new Set(
            POSTING_CONTRACT.map((entry) =>
                ruleKey(entry.eventType, entry.conditionKey, entry.conditionValue),
            ),
        );

        const unreachable = DEFAULT_POSTING_RULES.filter(
            (rule) => !emitted.has(ruleKey(rule.event_type, rule.condition_key, rule.condition_value)),
        ).map((rule) => ruleKey(rule.event_type, rule.condition_key, rule.condition_value));

        expect(unreachable).toEqual([]);
    });

    it('every rule references an account the template provisions', () => {
        // Guards against a rule naming an account that does not exist: the bootstrap
        // silently `continue`s on an unresolved name, so the rule would just never
        // be created and the event would skip.
        const provisioned = new Set(PROVISIONED_ACCOUNT_NAMES);

        for (const rule of DEFAULT_POSTING_RULES) {
            expect(provisioned).toContain(rule.debit_account);
            expect(provisioned).toContain(rule.credit_account);
        }
    });
});
```

Add this import and const at the top of the spec, next to the others:

```ts
import { DEFAULT_ACCOUNTING_TEMPLATE } from '@erp71/database';

const PROVISIONED_ACCOUNT_NAMES = DEFAULT_ACCOUNTING_TEMPLATE.flatMap((group) =>
    group.subgroups.flatMap((subgroup) => subgroup.accounts.map((account) => account.name)),
);
```

- [ ] **Step 7: Export the new symbols from the `@erp71/database` barrel**

In `packages/database/index.ts`, add to the existing `bootstrap-accounting` export line:

```ts
export { bootstrapDefaultAccountingForTenant, ensureLoanPostingSetup, ensureCustomerPaymentPostingSetup, ensureInterBranchAccounts, DEFAULT_ACCOUNTING_TEMPLATE, DEFAULT_POSTING_RULES } from './prisma/bootstrap-accounting.js';
```

Read the current line first and preserve every symbol already exported — only add `DEFAULT_ACCOUNTING_TEMPLATE` and `DEFAULT_POSTING_RULES`.

**Then mirror it into `packages/database/index.js`.** Both files. This is the exact bug class that has shipped three times.

- [ ] **Step 8: Run the contract test — it MUST fail**

Run: `cd apps/backend && npx jest src/accounting/posting-contract.spec.ts`

Expected: **FAIL**, with roughly these failures — this is the bug inventory, and each one is real:
- `sale/payment_mode/bkash`, `sale/payment_mode/nagad`, `sale/payment_mode/credit` — no rule
- `sale_return/payment_mode/{bkash,nagad,credit}` — no rule
- `fund_movement has no condition_key:none fallback rule` — **it does have one; this is the fabricated-voucher bug**
- `inventory_adjustment has no condition_key:none fallback rule` — **same**
- `has no unreachable rules` — lists `expense|none|null`, `purchase|payment_mode|cash` and `purchase|payment_mode|bank`

If a failure appears that is NOT in this list, stop and investigate before continuing.

- [ ] **Step 9: Commit the failing contract**

```bash
git add apps/backend/src/accounting/posting-contract.ts apps/backend/src/accounting/posting-contract.spec.ts packages/database/index.ts packages/database/index.js
git commit -m "test(accounting): add caller-vs-rule posting contract test

Enumerates every (eventType, conditionKey, conditionValue) tuple the
services emit and asserts each resolves to a default rule or is an
explicit, documented skip - plus the reverse, that no rule is
unreachable.

Currently RED. It documents the live bugs: credit sales and mobile
wallets have no rule and post nothing, while fund_movement and
inventory_adjustment have none-fallbacks that post fabricated Dr Bank /
Cr Cash vouchers for stock movements. Fixed in the following commits."
```

---

### Task 2: Chart of accounts — add AR, wallets, Purchases; fix code collisions

**Files:**
- Modify: `packages/database/prisma/bootstrap-accounting.ts` (`DEFAULT_ACCOUNTING_TEMPLATE`, `ensureLoanPostingSetup`)
- Modify: `packages/database/prisma/bootstrap-accounting.js` (mirror)
- Test: `apps/backend/src/accounting/bootstrap-accounting.spec.ts`

**Interfaces:**
- Consumes: `DEFAULT_ACCOUNTING_TEMPLATE` (existing export).
- Produces: accounts named `Accounts Receivable`, `bKash Account`, `Nagad Account`, `Purchases` — Task 3's rules resolve these by name; Task 9's repair relies on `Accounts Receivable` existing.

- [ ] **Step 1: Write the failing test for the new accounts**

Append to `apps/backend/src/accounting/bootstrap-accounting.spec.ts`:

```ts
describe('DEFAULT_ACCOUNTING_TEMPLATE — chart of accounts', () => {
    const allAccounts = DEFAULT_ACCOUNTING_TEMPLATE.flatMap((group) =>
        group.subgroups.flatMap((subgroup) => subgroup.accounts),
    );

    it.each([
        ['Accounts Receivable', '1030'],
        ['bKash Account', '1015'],
        ['Nagad Account', '1016'],
        ['Purchases', '5015'],
        ['Loans Receivable', '1035'],
    ])('provisions %s at code %s', (name, code) => {
        const account = allAccounts.find((a) => a.name === name);
        expect(account).toBeDefined();
        expect(account?.code).toBe(code);
    });

    it('assigns every account code exactly once', () => {
        const codes = allAccounts.map((a) => a.code).filter(Boolean);
        expect(codes).toHaveLength(new Set(codes).size);
    });

    it.each([
        'Stock on Hand',
        'Goods in Transit',
        'Cost of Goods Sold',
        'Rocket Account',
    ])('does not provision %s (unused under periodic inventory)', (name) => {
        expect(allAccounts.find((a) => a.name === name)).toBeUndefined();
    });
});
```

Add the import at the top of the file:

```ts
import { bootstrapDefaultAccountingForTenant, DEFAULT_ACCOUNTING_TEMPLATE } from '@erp71/database';
```

(Replace the existing single-symbol import on line 1.)

- [ ] **Step 2: Run it and watch it fail**

Run: `cd apps/backend && npx jest src/accounting/bootstrap-accounting.spec.ts`
Expected: FAIL — `Accounts Receivable` is undefined; `Loans Receivable` has code `1030`, not `1035`.

- [ ] **Step 3: Update `DEFAULT_ACCOUNTING_TEMPLATE`**

In `packages/database/prisma/bootstrap-accounting.ts`, make these edits to `DEFAULT_ACCOUNTING_TEMPLATE`:

In the `Cash and Bank` subgroup, after `Main Bank Account`, add:

```ts
                    {
                        name: 'bKash Account',
                        code: '1015',
                        type: AccountType.ASSET,
                        category: AccountCategory.CASH,
                    },
                    {
                        name: 'Nagad Account',
                        code: '1016',
                        type: AccountType.ASSET,
                        category: AccountCategory.CASH,
                    },
```

Immediately after the `Cash and Bank` subgroup, add a new subgroup:

```ts
            {
                name: 'Receivables',
                accounts: [
                    {
                        name: 'Accounts Receivable',
                        code: '1030',
                        type: AccountType.ASSET,
                        category: AccountCategory.GENERAL,
                    },
                ],
            },
```

In the existing `Loans Receivable` subgroup, change the account's `code` from `'1030'` to `'1035'`.

In the `Operating Expenses` group, add a new subgroup before `General Expenses`:

```ts
            {
                name: 'Cost of Sales',
                accounts: [
                    {
                        name: 'Purchases',
                        code: '5015',
                        type: AccountType.EXPENSE,
                        category: AccountCategory.GENERAL,
                    },
                ],
            },
```

> `5015`, not `5020`: tenants already seeded by `seed.ts` have a `Cost of Goods Sold` account at `5020`, and reusing it would create exactly the duplicate-code problem this task removes.

- [ ] **Step 4: Fix the same code in `ensureLoanPostingSetup`**

`ensureLoanPostingSetup` creates `Loans Receivable` independently at `packages/database/prisma/bootstrap-accounting.ts:518-530`. Change its `code: '1030'` to `code: '1035'` so the two agree.

- [ ] **Step 5: Mirror everything into `bootstrap-accounting.js`**

Port all four edits above into `packages/database/prisma/bootstrap-accounting.js`, and add `DEFAULT_ACCOUNTING_TEMPLATE` to its `module.exports` if it isn't already there.

- [ ] **Step 6: Run the tests**

Run: `cd apps/backend && npx jest src/accounting/bootstrap-accounting.spec.ts`
Expected: PASS (all suites, including the two pre-existing idempotency tests).

- [ ] **Step 7: Commit**

```bash
git add packages/database/prisma/bootstrap-accounting.ts packages/database/prisma/bootstrap-accounting.js apps/backend/src/accounting/bootstrap-accounting.spec.ts
git commit -m "feat(accounting): provision AR, wallet and Purchases accounts

Adds Accounts Receivable (1030) - without it,
ensureCustomerPaymentPostingSetup returns early and every customer
payment silently posts nothing. Adds bKash (1015) / Nagad (1016) so
wallet takings are visible separately from bank, and Purchases (5015)
so stock buys stop being lumped into General Operating Expense.

Moves Loans Receivable 1030 -> 1035, resolving a duplicate code with AR.
5015 avoids colliding with the Cost of Goods Sold account seed.ts
already puts at 5020."
```

---

### Task 3: The target rule set — make the contract test green

**Files:**
- Modify: `packages/database/prisma/bootstrap-accounting.ts` (`DEFAULT_POSTING_RULES`)
- Modify: `packages/database/prisma/bootstrap-accounting.js` (mirror)
- Test: `apps/backend/src/accounting/posting-contract.spec.ts` (from Task 1)

**Interfaces:**
- Consumes: `DEFAULT_POSTING_RULES` (Task 1), account names from Task 2.

- [ ] **Step 1: Replace `DEFAULT_POSTING_RULES` with the target set**

In `packages/database/prisma/bootstrap-accounting.ts`, replace the whole `DEFAULT_POSTING_RULES` array body with:

```ts
export const DEFAULT_POSTING_RULES: DefaultPostingRuleDefinition[] = [
    // ── Sales ────────────────────────────────────────────────────────────────
    { event_type: 'sale', condition_key: 'payment_mode', condition_value: 'cash', debit_account: 'Cash in Hand', credit_account: 'Sales Revenue', priority: 10 },
    { event_type: 'sale', condition_key: 'payment_mode', condition_value: 'bank', debit_account: 'Main Bank Account', credit_account: 'Sales Revenue', priority: 20 },
    { event_type: 'sale', condition_key: 'payment_mode', condition_value: 'bkash', debit_account: 'bKash Account', credit_account: 'Sales Revenue', priority: 30 },
    { event_type: 'sale', condition_key: 'payment_mode', condition_value: 'nagad', debit_account: 'Nagad Account', credit_account: 'Sales Revenue', priority: 40 },
    { event_type: 'sale', condition_key: 'payment_mode', condition_value: 'credit', debit_account: 'Accounts Receivable', credit_account: 'Sales Revenue', priority: 50 },

    // ── Sales returns (mirror of sales) ──────────────────────────────────────
    { event_type: 'sale_return', condition_key: 'payment_mode', condition_value: 'cash', debit_account: 'Sales Revenue', credit_account: 'Cash in Hand', priority: 10 },
    { event_type: 'sale_return', condition_key: 'payment_mode', condition_value: 'bank', debit_account: 'Sales Revenue', credit_account: 'Main Bank Account', priority: 20 },
    { event_type: 'sale_return', condition_key: 'payment_mode', condition_value: 'bkash', debit_account: 'Sales Revenue', credit_account: 'bKash Account', priority: 30 },
    { event_type: 'sale_return', condition_key: 'payment_mode', condition_value: 'nagad', debit_account: 'Sales Revenue', credit_account: 'Nagad Account', priority: 40 },
    { event_type: 'sale_return', condition_key: 'payment_mode', condition_value: 'credit', debit_account: 'Sales Revenue', credit_account: 'Accounts Receivable', priority: 50 },

    // ── Purchases (periodic: stock is expensed on receipt) ───────────────────
    // Only 'credit': a purchase is always a payable in this data model. See the
    // purchases note in posting-contract.ts. cash/bank rules would be unreachable.
    { event_type: 'purchase', condition_key: 'payment_mode', condition_value: 'credit', debit_account: 'Purchases', credit_account: 'Purchase Payable', priority: 30 },
    { event_type: 'purchase_return', condition_key: 'none', condition_value: null, debit_account: 'Purchase Payable', credit_account: 'Purchases', priority: 100 },

    // ── Expenses ─────────────────────────────────────────────────────────────
    { event_type: 'expense', condition_key: 'payment_mode', condition_value: 'cash', debit_account: 'General Operating Expense', credit_account: 'Cash in Hand', priority: 10 },
    { event_type: 'expense', condition_key: 'payment_mode', condition_value: 'bank', debit_account: 'General Operating Expense', credit_account: 'Main Bank Account', priority: 20 },

    // ── DELIBERATELY ABSENT: fund_movement, inventory_adjustment ─────────────
    // Under periodic inventory these events have no journal entry. Adding a
    // condition_key:'none' rule here is worse than adding nothing, because
    // autoPostFromRules FALLS BACK to it - which is what posted Dr Main Bank /
    // Cr Cash in Hand for every warehouse transfer. See posting-contract.spec.ts.
];
```

Three things changed beyond adding rules:

1. `purchase` and `purchase_return` now use `Purchases` instead of `General Operating Expense`.
2. `inventory_adjustment`/`none` and `fund_movement`/`none` are **gone**.
3. `expense`/`none` is **gone** — `expenses.service.ts` always emits `cash` or `bank`, so it was unreachable.

- [ ] **Step 2: Mirror into `bootstrap-accounting.js`**

Port the identical array into `packages/database/prisma/bootstrap-accounting.js`.

- [ ] **Step 3: Run the contract test — it must now be green**

Run: `cd apps/backend && npx jest src/accounting/posting-contract.spec.ts`
Expected: PASS, all tests.

- [ ] **Step 4: Run the full accounting suite**

Run: `cd apps/backend && npx jest src/accounting/`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/database/prisma/bootstrap-accounting.ts packages/database/prisma/bootstrap-accounting.js
git commit -m "fix(accounting): derive default posting rules from caller tuples

Adds the missing rules (credit sales -> AR, bKash/Nagad wallets, their
sale_return mirrors) and points purchases at the new Purchases account.

Deletes the fund_movement/none and inventory_adjustment/none fallbacks.
These were the fabricated-voucher bug: autoPostFromRules falls back to a
condition_key:'none' rule, so every warehouse transfer posted Dr Main
Bank / Cr Cash in Hand for money that never moved, and every stock
write-off credited Cash in Hand. Under the periodic inventory model this
system actually uses, those events have no journal entry - so no rule is
the correct answer, not a different rule.

Also drops the unreachable expense/none rule.

Makes posting-contract.spec.ts green."
```

---

### Task 4: `seed.ts` stops defining accounting

**Files:**
- Modify: `packages/database/prisma/seed.ts:960-1100` (delete two blocks)

**Interfaces:**
- Consumes: `bootstrapDefaultAccountingForTenant` (already called at `seed.ts:557`).

- [ ] **Step 1: Delete the "Additional Accounts" block**

In `packages/database/prisma/seed.ts`, delete the entire section that begins with the comment `// ── 9. Additional Accounts ───` (around line 960) and ends just before `// ── 9b. Additional Posting Rules (demo) ───`. It creates the wallet accounts (now in the template), plus `Accounts Receivable`, `Stock on Hand`, `Goods in Transit`, `Cost of Goods Sold`, `Rent Expense`, `Staff Salaries`, `Utilities Expense`, `Marketing Expense`.

**Keep the overhead accounts.** `Rent Expense`, `Staff Salaries`, `Utilities Expense` and `Marketing Expense` are demo-tenant expense categories with no posting rules — they are not part of the default chart. Preserve just that `if (expensesGroup) { ... }` sub-block, deleting only its `cogsSubgroup` / `Cost of Goods Sold` portion.

- [ ] **Step 2: Delete the "Additional Posting Rules" block**

Delete the whole `// ── 9b. Additional Posting Rules (demo) ───` block, including its `extraRules` array and the loop that writes them. Every live rule in it now lives in `DEFAULT_POSTING_RULES`; the rest were dead (wallet rules that `classifyPaymentMode` made unreachable, and perpetual-inventory rules for Stock on Hand / Goods in Transit).

- [ ] **Step 3: Verify the seed still runs**

Run: `cd packages/database && npx tsc --noEmit -p tsconfig.json 2>&1 | head -20`
Expected: no errors referencing `seed.ts`. If `tsconfig.json` does not exist in that package, run `npx tsc --noEmit prisma/seed.ts` from the repo root instead and ignore unrelated module-resolution noise.

Note: do not run `npm run db:seed` against the local DB — per project notes the local `erp71-db-1` database is schema-drifted and lacks `_prisma_migrations`. CI runs the seed against a clean `prisma db push` database (`.github/workflows/deploy.yaml:156`), which is the real check.

- [ ] **Step 4: Commit**

```bash
git add packages/database/prisma/seed.ts
git commit -m "refactor(db): make bootstrap-accounting the only accounting source

seed.ts called bootstrapDefaultAccountingForTenant and then bolted its
own accounts and rules on top. The two drifted, which is the root cause
of the posting bugs: the bootstrap lacked rules seed.ts had, and seed.ts
carried rules no caller could ever trigger.

Every live rule now lives in DEFAULT_POSTING_RULES. The deleted ones
were dead: wallet rules classifyPaymentMode made unreachable, and
perpetual-inventory rules (Stock on Hand, Goods in Transit) for a
system that expenses stock at purchase."
```

---

### Task 5: `classifyPaymentMode` stops collapsing wallets

**Files:**
- Modify: `apps/backend/src/sales/sales.service.ts:268-284`
- Test: `apps/backend/src/sales/classify-payment-mode.spec.ts` (create)

**Interfaces:**
- Produces: exported `classifyPaymentMode(method: string): 'cash' | 'bank' | 'bkash' | 'nagad' | 'credit'` — consumed by Task 6.

- [ ] **Step 1: Write the failing test**

Create `apps/backend/src/sales/classify-payment-mode.spec.ts`:

```ts
import { classifyPaymentMode } from './classify-payment-mode';

describe('classifyPaymentMode', () => {
    it.each([
        ['Cash', 'cash'],
        ['cash register', 'cash'],
        ['Bank', 'bank'],
        ['Card', 'bank'],
        ['bKash', 'bkash'],
        ['bKash Personal', 'bkash'],
        ['Nagad', 'nagad'],
        ['Credit', 'credit'],
    ] as const)('maps %s to %s', (method, expected) => {
        expect(classifyPaymentMode(method)).toBe(expected);
    });

    it('does not collapse bKash into bank', () => {
        // Regression: wallets used to map to 'bank', so the bKash Account never
        // received a posting and every wallet sale landed in Main Bank Account.
        expect(classifyPaymentMode('bKash')).not.toBe('bank');
    });

    it('falls back to cash for an unrecognised method', () => {
        // Known limitation: payment methods are tenant-configurable, so a method
        // named e.g. 'Upay' posts to cash. Tracked as a follow-up - the real fix is
        // wiring PaymentMethod.account_id into posting.
        expect(classifyPaymentMode('Upay')).toBe('cash');
    });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd apps/backend && npx jest src/sales/classify-payment-mode.spec.ts`
Expected: FAIL — `Cannot find module './classify-payment-mode'`.

- [ ] **Step 3: Extract and fix the classifier**

Create `apps/backend/src/sales/classify-payment-mode.ts`:

```ts
export type PaymentMode = 'cash' | 'bank' | 'bkash' | 'nagad' | 'credit';

/**
 * Maps a payment method name to the `payment_mode` condition value used by the
 * posting rules (see packages/database/prisma/bootstrap-accounting.ts).
 *
 * Wallets are NOT collapsed into 'bank' - bKash and Nagad post to their own
 * accounts, which is what a Bangladeshi retailer expects to see.
 *
 * Limitation: payment methods are tenant-configurable (PaymentMethod), so a
 * custom method whose name matches nothing here falls back to 'cash'. The real
 * fix is resolving the account from PaymentMethod.account_id rather than
 * substring-matching a user-editable name; that changes autoPostFromRules'
 * account-resolution contract and is tracked separately.
 */
export function classifyPaymentMode(method: string): PaymentMode {
    const normalized = method.toLowerCase();

    if (normalized.includes('bkash')) {
        return 'bkash';
    }
    if (normalized.includes('nagad')) {
        return 'nagad';
    }
    if (normalized.includes('credit')) {
        return 'credit';
    }
    if (
        normalized.includes('bank')
        || normalized.includes('card')
        || normalized.includes('wallet')
        || normalized.includes('transfer')
    ) {
        return 'bank';
    }
    return 'cash';
}
```

Order matters: `bkash`/`nagad` are checked before the `wallet` branch, and `credit` before `bank`.

- [ ] **Step 4: Use it in `sales.service.ts`**

In `apps/backend/src/sales/sales.service.ts`, delete the local `const classifyPaymentMode = (method: string) => { ... }` (lines 268-284) and add to the imports at the top:

```ts
import { classifyPaymentMode } from './classify-payment-mode';
```

The three existing call sites (`:305`, `:322`, `:325`) keep working unchanged.

- [ ] **Step 5: Run the tests**

Run: `cd apps/backend && npx jest src/sales/`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/backend/src/sales/classify-payment-mode.ts apps/backend/src/sales/classify-payment-mode.spec.ts apps/backend/src/sales/sales.service.ts
git commit -m "fix(sales): stop collapsing bKash/Nagad into bank

classifyPaymentMode mapped every wallet to 'bank', so no caller ever
emitted 'bkash' or 'nagad' - which is why the wallet posting rules could
never fire and every wallet sale landed in Main Bank Account.

Extracted to its own module so it can be tested directly and reused by
sales-returns."
```

---

### Task 6: `sales-returns` stops hardcoding `'cash'`

**Files:**
- Modify: `apps/backend/src/sales-returns/sales-returns.service.ts:16-19, 89-102`
- Test: `apps/backend/test/sales-returns-orders.spec.ts` (existing)

**Interfaces:**
- Consumes: `classifyPaymentMode` (Task 5).

- [ ] **Step 1: Write the failing test**

Append to `apps/backend/test/sales-returns-orders.spec.ts`. Read the file first and follow its existing mocking style; this describe block assumes the `autoPostFromRules` mock pattern used elsewhere in the suite:

```ts
describe('SalesReturnsService — posting condition value', () => {
    it('classifies a credit sale return as credit, not cash', async () => {
        // Regression: the service hardcoded conditionValue 'cash', so returning a
        // credit sale posted Dr Sales Revenue / Cr Cash in Hand - refunding cash the
        // shop never received, and leaving the receivable untouched.
        const sale = {
            id: 'sale-1',
            store_id: 'store-1',
            customer_id: 'cust-1',
            total_amount: 500,
            amount_paid: 0,
            payments: [],
            items: [
                { id: 'si-1', product_id: 'p-1', quantity: 2, price_at_sale: 250, returns: [] },
            ],
        };

        const posting = await captureAutoPostFromRules(() =>
            service.create('tenant-1', 'user-1', {
                saleId: 'sale-1',
                storeId: 'store-1',
                items: [{ saleItemId: 'si-1', quantity: 1 }],
            } as any),
        );

        expect(posting.conditionValue).toBe('credit');
    });

    it('classifies a bKash sale return as bkash', async () => {
        const posting = await captureAutoPostFromRules(() =>
            service.create('tenant-1', 'user-1', {
                saleId: 'sale-bkash',
                storeId: 'store-1',
                items: [{ saleItemId: 'si-2', quantity: 1 }],
            } as any),
        );

        expect(posting.conditionValue).toBe('bkash');
    });
});
```

If the existing suite has no `captureAutoPostFromRules` helper, add one that reads the mocked `autoPostFromRules`'s last call argument:

```ts
const captureAutoPostFromRules = async (run: () => Promise<unknown>) => {
    const mocked = jest.mocked(autoPostFromRules);
    mocked.mockClear();
    await run();
    return mocked.mock.calls.at(-1)![0];
};
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd apps/backend && npx jest test/sales-returns-orders.spec.ts`
Expected: FAIL — received `'cash'`, expected `'credit'`.

- [ ] **Step 3: Classify from the original sale**

In `apps/backend/src/sales-returns/sales-returns.service.ts`, add the import:

```ts
import { classifyPaymentMode } from '../sales/classify-payment-mode';
```

Change the sale lookup (line 16) to include its payments:

```ts
            const sale = await tx.sale.findUnique({
                where: { id: dto.saleId, tenant_id: tenantId },
                include: { items: { include: { returns: true } }, payments: true }
            });
```

Add this just before the `autoPostFromRules` call (line 89):

```ts
            // Refund the way the customer paid. An unpaid balance was a receivable,
            // so its return credits AR rather than handing back cash.
            const balanceDue = Number(sale.total_amount) - Number(sale.amount_paid);
            const returnPaymentMode = balanceDue > 0.005
                ? 'credit'
                : classifyPaymentMode(sale.payments?.[0]?.payment_method ?? 'cash');
```

And change the `autoPostFromRules` call's `conditionValue` (line 94) from `'cash'` to:

```ts
                conditionValue: returnPaymentMode,
```

- [ ] **Step 4: Run the tests**

Run: `cd apps/backend && npx jest test/sales-returns-orders.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/sales-returns/sales-returns.service.ts apps/backend/test/sales-returns-orders.spec.ts
git commit -m "fix(sales-returns): post refunds against the original payment method

The service hardcoded conditionValue 'cash'. Returning a credit sale
posted Dr Sales Revenue / Cr Cash in Hand - refunding cash the shop
never received - and the sale_return/credit rule could never fire.

Now classifies from the sale: an outstanding balance credits Accounts
Receivable, otherwise the refund follows the original payment method."
```

---

### Task 7: Document why `purchase` is always `credit`

**No code change.** This task exists to record a deliberate decision, because "the hardcoded `'credit'` is a bug" is the obvious-looking conclusion and it is **wrong**.

Read `apps/backend/src/purchases/purchases.service.ts:75-137` and confirm all three facts before writing anything:

1. `CreatePurchaseDto` (`apps/backend/src/purchases/purchase.dto.ts`) has **no `paidAmount` field**.
2. `tx.purchase.create` (`:75`) never sets `paid_amount` — it falls to the schema default of `0`.
3. The `SupplierCreditTransaction` (`:121`) always books the **full** `totalAmount` as `CREDIT_PURCHASE`.

A purchase is therefore *always* a payable. Classifying from `paid_amount` would return `'credit'` every time — identical to the hardcode, but with more code. `purchase`/`cash` and `purchase`/`bank` rules are unreachable by construction, which is why Task 3 does not define them.

Recording a cash purchase is a two-step flow — create the purchase (booking a payable), then record a supplier payment. That is coherent double-entry, and out of scope here.

- [ ] **Step 1: Add the explanatory comment**

In `apps/backend/src/purchases/purchases.service.ts`, immediately above the `autoPostFromRules` call at line 140, add:

```ts
            // Always 'credit', and that is correct rather than a shortcut: this
            // service never writes Purchase.paid_amount (CreatePurchaseDto has no
            // paidAmount field) and books the full total as supplier credit, so a
            // purchase is always a payable. Recording a cash buy is a two-step flow:
            // purchase, then supplier payment. There are deliberately no
            // purchase/cash or purchase/bank rules — they would be unreachable.
```

- [ ] **Step 2: Verify nothing broke**

Run: `cd apps/backend && npx jest src/purchases/ --passWithNoTests`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/backend/src/purchases/purchases.service.ts
git commit -m "docs(purchases): explain why the posting mode is always credit

The hardcoded 'credit' looks like a bug and isn't. paid_amount is never
written (the DTO has no field for it) and the full total is booked as
supplier credit, so a purchase is always a payable and purchase/cash and
purchase/bank rules would be unreachable.

Recording paid purchases properly is tracked as a follow-up."
```

---

### Task 8: Enforce fiscal period locks

**Files:**
- Modify: `apps/backend/src/accounting/posting.utils.ts`
- Modify: `apps/backend/src/accounting/accounting.service.ts:691-730`
- Test: `apps/backend/src/accounting/fiscal-period-lock.spec.ts` (create)

**Interfaces:**
- Produces: `assertFiscalPeriodOpen(tx: Prisma.TransactionClient, tenantId: string, date: Date): Promise<void>` — throws `BadRequestException('FISCAL_PERIOD_LOCKED')`.

- [ ] **Step 1: Write the failing test**

Create `apps/backend/src/accounting/fiscal-period-lock.spec.ts`:

```ts
import { BadRequestException } from '@nestjs/common';
import { assertFiscalPeriodOpen } from './posting.utils';

describe('assertFiscalPeriodOpen', () => {
    const buildTx = (period: unknown) => ({
        fiscalPeriod: { findFirst: jest.fn().mockResolvedValue(period) },
    }) as any;

    it('throws when the date falls in a locked period', async () => {
        const tx = buildTx({ id: 'fp-1', is_locked: true, period_label: 'Jan 2026' });
        await expect(assertFiscalPeriodOpen(tx, 'tenant-1', new Date('2026-01-15')))
            .rejects.toThrow(BadRequestException);
    });

    it('allows an open period', async () => {
        const tx = buildTx({ id: 'fp-1', is_locked: false, period_label: 'Jan 2026' });
        await expect(assertFiscalPeriodOpen(tx, 'tenant-1', new Date('2026-01-15')))
            .resolves.toBeUndefined();
    });

    it('allows a date with no fiscal period at all', async () => {
        // Most tenants never create fiscal periods. Absence must not block posting.
        const tx = buildTx(null);
        await expect(assertFiscalPeriodOpen(tx, 'tenant-1', new Date('2026-01-15')))
            .resolves.toBeUndefined();
    });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd apps/backend && npx jest src/accounting/fiscal-period-lock.spec.ts`
Expected: FAIL — `assertFiscalPeriodOpen is not a function`.

- [ ] **Step 3: Implement the guard**

Add to `apps/backend/src/accounting/posting.utils.ts`, above `autoPostFromRules`:

```ts
/**
 * Rejects a posting dated into a locked fiscal period.
 *
 * `is_locked` was previously written by the lock/unlock endpoints and read by
 * nothing, so locking a period did nothing at all.
 *
 * A date with no covering FiscalPeriod row is allowed - most tenants never create
 * periods, and absence must not block posting.
 */
export async function assertFiscalPeriodOpen(
    tx: Prisma.TransactionClient,
    tenantId: string,
    date: Date,
): Promise<void> {
    const period = await tx.fiscalPeriod.findFirst({
        where: {
            tenant_id: tenantId,
            start_date: { lte: date },
            end_date: { gte: date },
        },
        select: { is_locked: true, period_label: true },
    });

    if (period?.is_locked) {
        throw new BadRequestException(
            `FISCAL_PERIOD_LOCKED: ${period.period_label} is locked and cannot accept new postings.`,
        );
    }
}
```

- [ ] **Step 4: Call it from `autoPostFromRules`**

In `autoPostFromRules`, immediately after the `const conditionKey = ...` / `conditionValue` / `idempotencyKey` declarations and **before** the `existingEvent` lookup, add:

```ts
    await assertFiscalPeriodOpen(input.tx, input.tenantId, input.date ?? new Date());
```

- [ ] **Step 5: Call it from `AccountingService.createVoucher`**

In `apps/backend/src/accounting/accounting.service.ts`, inside `createVoucher`'s transaction and before the voucher `create`, add:

```ts
            await assertFiscalPeriodOpen(tx, tenantId, dto.date ? new Date(dto.date) : new Date());
```

Add `assertFiscalPeriodOpen` to the existing import from `./posting.utils`.

- [ ] **Step 6: Run the accounting suite**

Run: `cd apps/backend && npx jest src/accounting/`
Expected: PASS. If `accounting.service.spec.ts` fails because its `db` mock has no `fiscalPeriod`, add `fiscalPeriod: { findFirst: jest.fn().mockResolvedValue(null) }` to that mock.

- [ ] **Step 7: Commit**

```bash
git add apps/backend/src/accounting/posting.utils.ts apps/backend/src/accounting/accounting.service.ts apps/backend/src/accounting/fiscal-period-lock.spec.ts
git commit -m "feat(accounting): enforce fiscal period locks on posting

is_locked was written by the lock/unlock endpoints and read by nothing,
so locking a period was decorative. Both posting paths now reject a
voucher dated into a locked period.

Absence of a FiscalPeriod row still allows posting - most tenants never
create periods."
```

---

### Task 9: The repair script

Migrates existing tenants and removes the fabricated vouchers. This is the only thing that fixes tenants already created — `bootstrapDefaultAccountingForTenant` runs **only** at tenant creation (`auth.service.ts:591`, `admin-tenants.service.ts:761`) and never re-runs.

**Files:**
- Create: `packages/database/prisma/repair-fabricated-vouchers.utils.ts` (pure, testable)
- Create: `packages/database/prisma/repair-fabricated-vouchers.ts` (the script)
- Create: `apps/backend/test/repair-fabricated-vouchers.spec.ts`
- Modify: `packages/database/package.json` (add script)

**Interfaces:**
- Consumes: `bootstrapDefaultAccountingForTenant` (Tasks 1-3).
- Produces: `isFabricatedVoucher(voucher: FabricationCandidate, accountNameById: Map<string, string>): boolean`, `FABRICATED_SOURCE_TYPES`, `FALLBACK_FINGERPRINTS`.

> This is a standalone script, like `backfill-voucher-store-id.ts`. It needs **no `.js` mirror** — mirrors exist only for modules re-exported through `index.js`.

> It writes via raw Prisma, below the Task 8 lock guard, so locked periods do not block it. That is deliberate.

**The fingerprint logic lives in its own module with no side effects.** The script calls `main()` at module scope, so importing it from a test would execute it against a live database. The decision of what to delete from real books must be unit-testable in isolation.

- [ ] **Step 1: Write the pure fingerprint module**

Create `packages/database/prisma/repair-fabricated-vouchers.utils.ts`:

```ts
/**
 * Decides whether a voucher was fabricated by the condition_key:'none' posting
 * fallback, as opposed to being something the tenant deliberately configured.
 *
 * Kept free of Prisma and side effects so it can be tested in isolation: this
 * function decides what gets deleted from real financial records.
 */

/** source_type -> the event type autoPostFromRules used, for the posting event key. */
export const FABRICATED_SOURCE_TYPES: Record<string, 'fund_movement' | 'inventory_adjustment'> = {
    transfer: 'fund_movement',
    shrinkage: 'inventory_adjustment',
    stock_take_adjustment: 'inventory_adjustment',
};

/** The exact account pair each harmful fallback rule produced. */
export const FALLBACK_FINGERPRINTS: Record<string, { debit: string; credit: string }> = {
    fund_movement: { debit: 'Main Bank Account', credit: 'Cash in Hand' },
    inventory_adjustment: { debit: 'General Operating Expense', credit: 'Cash in Hand' },
};

export interface FabricationCandidate {
    source_type: string | null;
    details: Array<{
        account_id: string;
        debit_amount: unknown;
        credit_amount: unknown;
    }>;
}

/**
 * True only when the voucher's source_type matches a fallback-prone event AND its
 * two lines are exactly that fallback's account pair.
 *
 * PostingRule is tenant-configurable: a tenant may have deliberately configured
 * correct transfer postings. Matching on source_type alone would destroy them.
 */
export function isFabricatedVoucher(
    voucher: FabricationCandidate,
    accountNameById: Map<string, string>,
): boolean {
    if (!voucher.source_type) {
        return false;
    }

    const eventType = FABRICATED_SOURCE_TYPES[voucher.source_type];
    if (!eventType) {
        return false;
    }

    const fingerprint = FALLBACK_FINGERPRINTS[eventType];
    if (voucher.details.length !== 2) {
        return false;
    }

    const debitLine = voucher.details.find((line) => Number(line.debit_amount) > 0);
    const creditLine = voucher.details.find((line) => Number(line.credit_amount) > 0);

    if (!debitLine || !creditLine) {
        return false;
    }

    return (
        accountNameById.get(debitLine.account_id) === fingerprint.debit &&
        accountNameById.get(creditLine.account_id) === fingerprint.credit
    );
}
```

- [ ] **Step 2: Write the fingerprint tests**

Create `apps/backend/test/repair-fabricated-vouchers.spec.ts`:

```ts
import {
    isFabricatedVoucher,
    FabricationCandidate,
} from '../../../packages/database/prisma/repair-fabricated-vouchers.utils';

const accountNameById = new Map<string, string>([
    ['acc-bank', 'Main Bank Account'],
    ['acc-cash', 'Cash in Hand'],
    ['acc-expense', 'General Operating Expense'],
    ['acc-transit', 'Goods in Transit'],
    ['acc-stock', 'Stock on Hand'],
]);

const voucher = (
    sourceType: string | null,
    debitAccountId: string,
    creditAccountId: string,
): FabricationCandidate => ({
    source_type: sourceType,
    details: [
        { account_id: debitAccountId, debit_amount: 500, credit_amount: 0 },
        { account_id: creditAccountId, debit_amount: 0, credit_amount: 500 },
    ],
});

describe('isFabricatedVoucher', () => {
    it('flags a transfer voucher posted by the fund_movement none-fallback', () => {
        expect(isFabricatedVoucher(voucher('transfer', 'acc-bank', 'acc-cash'), accountNameById)).toBe(true);
    });

    it.each(['shrinkage', 'stock_take_adjustment'])(
        'flags a %s voucher posted by the inventory_adjustment none-fallback',
        (sourceType) => {
            expect(isFabricatedVoucher(voucher(sourceType, 'acc-expense', 'acc-cash'), accountNameById)).toBe(true);
        },
    );

    it('preserves a transfer voucher a tenant configured correctly', () => {
        // Dr Goods in Transit / Cr Stock on Hand is a deliberate perpetual-inventory
        // configuration, not the fallback. Deleting it would destroy real work.
        expect(isFabricatedVoucher(voucher('transfer', 'acc-transit', 'acc-stock'), accountNameById)).toBe(false);
    });

    it('preserves a voucher from an unrelated source type', () => {
        expect(isFabricatedVoucher(voucher('sale', 'acc-cash', 'acc-bank'), accountNameById)).toBe(false);
    });

    it('preserves a voucher with a null source type', () => {
        expect(isFabricatedVoucher(voucher(null, 'acc-bank', 'acc-cash'), accountNameById)).toBe(false);
    });

    it('preserves a voucher whose accounts only half-match the fingerprint', () => {
        expect(isFabricatedVoucher(voucher('transfer', 'acc-bank', 'acc-stock'), accountNameById)).toBe(false);
    });

    it('preserves a voucher that is not exactly two lines', () => {
        const threeLines: FabricationCandidate = {
            source_type: 'transfer',
            details: [
                { account_id: 'acc-bank', debit_amount: 500, credit_amount: 0 },
                { account_id: 'acc-cash', debit_amount: 0, credit_amount: 300 },
                { account_id: 'acc-stock', debit_amount: 0, credit_amount: 200 },
            ],
        };
        expect(isFabricatedVoucher(threeLines, accountNameById)).toBe(false);
    });
});
```

- [ ] **Step 3: Run the tests**

Run: `cd apps/backend && npx jest test/repair-fabricated-vouchers.spec.ts`
Expected: PASS.

- [ ] **Step 4: Write the script**

Create `packages/database/prisma/repair-fabricated-vouchers.ts`:

```ts
/**
 * Repairs tenants created before the posting-rule correction.
 *
 * Three jobs, per tenant:
 *   1. Re-run the accounting bootstrap, adding the accounts and rules that did not
 *      exist when the tenant was created (notably Accounts Receivable, without
 *      which every customer payment silently posted nothing).
 *   2. Delete the harmful condition_key:'none' fallback rules. The bootstrap only
 *      ever upserts, so removing them from DEFAULT_POSTING_RULES does not remove
 *      them from tenants that already have them.
 *   3. Delete the vouchers those fallbacks fabricated.
 *
 * On (3): a voucher is only deleted when its source_type matches AND its two
 * detail lines point at exactly the fallback rule's account pair. PostingRule is
 * tenant-configurable, so a tenant may have deliberately configured correct
 * transfer postings - matching on source_type alone would destroy them.
 *
 * Writes via raw Prisma, below the fiscal-period lock guard. Deliberate: locked
 * periods must not block removal of entries that should never have existed.
 *
 * Usage:
 *   npx tsx prisma/repair-fabricated-vouchers.ts --dry-run
 *   npx tsx prisma/repair-fabricated-vouchers.ts --tenant=<uuid>
 *   npx tsx prisma/repair-fabricated-vouchers.ts
 */
import { PrismaClient } from '@prisma/client';
import { bootstrapDefaultAccountingForTenant } from './bootstrap-accounting';
import {
    isFabricatedVoucher,
    FABRICATED_SOURCE_TYPES,
    FALLBACK_FINGERPRINTS,
} from './repair-fabricated-vouchers.utils';

const prisma = new PrismaClient();

type RepairStats = {
    tenantId: string;
    rulesDeleted: number;
    vouchersDeleted: number;
    vouchersPreserved: number;
};

async function repairTenant(tenantId: string, dryRun: boolean): Promise<RepairStats> {
    const stats: RepairStats = { tenantId, rulesDeleted: 0, vouchersDeleted: 0, vouchersPreserved: 0 };

    // 1. Bring the tenant's accounts and rules up to date.
    if (!dryRun) {
        await bootstrapDefaultAccountingForTenant(prisma, tenantId);
    }

    // 2. Remove the harmful none-fallbacks.
    const harmfulRules = await prisma.postingRule.findMany({
        where: {
            tenant_id: tenantId,
            event_type: { in: ['fund_movement', 'inventory_adjustment'] },
            condition_key: 'none',
        },
        select: { id: true },
    });
    stats.rulesDeleted = harmfulRules.length;
    if (!dryRun && harmfulRules.length > 0) {
        await prisma.postingRule.deleteMany({ where: { id: { in: harmfulRules.map((r) => r.id) } } });
    }

    // 3. Delete the vouchers they fabricated.
    const accounts = await prisma.account.findMany({
        where: { tenant_id: tenantId },
        select: { id: true, name: true },
    });
    const nameById = new Map(accounts.map((a) => [a.id, a.name]));

    const candidates = await prisma.voucher.findMany({
        where: { tenant_id: tenantId, source_type: { in: Object.keys(FABRICATED_SOURCE_TYPES) } },
        include: { details: { select: { account_id: true, debit_amount: true, credit_amount: true } } },
    });

    for (const voucher of candidates) {
        if (!isFabricatedVoucher(voucher, nameById)) {
            stats.vouchersPreserved++;
            continue;
        }

        const eventType = FABRICATED_SOURCE_TYPES[voucher.source_type!];
        const fingerprint = FALLBACK_FINGERPRINTS[eventType];
        const debitLine = voucher.details.find((d) => Number(d.debit_amount) > 0)!;

        stats.vouchersDeleted++;
        if (dryRun) continue;

        await prisma.$transaction(async (tx) => {
            await tx.auditLog.create({
                data: {
                    tenant_id: tenantId,
                    action: 'accounting.voucher.repair_delete',
                    entity: 'Voucher',
                    entity_id: voucher.id,
                    payload: {
                        reason: 'Fabricated by the condition_key:none posting fallback; the underlying event moved no money.',
                        voucher_number: voucher.voucher_number,
                        voucher_type: voucher.voucher_type,
                        date: voucher.date.toISOString(),
                        source_type: voucher.source_type,
                        source_id: voucher.source_id,
                        debit_account: fingerprint.debit,
                        credit_account: fingerprint.credit,
                        amount: String(debitLine.debit_amount),
                    },
                },
            });

            await tx.postingEvent.deleteMany({
                where: { tenant_id: tenantId, event_type: eventType, source_id: voucher.source_id ?? undefined },
            });
            await tx.voucherDetail.deleteMany({ where: { voucher_id: voucher.id } });
            await tx.voucher.delete({ where: { id: voucher.id } });
        });
    }

    return stats;
}

async function main() {
    const dryRun = process.argv.includes('--dry-run');
    const tenantArg = process.argv.find((arg) => arg.startsWith('--tenant='));
    const tenantId = tenantArg?.split('=')[1];

    const tenants = tenantId
        ? [{ id: tenantId }]
        : await prisma.tenant.findMany({ select: { id: true } });

    console.log(`Repair fabricated vouchers (${dryRun ? 'DRY RUN' : 'LIVE'}) — ${tenants.length} tenant(s)`);

    let totalDeleted = 0;
    let totalPreserved = 0;
    let totalRules = 0;

    for (const tenant of tenants) {
        const stats = await repairTenant(tenant.id, dryRun);
        totalDeleted += stats.vouchersDeleted;
        totalPreserved += stats.vouchersPreserved;
        totalRules += stats.rulesDeleted;

        if (stats.vouchersDeleted || stats.vouchersPreserved || stats.rulesDeleted) {
            console.log(
                `  ${stats.tenantId}: ${stats.vouchersDeleted} voucher(s) deleted, ` +
                `${stats.vouchersPreserved} preserved, ${stats.rulesDeleted} harmful rule(s) removed`,
            );
        }
    }

    console.log(`\nTotal: ${totalDeleted} deleted, ${totalPreserved} preserved, ${totalRules} rules removed`);
    if (dryRun) {
        console.log('DRY RUN — nothing was written. Re-run without --dry-run to apply.');
    }
}

main()
    .catch((error) => {
        console.error(error);
        process.exit(1);
    })
    .finally(() => prisma.$disconnect());
```

- [ ] **Step 5: Add the npm script**

In `packages/database/package.json`, add to `scripts`:

```json
    "repair:vouchers": "tsx prisma/repair-fabricated-vouchers.ts",
```

- [ ] **Step 6: Typecheck**

Run: `cd packages/database && npx tsc --noEmit prisma/repair-fabricated-vouchers.ts 2>&1 | head`
Expected: no errors in this file (module-resolution noise from other files is fine).

- [ ] **Step 7: Dry-run against a real database**

Run: `cd packages/database && npx tsx prisma/repair-fabricated-vouchers.ts --dry-run`
Expected: a per-tenant report and `DRY RUN — nothing was written`.

If the local database is unusable (per project notes it is schema-drifted and on port 5434, not the 5432 in `.env`), skip this step and state clearly in the PR that the dry run was **not** executed locally. **The dry run must be run against production before the live run** — see Step 6.

- [ ] **Step 8: Commit**

```bash
git add packages/database/prisma/repair-fabricated-vouchers.ts packages/database/prisma/repair-fabricated-vouchers.utils.ts apps/backend/test/repair-fabricated-vouchers.spec.ts packages/database/package.json
git commit -m "feat(db): add repair script for fabricated vouchers

Existing tenants cannot be fixed by the bootstrap change alone -
bootstrapDefaultAccountingForTenant only ever runs at tenant creation.
This script is their migration path: re-runs the bootstrap (adding
Accounts Receivable), deletes the harmful none-fallback rules, and
removes the vouchers they fabricated.

A voucher is deleted only when its source_type matches AND its two
detail lines are exactly the fallback rule's account pair - posting
rules are tenant-configurable, so anything a tenant deliberately
configured is preserved. Every deletion writes an AuditLog row.

--dry-run reports without writing."
```

- [ ] **Step 9: Do NOT run this against production yet**

The live run changes historical financial reports. It belongs in the deploy runbook, after the code ships and after a production dry run has been reviewed by the user. Do not run it as part of implementing this plan.

---

### Task 10: Re-enable the disabled test suites

CI currently skips exactly the three suites covering this bug area — including the bootstrap's own test and the customers spec whose mock hid the payment bug.

**Files:**
- Modify: `apps/backend/src/customers/customers.service.spec.ts:16-19`
- Modify: `.github/workflows/deploy.yaml:70-75`
- Modify: `apps/backend/jest.config.js:14-17`

- [ ] **Step 1: Fix the mock that hid the bug**

In `apps/backend/src/customers/customers.service.spec.ts`, the mock at lines 16-19 makes `autoPostFromRules` always report success:

```ts
jest.mock('../accounting/posting.utils', () => ({
  autoPostFromRules: jest.fn().mockResolvedValue({ postingStatus: 'posted', voucherId: 'v1', voucherNumber: 'CR-00001' }),
  voidAutoPostedVoucher: jest.fn().mockResolvedValue(undefined),
}));
```

Replace the default with a **skip**, so the test must opt in to success:

```ts
// Default to 'skipped', not 'posted'. A mock that always reports success is why
// nobody noticed customer payments posted nothing for want of an AR account.
jest.mock('../accounting/posting.utils', () => ({
  autoPostFromRules: jest.fn().mockResolvedValue({ postingStatus: 'skipped' }),
  voidAutoPostedVoucher: jest.fn().mockResolvedValue(undefined),
  assertFiscalPeriodOpen: jest.fn().mockResolvedValue(undefined),
}));
```

- [ ] **Step 2: Run the customers suite and fix the fallout**

Run: `cd apps/backend && npx jest src/customers/customers.service.spec.ts`
Expected: some tests fail if they assert `posting_status: 'posted'`.

For each failure, decide honestly: if the test genuinely asserts a posted voucher, set the mock explicitly in that test via `jest.mocked(autoPostFromRules).mockResolvedValueOnce({ postingStatus: 'posted', voucherId: 'v1', voucherNumber: 'CR-00001' })`. Do **not** revert the default.

- [ ] **Step 3: Add a test proving AR is what customer payments need**

Append to `apps/backend/src/customers/customers.service.spec.ts`:

```ts
describe('ensureCustomerPaymentPostingSetup — Accounts Receivable dependency', () => {
    it('is provisioned by the default template', async () => {
        // Regression: the template had no 'Accounts Receivable' account, so
        // ensureCustomerPaymentPostingSetup returned early, no customer_payment
        // rules were ever created, and every payment silently posted nothing.
        const { DEFAULT_ACCOUNTING_TEMPLATE } = jest.requireActual('@erp71/database');
        const names = DEFAULT_ACCOUNTING_TEMPLATE.flatMap((g: any) =>
            g.subgroups.flatMap((s: any) => s.accounts.map((a: any) => a.name)),
        );
        expect(names).toContain('Accounts Receivable');
    });
});
```

- [ ] **Step 4: Re-enable the suites in CI**

In `.github/workflows/deploy.yaml`, replace the test step (lines 69-75) with:

```yaml
      - name: Run backend unit + integration tests with coverage
        run: |
          npx jest --testPathPatterns="src/" --passWithNoTests --coverage --forceExit
        working-directory: apps/backend
```

- [ ] **Step 5: Clean up the stale coverage exclusions**

In `apps/backend/jest.config.js`, delete these three lines and the comment above them (lines 14-17):

```js
        // Source files whose spec suites are excluded from the CI run
        '!src/accounting/accounting.controller.ts',
        '!src/accounting/bootstrap-accounting.service.ts',
        '!src/customers/customers.service.ts',
```

`src/accounting/bootstrap-accounting.service.ts` does not exist — the exclusion was already stale.

- [ ] **Step 6: Run the full backend suite exactly as CI will**

Run: `cd apps/backend && npx jest --testPathPatterns="src/" --passWithNoTests --forceExit`
Expected: PASS.

If `accounting.controller.spec.ts` fails, fix it. It was disabled rather than repaired; if the failure is a genuine product bug, stop and report rather than deleting the assertion.

- [ ] **Step 7: Commit**

```bash
git add apps/backend/src/customers/customers.service.spec.ts .github/workflows/deploy.yaml apps/backend/jest.config.js
git commit -m "test: re-enable the three suites CI was skipping

CI ignored bootstrap-accounting.spec.ts, accounting.controller.spec.ts
and customers.service.spec.ts - precisely the suites covering the
posting bugs this branch fixes.

customers.service.spec.ts mocked autoPostFromRules to always return
'posted', so it could never have caught customer payments posting
nothing. The mock now defaults to 'skipped' and tests opt into success."
```

---

### Task 11: Update TODO.md

Required by `CLAUDE.md` for every change.

- [ ] **Step 1: Tick and move the completed items**

In `TODO.md`, under `### Accounting posting correctness — fabricated vouchers + dead rules (2026-07-16) — CRITICAL`, change each `- [ ]` this branch completed to `- [x]` and move them to the `## COMPLETED` section with today's date, e.g.:

```markdown
- [x] Accounting posting correctness — derived default posting rules from caller-emitted tuples; deleted the `fund_movement`/`none` + `inventory_adjustment`/`none` fallbacks that fabricated Dr Bank / Cr Cash vouchers for stock movements; added Accounts Receivable (fixing silently-unposted customer payments and credit sales), bKash/Nagad wallet accounts, and a Purchases account; made `bootstrap-accounting.ts` the single source of truth; enforced fiscal period locks; added the caller↔rule contract test; re-enabled the three suites CI was skipping — done 2026-07-16
```

- [ ] **Step 2: Add the follow-ups the spec deferred**

Add under the same section:

```markdown
- [ ] Wire `PaymentMethod.account_id` into posting — payment methods are tenant-configurable, so a custom method (e.g. "Upay") matches nothing in `classifyPaymentMode` and silently posts to Cash in Hand. The column exists and is documented as "Links to Account for posting" but is read by nothing; `sales.service.ts:150` takes `account_id` from the client DTO instead. Needs an account-resolution override in `autoPostFromRules`
- [ ] Perpetual inventory accounting — needs multi-leg vouchers or a second COGS event per sale (`autoPostFromRules` writes exactly two `VoucherDetail` rows). Would make Stock on Hand / COGS real; the periodic model chosen here leaves inventory off the balance sheet
- [ ] `purchase_return` posts Dr Purchase Payable / Cr Purchases unconditionally (`condition_key: 'none'`) — wrong for a cash purchase's return, which should credit cash
- [ ] Purchases cannot record a payment: `CreatePurchaseDto` has no `paidAmount`, `purchases.service.ts:75` never writes `Purchase.paid_amount` (schema default 0), and the full total is always booked as `CREDIT_PURCHASE`. So every purchase is a payable and `purchase/cash`|`purchase/bank` rules are unreachable. Adding `paidAmount` would need the supplier credit transaction to book only the unpaid remainder
- [ ] **Purchase Payable never clears in the ledger.** Purchases post Dr Purchases / Cr Purchase Payable, but `suppliers.service.recordCreditPayment` (`:611`) never calls `autoPostFromRules` — so paying a supplier moves `due_balance` without a voucher, and the payable grows forever. Pairs with the supplier-payment posting gap already logged under the demo-data section
- [ ] Run `npm run repair:vouchers --workspace=@erp71/database -- --dry-run` against production, review the report with the user, then run live. Changes historical reports — deliberately
```

- [ ] **Step 3: Commit**

```bash
git add TODO.md
git commit -m "docs: log accounting posting correctness completion + follow-ups"
```

---

## Verification

After all tasks:

- [ ] `cd apps/backend && npx jest --testPathPatterns="src/" --forceExit` — all green, with no ignore flags.
- [ ] `cd apps/backend && npx jest src/accounting/posting-contract.spec.ts` — green. This is the regression guard for the whole bug class.
- [ ] `npm run lint` from the repo root — clean.
- [ ] `git log --oneline dev` shows one commit per task.
- [ ] **`packages/database/prisma/bootstrap-accounting.js` and `index.js` match their `.ts` twins.** Re-read both and diff them by eye. This has shipped broken three times; `apps/backend/test/database-exports.spec.ts` catches missing exports but **cannot** catch behavioural drift in a mirrored function body.
- [ ] Run `cd apps/backend && npx jest test/database-exports.spec.ts` — green.

## What this plan does NOT do

- **Does not run the repair against production.** Task 9 Step 6. That is a runbook step needing a reviewed dry run first.
- **Does not fix existing tenants automatically on deploy.** They are only repaired when the script is run.
- **Does not migrate purchase history** into the new `Purchases` account. Purchases before this change stay in General Operating Expense — an accepted, documented split.
- **Does not reverse fabricated vouchers** — it deletes them. Past-period reports will change, deliberately, because they were wrong.
