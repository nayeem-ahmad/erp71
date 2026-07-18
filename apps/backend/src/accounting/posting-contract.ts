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

    // ── supplier payments ────────────────────────────────────────────────────
    // 'rule', not 'skip': unlike customer_payment (provisioned lazily by
    // ensureCustomerPaymentPostingSetup), these live in DEFAULT_POSTING_RULES —
    // the bootstrap creates Purchase Payable and Cash in Hand unconditionally, so
    // there is nothing to provision lazily around.
    //
    // Keyed on payment_direction rather than payment_mode because
    // SupplierCreditTransaction has no payment_method column. See TODO.md.
    { eventType: 'supplier_payment', conditionKey: 'payment_direction', conditionValue: 'pay', emittedBy: 'suppliers.service.ts:670', expectation: 'rule' },
    { eventType: 'supplier_payment', conditionKey: 'payment_direction', conditionValue: 'receive', emittedBy: 'suppliers.service.ts:670', expectation: 'rule' },

    // ── depreciation ─────────────────────────────────────────────────────────
    { eventType: 'depreciation', conditionKey: 'none', conditionValue: null, emittedBy: 'accounting.service.ts:runDepreciation', expectation: 'rule' },

    // ── cashier cash-out ─────────────────────────────────────────────────────
    // DROP/OTHER are intentionally absent (both sides are Cash in Hand), so they
    // are not listed here — only the two that post.
    { eventType: 'cash_transaction', conditionKey: 'reason_type', conditionValue: 'PAYOUT', emittedBy: 'cashier-sessions.service.ts:addCashTransaction', expectation: 'rule' },
    { eventType: 'cash_transaction', conditionKey: 'reason_type', conditionValue: 'LOAN', emittedBy: 'cashier-sessions.service.ts:addCashTransaction', expectation: 'rule' },

    // ── inter-branch fund transfer ───────────────────────────────────────────
    { eventType: 'fund_transfer', conditionKey: 'transfer_scope', conditionValue: 'initiate', emittedBy: 'fund-transfers.service.ts:initiate', expectation: 'rule' },
    { eventType: 'fund_transfer', conditionKey: 'transfer_scope', conditionValue: 'receive', emittedBy: 'fund-transfers.service.ts:receive', expectation: 'rule' },

    // ── fixed-asset acquisition ──────────────────────────────────────────────
    { eventType: 'asset_acquisition', conditionKey: 'payment_mode', conditionValue: 'cash', emittedBy: 'accounting.service.ts:createFixedAsset', expectation: 'rule' },
    { eventType: 'asset_acquisition', conditionKey: 'payment_mode', conditionValue: 'bank', emittedBy: 'accounting.service.ts:createFixedAsset', expectation: 'rule' },
    { eventType: 'asset_acquisition', conditionKey: 'payment_mode', conditionValue: 'bkash', emittedBy: 'accounting.service.ts:createFixedAsset', expectation: 'rule' },
    { eventType: 'asset_acquisition', conditionKey: 'payment_mode', conditionValue: 'nagad', emittedBy: 'accounting.service.ts:createFixedAsset', expectation: 'rule' },

    // ── payroll accrual ──────────────────────────────────────────────────────
    { eventType: 'salary_accrual', conditionKey: 'none', conditionValue: null, emittedBy: 'salary-payments.service.ts:runMonthlyAccrual', expectation: 'rule' },

    // ── payroll payment ──────────────────────────────────────────────────────
    { eventType: 'salary_payment', conditionKey: 'payment_mode', conditionValue: 'cash', emittedBy: 'salary-payments.service.ts:create', expectation: 'rule' },
    { eventType: 'salary_payment', conditionKey: 'payment_mode', conditionValue: 'bank', emittedBy: 'salary-payments.service.ts:create', expectation: 'rule' },
    { eventType: 'salary_payment', conditionKey: 'payment_mode', conditionValue: 'bkash', emittedBy: 'salary-payments.service.ts:create', expectation: 'rule' },
    { eventType: 'salary_payment', conditionKey: 'payment_mode', conditionValue: 'nagad', emittedBy: 'salary-payments.service.ts:create', expectation: 'rule' },

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
