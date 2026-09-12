/**
 * The platform's own chart of accounts — ERP71 the business, not ERP71 the
 * product a shop uses.
 *
 * Deliberately a SEPARATE template from `DEFAULT_ACCOUNTING_TEMPLATE` rather
 * than an extension of it. A SaaS platform sells subscriptions, not inventory:
 * it has no COGS, no stock, no inter-branch clearing and no supplier payables
 * worth a control account, and it has revenue lines (subscriptions, add-ons,
 * SMS and AI credits, setup fees) and costs (servers, gateways, LLM tokens)
 * that no shop has. Seeding the retail chart here and hiding the unused half
 * would leave a platform P&L full of permanently-zero lines — and a "Sales
 * Revenue" account that nothing ever posts to, next to the Subscription Revenue
 * account that everything does.
 *
 * Codes follow the same scheme as the tenant template (see account-code.ts), so
 * the reports, the ledger and the code-based sorting all behave identically.
 *
 * These are the DEFAULTS. The platform books are an ordinary tenant's books as
 * far as the accounting module is concerned, so an admin can add accounts,
 * rename them or add whole groups through the normal chart-of-accounts screens;
 * re-running the bootstrap leaves anything they changed alone.
 */
import { AccountCategory, AccountType } from './accounting.constants.js';
import {
    applyAccountingTemplate,
    type AccountingBootstrapClient,
    type DefaultAccountingGroupDefinition,
} from './bootstrap-accounting.js';

/**
 * Account names the posting code refers to by hand.
 *
 * Names rather than codes because `Account` is unique on `(tenant_id, name)` and
 * the code is only *preferred* — a pre-existing account can push a template row
 * onto the next free slot, so a code is not a stable handle but a name is.
 */
export const PLATFORM_ACCOUNT = {
    CASH: 'Cash in Hand',
    BANK: 'Main Bank Account',
    BKASH: 'bKash Account',
    NAGAD: 'Nagad Account',
    /**
     * Money the gateway is holding: taken from the tenant's card or wallet but
     * not yet settled to the platform's bank. Separate from BANK on purpose —
     * netting it into the bank balance would show cash the platform cannot
     * spend, and would hide the gateway's fee, which is only known at
     * settlement. An admin clears it to BANK with an ordinary journal voucher,
     * expensing the difference to Payment Gateway Charges.
     */
    GATEWAY_RECEIVABLE: 'Payment Gateway Receivable',
    /**
     * What tenants owe the platform. The control account behind the per-tenant
     * billing ledger: its balance is the mirror image of the sum of every
     * tenant's ledger balance in Admin › Tenants › Ledger (that one is signed
     * from the tenant's side, so a debit here is a credit there).
     *
     * Not a `party_type` control account: PartyType covers CUSTOMER, SUPPLIER,
     * EMPLOYEE and INVESTOR, and a tenant is none of those — the subsidiary
     * ledger per tenant already exists as BillingEvent rows, which is where the
     * admin console reads it from.
     */
    SUBSCRIPTION_RECEIVABLE: 'Subscription Receivable',

    SUBSCRIPTION_REVENUE: 'Subscription Revenue',
    SETUP_FEE_REVENUE: 'Setup & Onboarding Fees',
    ADDON_REVENUE: 'Add-on Module Revenue',
    SMS_REVENUE: 'SMS Credit Revenue',
    AI_REVENUE: 'AI Credit Revenue',
    OTHER_REVENUE: 'Other Platform Revenue',
    /**
     * Contra-revenue: a refund is a reversal of revenue, not a cost of running
     * the platform, so it sits in the revenue section with a debit balance.
     * `getProfitLoss` computes a revenue account as credit − debit, so this
     * reduces revenue exactly as it should instead of inflating expenses.
     */
    REFUNDS: 'Refunds & Chargebacks',

    SERVER_HOSTING: 'Server & Hosting',
    DOMAIN_SSL: 'Domain & SSL',
    SMS_GATEWAY: 'SMS Gateway Charges',
    AI_API: 'AI & LLM API Costs',
    EMAIL_SERVICE: 'Email & Notification Services',
    PAYMENT_GATEWAY_CHARGES: 'Payment Gateway Charges',
    THIRD_PARTY_SOFTWARE: 'Software Subscriptions',
    SALARIES: 'Salaries & Wages',
    CONTRACTOR: 'Contractor & Outsourcing',
    MARKETING: 'Marketing & Advertising',
    REFERRAL_COMMISSION: 'Referral Commission',
    OFFICE_RENT: 'Office Rent',
    UTILITIES: 'Utilities & Internet',
    PROFESSIONAL_FEES: 'Legal & Professional Fees',
    BANK_CHARGES: 'Bank Charges',
    TRAVEL: 'Travel & Conveyance',
    OTHER_EXPENSE: 'Other Operating Expenses',

    OWNER_CAPITAL: "Owner's Capital",
    RETAINED_EARNINGS: 'Retained Earnings',
    SALARY_PAYABLE: 'Salary Payable',
    ACCRUED_EXPENSES: 'Accrued Expenses',
    REFERRAL_PAYABLE: 'Referral Commission Payable',
    TAX_PAYABLE: 'Tax & VAT Payable',
} as const;

export type PlatformAccountName = (typeof PLATFORM_ACCOUNT)[keyof typeof PLATFORM_ACCOUNT];

/**
 * How an admin says "which pocket did this come out of / go into", and the
 * account each maps to. The same four a shop gets, because the platform is a
 * Bangladeshi business too and bKash and Nagad are how a lot of it gets paid.
 */
export const PLATFORM_PAYMENT_ACCOUNTS: Record<string, PlatformAccountName> = {
    CASH: PLATFORM_ACCOUNT.CASH,
    BANK: PLATFORM_ACCOUNT.BANK,
    BKASH: PLATFORM_ACCOUNT.BKASH,
    NAGAD: PLATFORM_ACCOUNT.NAGAD,
};

export const PLATFORM_PAYMENT_METHODS = Object.keys(PLATFORM_PAYMENT_ACCOUNTS);

export const PLATFORM_ACCOUNTING_TEMPLATE: DefaultAccountingGroupDefinition[] = [
    {
        name: 'Current Assets',
        code: '11',
        type: AccountType.ASSET,
        subgroups: [
            {
                name: 'Cash and Bank',
                code: '1101',
                accounts: [
                    { name: PLATFORM_ACCOUNT.CASH, code: '110101', type: AccountType.ASSET, category: AccountCategory.CASH },
                    { name: PLATFORM_ACCOUNT.BANK, code: '110102', type: AccountType.ASSET, category: AccountCategory.BANK },
                    { name: PLATFORM_ACCOUNT.BKASH, code: '110103', type: AccountType.ASSET, category: AccountCategory.CASH },
                    { name: PLATFORM_ACCOUNT.NAGAD, code: '110104', type: AccountType.ASSET, category: AccountCategory.CASH },
                ],
            },
            {
                name: 'Receivables',
                code: '1102',
                accounts: [
                    { name: PLATFORM_ACCOUNT.SUBSCRIPTION_RECEIVABLE, code: '110201', type: AccountType.ASSET, category: AccountCategory.GENERAL },
                    { name: PLATFORM_ACCOUNT.GATEWAY_RECEIVABLE, code: '110202', type: AccountType.ASSET, category: AccountCategory.GENERAL },
                ],
            },
        ],
    },
    {
        name: 'Non-Current Assets',
        code: '12',
        type: AccountType.ASSET,
        subgroups: [
            {
                name: 'Fixed Assets',
                code: '1201',
                accounts: [
                    { name: 'Computer & Office Equipment', code: '120101', type: AccountType.ASSET, category: AccountCategory.GENERAL },
                    { name: 'Accumulated Depreciation', code: '120102', type: AccountType.ASSET, category: AccountCategory.GENERAL },
                ],
            },
        ],
    },
    {
        name: 'Current Liabilities',
        code: '21',
        type: AccountType.LIABILITY,
        subgroups: [
            {
                name: 'Payables',
                code: '2101',
                accounts: [
                    { name: PLATFORM_ACCOUNT.ACCRUED_EXPENSES, code: '210101', type: AccountType.LIABILITY, category: AccountCategory.GENERAL },
                    { name: PLATFORM_ACCOUNT.SALARY_PAYABLE, code: '210102', type: AccountType.LIABILITY, category: AccountCategory.GENERAL },
                    { name: PLATFORM_ACCOUNT.REFERRAL_PAYABLE, code: '210103', type: AccountType.LIABILITY, category: AccountCategory.GENERAL },
                    { name: PLATFORM_ACCOUNT.TAX_PAYABLE, code: '210104', type: AccountType.LIABILITY, category: AccountCategory.GENERAL },
                ],
            },
        ],
    },
    {
        name: 'Equity',
        code: '31',
        type: AccountType.EQUITY,
        subgroups: [
            {
                name: 'Capital',
                code: '3101',
                accounts: [
                    { name: PLATFORM_ACCOUNT.OWNER_CAPITAL, code: '310101', type: AccountType.EQUITY, category: AccountCategory.GENERAL },
                    { name: PLATFORM_ACCOUNT.RETAINED_EARNINGS, code: '310102', type: AccountType.EQUITY, category: AccountCategory.GENERAL },
                ],
            },
        ],
    },
    {
        name: 'Revenue',
        code: '41',
        type: AccountType.REVENUE,
        subgroups: [
            {
                name: 'Subscription Revenue',
                code: '4101',
                accounts: [
                    { name: PLATFORM_ACCOUNT.SUBSCRIPTION_REVENUE, code: '410101', type: AccountType.REVENUE, category: AccountCategory.GENERAL },
                    { name: PLATFORM_ACCOUNT.ADDON_REVENUE, code: '410102', type: AccountType.REVENUE, category: AccountCategory.GENERAL },
                    { name: PLATFORM_ACCOUNT.SETUP_FEE_REVENUE, code: '410103', type: AccountType.REVENUE, category: AccountCategory.GENERAL },
                ],
            },
            {
                name: 'Usage Revenue',
                code: '4102',
                accounts: [
                    { name: PLATFORM_ACCOUNT.SMS_REVENUE, code: '410201', type: AccountType.REVENUE, category: AccountCategory.GENERAL },
                    { name: PLATFORM_ACCOUNT.AI_REVENUE, code: '410202', type: AccountType.REVENUE, category: AccountCategory.GENERAL },
                ],
            },
            {
                name: 'Other Revenue',
                code: '4103',
                accounts: [
                    { name: PLATFORM_ACCOUNT.OTHER_REVENUE, code: '410301', type: AccountType.REVENUE, category: AccountCategory.GENERAL },
                    { name: PLATFORM_ACCOUNT.REFUNDS, code: '410302', type: AccountType.REVENUE, category: AccountCategory.GENERAL },
                ],
            },
        ],
    },
    {
        name: 'Infrastructure & Platform Costs',
        code: '51',
        type: AccountType.EXPENSE,
        subgroups: [
            {
                name: 'Hosting & Services',
                code: '5101',
                accounts: [
                    { name: PLATFORM_ACCOUNT.SERVER_HOSTING, code: '510101', type: AccountType.EXPENSE, category: AccountCategory.GENERAL },
                    { name: PLATFORM_ACCOUNT.DOMAIN_SSL, code: '510102', type: AccountType.EXPENSE, category: AccountCategory.GENERAL },
                    { name: PLATFORM_ACCOUNT.EMAIL_SERVICE, code: '510103', type: AccountType.EXPENSE, category: AccountCategory.GENERAL },
                    { name: PLATFORM_ACCOUNT.THIRD_PARTY_SOFTWARE, code: '510104', type: AccountType.EXPENSE, category: AccountCategory.GENERAL },
                ],
            },
            {
                // The costs that scale with what tenants actually consume. Kept
                // in their own subgroup so the P&L shows gross margin on the
                // credit business without anyone having to add up lines.
                name: 'Usage Costs',
                code: '5102',
                accounts: [
                    { name: PLATFORM_ACCOUNT.SMS_GATEWAY, code: '510201', type: AccountType.EXPENSE, category: AccountCategory.GENERAL },
                    { name: PLATFORM_ACCOUNT.AI_API, code: '510202', type: AccountType.EXPENSE, category: AccountCategory.GENERAL },
                ],
            },
        ],
    },
    {
        name: 'Operating Expenses',
        code: '52',
        type: AccountType.EXPENSE,
        subgroups: [
            {
                name: 'People',
                code: '5201',
                accounts: [
                    { name: PLATFORM_ACCOUNT.SALARIES, code: '520101', type: AccountType.EXPENSE, category: AccountCategory.GENERAL },
                    { name: PLATFORM_ACCOUNT.CONTRACTOR, code: '520102', type: AccountType.EXPENSE, category: AccountCategory.GENERAL },
                ],
            },
            {
                name: 'Sales & Marketing',
                code: '5202',
                accounts: [
                    { name: PLATFORM_ACCOUNT.MARKETING, code: '520201', type: AccountType.EXPENSE, category: AccountCategory.GENERAL },
                    { name: PLATFORM_ACCOUNT.REFERRAL_COMMISSION, code: '520202', type: AccountType.EXPENSE, category: AccountCategory.GENERAL },
                ],
            },
            {
                name: 'Administration',
                code: '5203',
                accounts: [
                    { name: PLATFORM_ACCOUNT.OFFICE_RENT, code: '520301', type: AccountType.EXPENSE, category: AccountCategory.GENERAL },
                    { name: PLATFORM_ACCOUNT.UTILITIES, code: '520302', type: AccountType.EXPENSE, category: AccountCategory.GENERAL },
                    { name: PLATFORM_ACCOUNT.PROFESSIONAL_FEES, code: '520303', type: AccountType.EXPENSE, category: AccountCategory.GENERAL },
                    { name: PLATFORM_ACCOUNT.TRAVEL, code: '520304', type: AccountType.EXPENSE, category: AccountCategory.GENERAL },
                    { name: PLATFORM_ACCOUNT.PAYMENT_GATEWAY_CHARGES, code: '520305', type: AccountType.EXPENSE, category: AccountCategory.GENERAL },
                    { name: PLATFORM_ACCOUNT.BANK_CHARGES, code: '520306', type: AccountType.EXPENSE, category: AccountCategory.GENERAL },
                    { name: PLATFORM_ACCOUNT.OTHER_EXPENSE, code: '520307', type: AccountType.EXPENSE, category: AccountCategory.GENERAL },
                ],
            },
        ],
    },
];

export interface PlatformExpenseCategoryDefinition {
    code: string;
    name: string;
    description: string;
    account_name: PlatformAccountName;
    sort_order: number;
}

/**
 * What the platform spends money on, in the order an admin is most likely to
 * reach for. Each is just a label plus the account it debits — the ledger
 * effect is what matters, and two categories may share an account if that is
 * genuinely how the platform thinks about the spend.
 */
export const DEFAULT_PLATFORM_EXPENSE_CATEGORIES: PlatformExpenseCategoryDefinition[] = [
    {
        code: 'SERVER_HOSTING',
        name: 'Server & Hosting',
        description: 'VPS, bandwidth, backups, object storage and anything else the app runs on.',
        account_name: PLATFORM_ACCOUNT.SERVER_HOSTING,
        sort_order: 10,
    },
    {
        code: 'DOMAIN_SSL',
        name: 'Domain & SSL',
        description: 'Domain registrations and renewals, and any certificate that is not free.',
        account_name: PLATFORM_ACCOUNT.DOMAIN_SSL,
        sort_order: 20,
    },
    {
        code: 'SMS_GATEWAY',
        name: 'SMS Gateway',
        description: 'What the SMS provider bills for the messages tenants send.',
        account_name: PLATFORM_ACCOUNT.SMS_GATEWAY,
        sort_order: 30,
    },
    {
        code: 'AI_API',
        name: 'AI & LLM API',
        description: 'Model and API spend behind the AI assistant and AI credits.',
        account_name: PLATFORM_ACCOUNT.AI_API,
        sort_order: 40,
    },
    {
        code: 'EMAIL_SERVICE',
        name: 'Email & Notifications',
        description: 'Transactional email, push and WhatsApp delivery costs.',
        account_name: PLATFORM_ACCOUNT.EMAIL_SERVICE,
        sort_order: 50,
    },
    {
        code: 'SOFTWARE',
        name: 'Software Subscriptions',
        description: 'Tools the team pays for monthly — monitoring, design, CI, repositories.',
        account_name: PLATFORM_ACCOUNT.THIRD_PARTY_SOFTWARE,
        sort_order: 60,
    },
    {
        code: 'SALARIES',
        name: 'Salaries & Wages',
        description: 'Payroll for the platform team.',
        account_name: PLATFORM_ACCOUNT.SALARIES,
        sort_order: 70,
    },
    {
        code: 'CONTRACTOR',
        name: 'Contractor & Outsourcing',
        description: 'Freelancers and agencies engaged for a piece of work.',
        account_name: PLATFORM_ACCOUNT.CONTRACTOR,
        sort_order: 80,
    },
    {
        code: 'MARKETING',
        name: 'Marketing & Advertising',
        description: 'Ads, campaigns, content and events.',
        account_name: PLATFORM_ACCOUNT.MARKETING,
        sort_order: 90,
    },
    {
        code: 'REFERRAL_COMMISSION',
        name: 'Referral Commission',
        description: 'Commission paid out to referral partners.',
        account_name: PLATFORM_ACCOUNT.REFERRAL_COMMISSION,
        sort_order: 100,
    },
    {
        code: 'OFFICE_RENT',
        name: 'Office Rent',
        description: 'Rent and service charges for the office.',
        account_name: PLATFORM_ACCOUNT.OFFICE_RENT,
        sort_order: 110,
    },
    {
        code: 'UTILITIES',
        name: 'Utilities & Internet',
        description: 'Electricity, internet and other running costs of the office.',
        account_name: PLATFORM_ACCOUNT.UTILITIES,
        sort_order: 120,
    },
    {
        code: 'PROFESSIONAL_FEES',
        name: 'Legal & Professional Fees',
        description: 'Lawyers, accountants, audit and company filings.',
        account_name: PLATFORM_ACCOUNT.PROFESSIONAL_FEES,
        sort_order: 130,
    },
    {
        code: 'PAYMENT_GATEWAY',
        name: 'Payment Gateway Charges',
        description: 'What SSLCommerz, bKash or Nagad keep from each collection.',
        account_name: PLATFORM_ACCOUNT.PAYMENT_GATEWAY_CHARGES,
        sort_order: 140,
    },
    {
        code: 'BANK_CHARGES',
        name: 'Bank Charges',
        description: 'Account fees, transfer charges and card costs.',
        account_name: PLATFORM_ACCOUNT.BANK_CHARGES,
        sort_order: 150,
    },
    {
        code: 'TRAVEL',
        name: 'Travel & Conveyance',
        description: 'Travel for client visits, onboarding and events.',
        account_name: PLATFORM_ACCOUNT.TRAVEL,
        sort_order: 160,
    },
    {
        code: 'OTHER',
        name: 'Other Operating Expenses',
        description: 'Anything that does not fit a category above.',
        account_name: PLATFORM_ACCOUNT.OTHER_EXPENSE,
        sort_order: 999,
    },
];

type PlatformCategoryClient = {
    platformExpenseCategory: {
        upsert: (args: unknown) => Promise<unknown>;
    };
};

/**
 * Seed the default expense categories.
 *
 * Only ever creates: `update` deliberately writes nothing, because an admin who
 * renamed "Server & Hosting" to "Hosting (DigitalOcean)" or pointed it at a
 * different account meant it, and a redeploy should not undo that. Deactivating
 * one they do not use is likewise left alone.
 */
export async function seedPlatformExpenseCategories(db: PlatformCategoryClient): Promise<void> {
    for (const category of DEFAULT_PLATFORM_EXPENSE_CATEGORIES) {
        await db.platformExpenseCategory.upsert({
            where: { code: category.code },
            update: {},
            create: {
                code: category.code,
                name: category.name,
                description: category.description,
                account_name: category.account_name,
                sort_order: category.sort_order,
            },
        });
    }
}

/**
 * Put the platform chart of accounts onto the platform workspace tenant.
 *
 * Idempotent, and safe to call on every request that needs the books — which is
 * exactly how `PlatformAccountingService.resolveBooks` uses it, so a chart that
 * gains an account in a later release simply appears the next time an admin
 * opens the module rather than needing a data migration.
 */
export async function bootstrapPlatformAccounting(
    db: AccountingBootstrapClient,
    tenantId: string,
): Promise<void> {
    await applyAccountingTemplate(db, tenantId, PLATFORM_ACCOUNTING_TEMPLATE);
}
