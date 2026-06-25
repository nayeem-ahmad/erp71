const { AccountCategory, AccountType } = require('./accounting.constants.js');

const DEFAULT_ACCOUNTING_TEMPLATE = [
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
			{
				name: 'Loans Receivable',
				accounts: [
					{
						name: 'Loans Receivable',
						code: '1030',
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
		],
	},
];

async function bootstrapDefaultAccountingForTenant(db, tenantId) {
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

	const accountByName = new Map(accounts.map((account) => [account.name, account.id]));
	const cashId = accountByName.get('Cash in Hand');
	const bankId = accountByName.get('Main Bank Account');
	const salesRevenueId = accountByName.get('Sales Revenue');
	const purchasePayableId = accountByName.get('Purchase Payable');
	const expenseId = accountByName.get('General Operating Expense');

	const defaultRules = [
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
			event_type: 'expense',
			condition_key: 'payment_mode',
			condition_value: 'cash',
			debit_account_id: expenseId,
			credit_account_id: cashId,
			priority: 10,
		},
		{
			event_type: 'expense',
			condition_key: 'payment_mode',
			condition_value: 'bank',
			debit_account_id: expenseId,
			credit_account_id: bankId,
			priority: 20,
		},
		{
			event_type: 'expense',
			condition_key: 'none',
			condition_value: null,
			debit_account_id: expenseId,
			credit_account_id: cashId,
			priority: 100,
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

	await ensureLoanPostingSetup(db, tenantId);
}

async function ensureLoanPostingSetup(db, tenantId) {
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
			code: '1030',
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
		return;
	}

	const loanRules = [
		{
			event_type: 'loan_disbursement',
			condition_value: 'PAYABLE',
			debit_account_id: cashAccount.id,
			credit_account_id: loanPayable.id,
			priority: 10,
		},
		{
			event_type: 'loan_disbursement',
			condition_value: 'RECEIVABLE',
			debit_account_id: loanReceivable.id,
			credit_account_id: cashAccount.id,
			priority: 20,
		},
		{
			event_type: 'loan_repayment',
			condition_value: 'PAYABLE',
			debit_account_id: loanPayable.id,
			credit_account_id: cashAccount.id,
			priority: 10,
		},
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

async function ensureCustomerPaymentPostingSetup(db, tenantId) {
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

	const rules = [
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

module.exports = {
	DEFAULT_ACCOUNTING_TEMPLATE,
	bootstrapDefaultAccountingForTenant,
	ensureLoanPostingSetup,
	ensureCustomerPaymentPostingSetup,
};