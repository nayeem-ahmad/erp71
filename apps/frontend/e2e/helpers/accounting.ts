import { expect, type Page } from '@playwright/test';

/** Seeded bootstrap accounts available in the demo tenant. */
export const SEEDED_ACCOUNTS = {
    cash: 'Cash in Hand (1010)',
    bank: 'Main Bank Account (1020)',
    expense: 'General Operating Expense (5010)',
    revenue: 'Sales Revenue (4010)',
    equity: "Owner's Equity (3010)",
} as const;

export type VoucherTypeValue =
    | 'cash_payment'
    | 'cash_receive'
    | 'bank_payment'
    | 'bank_receive'
    | 'fund_transfer'
    | 'journal';

export type VoucherRowSpec = {
    account: keyof typeof SEEDED_ACCOUNTS;
    debit?: string;
    credit?: string;
};

export const VOUCHER_SCENARIOS: Array<{
    type: VoucherTypeValue;
    label: string;
    amount: string;
    rows: [VoucherRowSpec, VoucherRowSpec];
}> = [
    {
        type: 'cash_payment',
        label: 'Cash Payment',
        amount: '150',
        rows: [
            { account: 'cash', credit: '150' },
            { account: 'expense', debit: '150' },
        ],
    },
    {
        type: 'cash_receive',
        label: 'Cash Receive',
        amount: '200',
        rows: [
            { account: 'cash', debit: '200' },
            { account: 'revenue', credit: '200' },
        ],
    },
    {
        type: 'bank_payment',
        label: 'Bank Payment',
        amount: '175',
        rows: [
            { account: 'bank', credit: '175' },
            { account: 'expense', debit: '175' },
        ],
    },
    {
        type: 'bank_receive',
        label: 'Bank Receive',
        amount: '225',
        rows: [
            { account: 'bank', debit: '225' },
            { account: 'revenue', credit: '225' },
        ],
    },
    {
        type: 'fund_transfer',
        label: 'Fund Transfer',
        amount: '100',
        rows: [
            { account: 'cash', debit: '100' },
            { account: 'bank', credit: '100' },
        ],
    },
    {
        type: 'journal',
        label: 'Journal Voucher',
        amount: '50',
        rows: [
            { account: 'cash', debit: '50' },
            { account: 'equity', credit: '50' },
        ],
    },
];

/** All accounting report routes and expected heading patterns. */
export const ACCOUNTING_REPORTS = [
    { path: '/accounting/reports/pl', pattern: /profit|loss|p\s*&\s*l/i, label: 'Profit & Loss' },
    { path: '/accounting/reports/balance-sheet', pattern: /balance sheet/i, label: 'Balance Sheet' },
    { path: '/accounting/reports/cashbook', pattern: /cashbook|cash book/i, label: 'Cashbook' },
    { path: '/accounting/reports/bankbook', pattern: /bankbook|bank book/i, label: 'Bankbook' },
    { path: '/accounting/reports/trial-balance', pattern: /trial balance/i, label: 'Trial Balance' },
    { path: '/accounting/reports/comparative-pl', pattern: /comparative/i, label: 'Comparative P&L' },
    { path: '/accounting/reports/ar-aging', pattern: /ar aging|receivable aging|accounts receivable/i, label: 'AR Aging' },
    { path: '/accounting/reports/ap-aging', pattern: /ap aging|payable aging|accounts payable/i, label: 'AP Aging' },
    { path: '/accounting/reports/vat-tax', pattern: /vat|tax/i, label: 'VAT / Tax' },
    { path: '/accounting/reports/budget-vs-actual', pattern: /budget/i, label: 'Budget vs Actual' },
    { path: '/accounting/reports/cash-flow', pattern: /cash flow/i, label: 'Cash Flow' },
    { path: '/accounting/reports/financial-ratios', pattern: /financial ratio|ratio/i, label: 'Financial Ratios' },
] as const;

/** Core accounting workspace routes (setup, operations, reconciliation). */
export const ACCOUNTING_WORKSPACE_ROUTES = [
    { path: '/accounting', pattern: /accounting|chart of accounts|voucher/i, label: 'Overview' },
    { path: '/accounting/coa', pattern: /chart of accounts|account directory/i, label: 'Chart of Accounts' },
    { path: '/accounting/vouchers/new', pattern: /voucher/i, label: 'Voucher Entry' },
    { path: '/accounting/vouchers', pattern: /voucher/i, label: 'Vouchers' },
    { path: '/accounting/journal', pattern: /journal/i, label: 'Journal' },
    { path: '/accounting/ledger', pattern: /ledger|general ledger/i, label: 'Ledger' },
    { path: '/accounting/posting-rules', pattern: /posting rule/i, label: 'Posting Rules' },
    { path: '/accounting/reconciliation', pattern: /posting|exception|reconciliation/i, label: 'Posting Exceptions' },
    { path: '/accounting/fiscal-periods', pattern: /fiscal period/i, label: 'Fiscal Periods' },
    { path: '/accounting/opening-balances', pattern: /opening balance/i, label: 'Opening Balances' },
    { path: '/accounting/cost-centers', pattern: /cost center/i, label: 'Cost Centers' },
    { path: '/accounting/fixed-assets', pattern: /fixed asset/i, label: 'Fixed Assets' },
    { path: '/accounting/recurring-journals', pattern: /recurring journal/i, label: 'Recurring Journals' },
    { path: '/accounting/reconciliation/bank', pattern: /bank reconciliation/i, label: 'Bank Reconciliation' },
    { path: '/accounting/expenses', pattern: /expense/i, label: 'Expenses' },
    { path: '/accounting/expenses/categories', pattern: /categor/i, label: 'Expense Categories' },
    { path: '/accounting/expenses/reports', pattern: /expense|report/i, label: 'Expense Reports' },
    { path: '/accounting/loans', pattern: /loan/i, label: 'Loans' },
    { path: '/accounting/inter-branch/fund-transfers', pattern: /fund transfer|inter-branch/i, label: 'Fund Transfers' },
] as const;

export async function waitForVoucherAccounts(page: Page) {
    await expect(page.getByText(/loading accounts/i)).not.toBeVisible({ timeout: 20_000 });
}

export async function fillBalancedVoucher(
    page: Page,
    scenario: (typeof VOUCHER_SCENARIOS)[number],
    reference?: string,
) {
    await page.goto('/accounting/vouchers/new');
    await expect(page.getByText(/voucher/i).first()).toBeVisible({ timeout: 10_000 });
    await waitForVoucherAccounts(page);

    await page.locator('#voucher-type-select').selectOption(scenario.type);
    await page.waitForTimeout(300);

    if (reference) {
        await page.getByLabel(/reference/i).fill(reference);
    }

    const accountSelects = page.getByLabel(/account row/i);
    for (let i = 0; i < scenario.rows.length; i++) {
        const row = scenario.rows[i];
        await accountSelects.nth(i).selectOption({ label: SEEDED_ACCOUNTS[row.account] });
        if (row.debit) {
            await page.getByLabel(`Debit row ${i + 1}`).fill(row.debit);
        }
        if (row.credit) {
            await page.getByLabel(`Credit row ${i + 1}`).fill(row.credit);
        }
    }

    await expect(page.getByText(/balanced and ready/i)).toBeVisible({ timeout: 5_000 });
}

export async function saveVoucher(page: Page) {
    const saveBtn = page.getByRole('button', { name: 'Save Voucher' });
    await expect(saveBtn).toBeEnabled({ timeout: 5_000 });
    await saveBtn.click();
    await expect(page).toHaveURL(/\/accounting\/vouchers\?voucher=/, { timeout: 15_000 });
}

export async function expectAccountingPageHeading(page: Page, pattern: RegExp) {
    await expect(page.getByRole('heading', { level: 1 }).or(page.locator('h1, h2').first())).toBeVisible({
        timeout: 10_000,
    });
    await expect(page.locator('body')).toContainText(pattern, { timeout: 10_000 });
}