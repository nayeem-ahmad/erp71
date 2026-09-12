/**
 * Shapes the `/platform/accounting/*` endpoints return.
 *
 * Deliberately separate from the tenant accounting types: these come off a
 * different controller, carry no store or scope dimension (the platform books
 * have no branches), and the expense models are platform-only.
 */

export interface PlatformAccountingTotals {
    revenue: number;
    expenses: number;
    net_profit: number;
    cash_and_bank: number;
    subscription_receivable: number;
    gateway_receivable: number;
}

export interface PlatformAccountingOverview {
    range: { from: string; to: string };
    totals: PlatformAccountingTotals;
    revenue_by_account: Array<{ name: string; amount: number }>;
    expenses_by_category: Array<{ category_id: string; name: string; amount: number }>;
    unsynced_billing_events: number;
    recent_vouchers: Array<{
        id: string;
        voucher_number: string;
        voucher_type: string;
        description: string | null;
        date: string;
        amount: number;
    }>;
}

export interface PlatformBillingSyncResult {
    posted: number;
    unchanged: number;
    repaired: number;
    reverted: number;
    failed: Array<{ eventId: string; reason: string }>;
    scanned: number;
}

export interface PlatformExpenseCategory {
    id: string;
    code: string;
    name: string;
    description: string | null;
    account_name: string;
    is_active: boolean;
    sort_order: number;
    _count?: { expenses: number };
}

export interface PlatformExpense {
    id: string;
    category_id: string;
    category_name: string | null;
    account_name: string | null;
    amount: number;
    expense_date: string;
    paid_from: string;
    vendor: string | null;
    description: string | null;
    reference: string | null;
    voucher_id: string | null;
    posting_status: string;
    created_at: string;
}

export interface PlatformExpenseList {
    data: PlatformExpense[];
    meta: { page: number; limit: number; total: number; totalPages: number; totalAmount: number };
}

export interface PlatformAccount {
    id: string;
    name: string;
    code: string | null;
    type: string;
    category: string;
    group?: { id: string; name: string; code?: string | null } | null;
}

export interface PlatformLedgerEntry {
    id: string;
    voucher_id: string;
    voucher_number: string;
    voucher_type: string;
    date: string;
    description: string | null;
    narration: string | null;
    debit_amount: number;
    credit_amount: number;
    running_balance: number;
    /** 'Dr' or 'Cr' — a balance is presented on its side, not as a signed number. */
    running_balance_side: string;
}

export interface PlatformLedger {
    account: PlatformAccount;
    opening_balance: number;
    opening_balance_side: string;
    closing_balance: number;
    closing_balance_side: string;
    totals: { debit: number; credit: number };
    data: PlatformLedgerEntry[];
}

/** One line of a P&L / balance-sheet group, as `buildLevelledGroups` returns it. */
export interface PlatformStatementRow {
    id: string;
    name: string;
    code?: string | null;
    balance: number;
}

export interface PlatformStatementGroup {
    group: { id: string; name: string; code?: string | null };
    rows: PlatformStatementRow[];
    total: number;
}

export interface PlatformProfitLoss {
    revenue: { groups: PlatformStatementGroup[]; total: number };
    expenses: { groups: PlatformStatementGroup[]; total: number };
    net_profit: number;
}

export interface PlatformBalanceSheet {
    assets: { groups: PlatformStatementGroup[]; total: number };
    liabilities: { groups: PlatformStatementGroup[]; total: number };
    /** `net_profit` is this period's result, folded into equity by the server. */
    equity: { groups: PlatformStatementGroup[]; net_profit: number; total: number };
    total_liabilities_and_equity: number;
    is_balanced: boolean;
}

export interface PlatformTrialBalance {
    as_of: string;
    rows: Array<{
        account: { id: string; name: string; code?: string | null };
        debit_balance: number;
        credit_balance: number;
    }>;
    totals: { debit: number; credit: number };
    is_balanced: boolean;
}

/** The four pockets a platform expense can be paid from. Mirrors PLATFORM_PAYMENT_ACCOUNTS. */
export const PLATFORM_PAYMENT_METHODS = ['CASH', 'BANK', 'BKASH', 'NAGAD'] as const;

export type PlatformPaymentMethod = (typeof PLATFORM_PAYMENT_METHODS)[number];

/** Today, as the `<input type="date">` value. */
export function todayISO(): string {
    return new Date().toISOString().slice(0, 10);
}

/** 1 January of the current year — the default start of the books' reporting period. */
export function startOfYearISO(): string {
    return `${new Date().getFullYear()}-01-01`;
}
