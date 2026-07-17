import { Prisma, PrismaClient, PostingRuleConditionKey, PostingRuleEventType } from '@prisma/client';
import { AccountCategory, AccountType } from './accounting.constants.js';

export interface DefaultAccountingAccountDefinition {
    name: string;
    code?: string;
    type: AccountType;
    category: AccountCategory;
}

export interface DefaultAccountingSubgroupDefinition {
    name: string;
    accounts: DefaultAccountingAccountDefinition[];
}

export interface DefaultAccountingGroupDefinition {
    name: string;
    type: AccountType;
    subgroups: DefaultAccountingSubgroupDefinition[];
}

export const DEFAULT_ACCOUNTING_TEMPLATE: DefaultAccountingGroupDefinition[] = [
    {
        name: 'Current Assets',
        type: AccountType.ASSET,
        subgroups: [
            {
                name: 'Cash and Bank',
                accounts: [
                    {
                        name: 'Cash in Hand',
                        code: '1010',
                        type: AccountType.ASSET,
                        category: AccountCategory.CASH,
                    },
                    {
                        name: 'Main Bank Account',
                        code: '1020',
                        type: AccountType.ASSET,
                        category: AccountCategory.BANK,
                    },
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
                ],
            },
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
            {
                name: 'Loans Receivable',
                accounts: [
                    {
                        name: 'Loans Receivable',
                        code: '1035',
                        type: AccountType.ASSET,
                        category: AccountCategory.GENERAL,
                    },
                ],
            },
            {
                name: 'Inter-Branch Clearing',
                accounts: [
                    {
                        name: 'Due from Branches',
                        code: '1040',
                        type: AccountType.ASSET,
                        category: AccountCategory.GENERAL,
                    },
                ],
            },
        ],
    },
    {
        name: 'Current Liabilities',
        type: AccountType.LIABILITY,
        subgroups: [
            {
                name: 'Trade Payables',
                accounts: [
                    {
                        name: 'Purchase Payable',
                        code: '2010',
                        type: AccountType.LIABILITY,
                        category: AccountCategory.GENERAL,
                    },
                ],
            },
            {
                name: 'Loans Payable',
                accounts: [
                    {
                        name: 'Loans Payable',
                        code: '2020',
                        type: AccountType.LIABILITY,
                        category: AccountCategory.GENERAL,
                    },
                ],
            },
            {
                name: 'Inter-Branch Clearing',
                accounts: [
                    {
                        name: 'Due to Branches',
                        code: '2040',
                        type: AccountType.LIABILITY,
                        category: AccountCategory.GENERAL,
                    },
                ],
            },
        ],
    },
    {
        name: 'Owner Equity',
        type: AccountType.EQUITY,
        subgroups: [
            {
                name: 'Capital',
                accounts: [
                    {
                        name: "Owner's Equity",
                        code: '3010',
                        type: AccountType.EQUITY,
                        category: AccountCategory.GENERAL,
                    },
                ],
            },
        ],
    },
    {
        name: 'Operating Revenue',
        type: AccountType.REVENUE,
        subgroups: [
            {
                name: 'Sales',
                accounts: [
                    {
                        name: 'Sales Revenue',
                        code: '4010',
                        type: AccountType.REVENUE,
                        category: AccountCategory.GENERAL,
                    },
                ],
            },
        ],
    },
    {
        name: 'Operating Expenses',
        type: AccountType.EXPENSE,
        subgroups: [
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
            {
                name: 'General Expenses',
                accounts: [
                    {
                        name: 'General Operating Expense',
                        code: '5010',
                        type: AccountType.EXPENSE,
                        category: AccountCategory.GENERAL,
                    },
                ],
            },
        ],
    },
];

type AccountingBootstrapClient = PrismaClient | Prisma.TransactionClient;

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

    // ── Supplier payments ────────────────────────────────────────────────────
    // What finally DEBITS Purchase Payable. Purchases credit it on every tenant,
    // but nothing ever debited it, so the liability grew forever.
    //
    // Keyed on payment_direction, not payment_mode, because
    // SupplierCreditTransaction has no payment_method column — there is no mode to
    // read. Cash in Hand is therefore the default counter-account, exactly as
    // customer_payment already assumes. Tenants can repoint the rule; resolving the
    // account from the payment method is tracked in TODO.md.
    { event_type: 'supplier_payment', condition_key: 'payment_direction', condition_value: 'pay', debit_account: 'Purchase Payable', credit_account: 'Cash in Hand', priority: 10 },
    { event_type: 'supplier_payment', condition_key: 'payment_direction', condition_value: 'receive', debit_account: 'Cash in Hand', credit_account: 'Purchase Payable', priority: 20 },

    // ── DELIBERATELY ABSENT: fund_movement, inventory_adjustment ─────────────
    // Under periodic inventory these events have no journal entry. Adding a
    // condition_key:'none' rule here is worse than adding nothing, because
    // autoPostFromRules FALLS BACK to it - which is what posted Dr Main Bank /
    // Cr Cash in Hand for every warehouse transfer. See posting-contract.spec.ts.
];

export async function bootstrapDefaultAccountingForTenant(
    db: AccountingBootstrapClient,
    tenantId: string,
) {
    for (const groupDefinition of DEFAULT_ACCOUNTING_TEMPLATE) {
        const group = await db.accountGroup.upsert({
            where: {
                tenant_id_name: {
                    tenant_id: tenantId,
                    name: groupDefinition.name,
                },
            },
            update: {
                type: groupDefinition.type,
            },
            create: {
                tenant_id: tenantId,
                name: groupDefinition.name,
                type: groupDefinition.type,
            },
        });

        for (const subgroupDefinition of groupDefinition.subgroups) {
            const subgroup = await db.accountSubgroup.upsert({
                where: {
                    group_id_name: {
                        group_id: group.id,
                        name: subgroupDefinition.name,
                    },
                },
                update: {},
                create: {
                    tenant_id: tenantId,
                    group_id: group.id,
                    name: subgroupDefinition.name,
                },
            });

            for (const accountDefinition of subgroupDefinition.accounts) {
                await db.account.upsert({
                    where: {
                        tenant_id_name: {
                            tenant_id: tenantId,
                            name: accountDefinition.name,
                        },
                    },
                    update: {
                        group_id: group.id,
                        subgroup_id: subgroup.id,
                        code: accountDefinition.code,
                        type: accountDefinition.type,
                        category: accountDefinition.category,
                    },
                    create: {
                        tenant_id: tenantId,
                        group_id: group.id,
                        subgroup_id: subgroup.id,
                        name: accountDefinition.name,
                        code: accountDefinition.code,
                        type: accountDefinition.type,
                        category: accountDefinition.category,
                    },
                });
            }
        }
    }

    const accounts = await db.account.findMany({
        where: { tenant_id: tenantId },
        select: { id: true, name: true },
    });

    const accountByName = new Map<string, string>(
        accounts.map((account) => [account.name, account.id as string]),
    );

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

    await ensureLoanPostingSetup(db, tenantId);
    await ensureInterBranchAccounts(db, tenantId);
}

/**
 * Idempotently ensure inter-branch clearing accounts exist for a tenant.
 */
export async function ensureInterBranchAccounts(
    db: AccountingBootstrapClient,
    tenantId: string,
) {
    const assetGroup = await db.accountGroup.upsert({
        where: { tenant_id_name: { tenant_id: tenantId, name: 'Current Assets' } },
        update: {},
        create: { tenant_id: tenantId, name: 'Current Assets', type: AccountType.ASSET },
    });
    const liabilityGroup = await db.accountGroup.upsert({
        where: { tenant_id_name: { tenant_id: tenantId, name: 'Current Liabilities' } },
        update: {},
        create: { tenant_id: tenantId, name: 'Current Liabilities', type: AccountType.LIABILITY },
    });

    const dueFromSubgroup = await db.accountSubgroup.upsert({
        where: { group_id_name: { group_id: assetGroup.id, name: 'Inter-Branch Clearing' } },
        update: {},
        create: { tenant_id: tenantId, group_id: assetGroup.id, name: 'Inter-Branch Clearing' },
    });
    const dueToSubgroup = await db.accountSubgroup.upsert({
        where: { group_id_name: { group_id: liabilityGroup.id, name: 'Inter-Branch Clearing' } },
        update: {},
        create: { tenant_id: tenantId, group_id: liabilityGroup.id, name: 'Inter-Branch Clearing' },
    });

    await db.account.upsert({
        where: { tenant_id_name: { tenant_id: tenantId, name: 'Due from Branches' } },
        update: {
            group_id: assetGroup.id,
            subgroup_id: dueFromSubgroup.id,
            code: '1040',
            type: AccountType.ASSET,
            category: AccountCategory.GENERAL,
        },
        create: {
            tenant_id: tenantId,
            group_id: assetGroup.id,
            subgroup_id: dueFromSubgroup.id,
            name: 'Due from Branches',
            code: '1040',
            type: AccountType.ASSET,
            category: AccountCategory.GENERAL,
        },
    });

    await db.account.upsert({
        where: { tenant_id_name: { tenant_id: tenantId, name: 'Due to Branches' } },
        update: {
            group_id: liabilityGroup.id,
            subgroup_id: dueToSubgroup.id,
            code: '2040',
            type: AccountType.LIABILITY,
            category: AccountCategory.GENERAL,
        },
        create: {
            tenant_id: tenantId,
            group_id: liabilityGroup.id,
            subgroup_id: dueToSubgroup.id,
            name: 'Due to Branches',
            code: '2040',
            type: AccountType.LIABILITY,
            category: AccountCategory.GENERAL,
        },
    });
}

/**
 * Idempotently ensure the loan accounts (Loans Payable / Loans Receivable) and
 * the default loan posting rules exist for a tenant. New tenants get these via
 * the accounting bootstrap; existing tenants get them lazily the first time a
 * loan is created or repaid. Safe to call repeatedly — it returns early once
 * the loan rules are present.
 */
export async function ensureLoanPostingSetup(
    db: AccountingBootstrapClient,
    tenantId: string,
) {
    const alreadyConfigured = await db.postingRule.findFirst({
        where: {
            tenant_id: tenantId,
            event_type: 'loan_disbursement',
            condition_key: 'loan_direction',
        },
        select: { id: true },
    });
    if (alreadyConfigured) {
        return;
    }

    const assetGroup = await db.accountGroup.upsert({
        where: { tenant_id_name: { tenant_id: tenantId, name: 'Current Assets' } },
        update: {},
        create: { tenant_id: tenantId, name: 'Current Assets', type: AccountType.ASSET },
    });
    const liabilityGroup = await db.accountGroup.upsert({
        where: { tenant_id_name: { tenant_id: tenantId, name: 'Current Liabilities' } },
        update: {},
        create: { tenant_id: tenantId, name: 'Current Liabilities', type: AccountType.LIABILITY },
    });

    const receivableSubgroup = await db.accountSubgroup.upsert({
        where: { group_id_name: { group_id: assetGroup.id, name: 'Loans Receivable' } },
        update: {},
        create: { tenant_id: tenantId, group_id: assetGroup.id, name: 'Loans Receivable' },
    });
    const payableSubgroup = await db.accountSubgroup.upsert({
        where: { group_id_name: { group_id: liabilityGroup.id, name: 'Loans Payable' } },
        update: {},
        create: { tenant_id: tenantId, group_id: liabilityGroup.id, name: 'Loans Payable' },
    });

    const loanReceivable = await db.account.upsert({
        where: { tenant_id_name: { tenant_id: tenantId, name: 'Loans Receivable' } },
        update: {},
        create: {
            tenant_id: tenantId,
            group_id: assetGroup.id,
            subgroup_id: receivableSubgroup.id,
            name: 'Loans Receivable',
            code: '1035',
            type: AccountType.ASSET,
            category: AccountCategory.GENERAL,
        },
    });
    const loanPayable = await db.account.upsert({
        where: { tenant_id_name: { tenant_id: tenantId, name: 'Loans Payable' } },
        update: {},
        create: {
            tenant_id: tenantId,
            group_id: liabilityGroup.id,
            subgroup_id: payableSubgroup.id,
            name: 'Loans Payable',
            code: '2020',
            type: AccountType.LIABILITY,
            category: AccountCategory.GENERAL,
        },
    });

    // Cash is the contra account for both directions. Prefer the canonical
    // "Cash in Hand"; fall back to any cash-category account.
    const cashAccount =
        (await db.account.findFirst({
            where: { tenant_id: tenantId, name: 'Cash in Hand' },
            select: { id: true },
        })) ??
        (await db.account.findFirst({
            where: { tenant_id: tenantId, category: AccountCategory.CASH },
            orderBy: { code: 'asc' },
            select: { id: true },
        }));

    if (!cashAccount) {
        // No cash account to post against — postings will be skipped gracefully
        // by the engine until the tenant configures rules manually.
        return;
    }

    const loanRules: Array<{
        event_type: PostingRuleEventType;
        condition_value: string;
        debit_account_id: string;
        credit_account_id: string;
        priority: number;
    }> = [
        // Borrowed money: cash comes in, loan liability rises.
        {
            event_type: 'loan_disbursement',
            condition_value: 'PAYABLE',
            debit_account_id: cashAccount.id,
            credit_account_id: loanPayable.id,
            priority: 10,
        },
        // Lent money out: loan asset rises, cash goes out.
        {
            event_type: 'loan_disbursement',
            condition_value: 'RECEIVABLE',
            debit_account_id: loanReceivable.id,
            credit_account_id: cashAccount.id,
            priority: 20,
        },
        // Repaying borrowed money: loan liability falls, cash goes out.
        {
            event_type: 'loan_repayment',
            condition_value: 'PAYABLE',
            debit_account_id: loanPayable.id,
            credit_account_id: cashAccount.id,
            priority: 10,
        },
        // Collecting on money lent: cash comes in, loan asset falls.
        {
            event_type: 'loan_repayment',
            condition_value: 'RECEIVABLE',
            debit_account_id: cashAccount.id,
            credit_account_id: loanReceivable.id,
            priority: 20,
        },
    ];

    for (const rule of loanRules) {
        const exists = await db.postingRule.findFirst({
            where: {
                tenant_id: tenantId,
                event_type: rule.event_type,
                condition_key: 'loan_direction',
                condition_value: rule.condition_value,
            },
            select: { id: true },
        });
        if (exists) {
            continue;
        }
        await db.postingRule.create({
            data: {
                tenant_id: tenantId,
                event_type: rule.event_type,
                condition_key: 'loan_direction',
                condition_value: rule.condition_value,
                debit_account_id: rule.debit_account_id,
                credit_account_id: rule.credit_account_id,
                priority: rule.priority,
                is_active: true,
            },
        });
    }
}

/**
 * Idempotently ensure default posting rules for customer payment receive/payout.
 * Receive: Dr Cash, Cr Accounts Receivable. Payout: Dr Accounts Receivable, Cr Cash.
 */
export async function ensureCustomerPaymentPostingSetup(
    db: AccountingBootstrapClient,
    tenantId: string,
) {
    const alreadyConfigured = await db.postingRule.findFirst({
        where: {
            tenant_id: tenantId,
            event_type: 'customer_payment',
            condition_key: 'payment_direction',
        },
        select: { id: true },
    });
    if (alreadyConfigured) {
        return;
    }

    const cashAccount =
        (await db.account.findFirst({
            where: { tenant_id: tenantId, name: 'Cash in Hand' },
            select: { id: true },
        })) ??
        (await db.account.findFirst({
            where: { tenant_id: tenantId, category: AccountCategory.CASH },
            orderBy: { code: 'asc' },
            select: { id: true },
        }));

    const arAccount = await db.account.findFirst({
        where: { tenant_id: tenantId, name: 'Accounts Receivable' },
        select: { id: true },
    });

    if (!cashAccount || !arAccount) {
        return;
    }

    const rules: Array<{
        condition_value: string;
        debit_account_id: string;
        credit_account_id: string;
        priority: number;
    }> = [
        {
            condition_value: 'receive',
            debit_account_id: cashAccount.id,
            credit_account_id: arAccount.id,
            priority: 10,
        },
        {
            condition_value: 'pay',
            debit_account_id: arAccount.id,
            credit_account_id: cashAccount.id,
            priority: 20,
        },
    ];

    for (const rule of rules) {
        const exists = await db.postingRule.findFirst({
            where: {
                tenant_id: tenantId,
                event_type: 'customer_payment',
                condition_key: 'payment_direction',
                condition_value: rule.condition_value,
            },
            select: { id: true },
        });
        if (exists) {
            continue;
        }
        await db.postingRule.create({
            data: {
                tenant_id: tenantId,
                event_type: 'customer_payment',
                condition_key: 'payment_direction',
                condition_value: rule.condition_value,
                debit_account_id: rule.debit_account_id,
                credit_account_id: rule.credit_account_id,
                priority: rule.priority,
                is_active: true,
            },
        });
    }
}