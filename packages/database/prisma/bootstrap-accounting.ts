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
            {
                name: 'Payroll',
                accounts: [
                    {
                        name: 'Salary & Wages Expense',
                        code: '5020',
                        type: AccountType.EXPENSE,
                        category: AccountCategory.GENERAL,
                    },
                ],
            },
        ],
    },
];

type AccountingBootstrapClient = PrismaClient | Prisma.TransactionClient;

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
    const cashId = accountByName.get('Cash in Hand');
    const bankId = accountByName.get('Main Bank Account');
    const salesRevenueId = accountByName.get('Sales Revenue');
    const purchasePayableId = accountByName.get('Purchase Payable');
    const expenseId = accountByName.get('General Operating Expense');
    const salaryExpenseId = accountByName.get('Salary & Wages Expense');

    const defaultRules: Array<{
        event_type: PostingRuleEventType;
        condition_key: PostingRuleConditionKey;
        condition_value: string | null;
        debit_account_id: string | undefined;
        credit_account_id: string | undefined;
        priority: number;
    }> = [
        {
            event_type: 'sale',
            condition_key: 'payment_mode',
            condition_value: 'cash',
            debit_account_id: cashId,
            credit_account_id: salesRevenueId,
            priority: 10,
        },
        {
            event_type: 'sale',
            condition_key: 'payment_mode',
            condition_value: 'bank',
            debit_account_id: bankId,
            credit_account_id: salesRevenueId,
            priority: 20,
        },
        {
            event_type: 'sale_return',
            condition_key: 'payment_mode',
            condition_value: 'cash',
            debit_account_id: salesRevenueId,
            credit_account_id: cashId,
            priority: 10,
        },
        {
            event_type: 'sale_return',
            condition_key: 'payment_mode',
            condition_value: 'bank',
            debit_account_id: salesRevenueId,
            credit_account_id: bankId,
            priority: 20,
        },
        {
            event_type: 'purchase',
            condition_key: 'payment_mode',
            condition_value: 'cash',
            debit_account_id: expenseId,
            credit_account_id: cashId,
            priority: 10,
        },
        {
            event_type: 'purchase',
            condition_key: 'payment_mode',
            condition_value: 'bank',
            debit_account_id: expenseId,
            credit_account_id: bankId,
            priority: 20,
        },
        {
            event_type: 'purchase',
            condition_key: 'payment_mode',
            condition_value: 'credit',
            debit_account_id: expenseId,
            credit_account_id: purchasePayableId,
            priority: 30,
        },
        {
            event_type: 'purchase_return',
            condition_key: 'none',
            condition_value: null,
            debit_account_id: purchasePayableId,
            credit_account_id: expenseId,
            priority: 100,
        },
        {
            event_type: 'inventory_adjustment',
            condition_key: 'none',
            condition_value: null,
            debit_account_id: expenseId,
            credit_account_id: cashId,
            priority: 100,
        },
        {
            event_type: 'fund_movement',
            condition_key: 'none',
            condition_value: null,
            debit_account_id: bankId,
            credit_account_id: cashId,
            priority: 100,
        },
        {
            event_type: 'salary_payment',
            condition_key: 'payment_mode',
            condition_value: 'cash',
            debit_account_id: salaryExpenseId,
            credit_account_id: cashId,
            priority: 10,
        },
        {
            event_type: 'salary_payment',
            condition_key: 'payment_mode',
            condition_value: 'bank',
            debit_account_id: salaryExpenseId,
            credit_account_id: bankId,
            priority: 20,
        },
    ];

    for (const rule of defaultRules) {
        if (!rule.debit_account_id || !rule.credit_account_id) {
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
                    debit_account_id: rule.debit_account_id,
                    credit_account_id: rule.credit_account_id,
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
                debit_account_id: rule.debit_account_id,
                credit_account_id: rule.credit_account_id,
                priority: rule.priority,
                is_active: true,
            },
        });
    }
}