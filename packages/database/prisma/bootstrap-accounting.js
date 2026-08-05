const { AccountCategory, AccountType } = require('./accounting.constants.js');
const { nextAccountCode, nextGroupCode, nextSubgroupCode } = require('./account-code.js');

const DEFAULT_ACCOUNTING_TEMPLATE = [
	{
		name: 'Current Assets',
		code: '11',
		type: AccountType.ASSET,
		subgroups: [
			{
				name: 'Cash and Bank',
				code: '1101',
				accounts: [
					{
						name: 'Cash in Hand',
						code: '110101',
						type: AccountType.ASSET,
						category: AccountCategory.CASH,
					},
					{
						name: 'Main Bank Account',
						code: '110102',
						type: AccountType.ASSET,
						category: AccountCategory.BANK,
					},
					{
						name: 'bKash Account',
						code: '110103',
						type: AccountType.ASSET,
						category: AccountCategory.CASH,
					},
					{
						name: 'Nagad Account',
						code: '110104',
						type: AccountType.ASSET,
						category: AccountCategory.CASH,
					},
				],
			},
			{
				name: 'Receivables',
				code: '1102',
				accounts: [
					{
						name: 'Accounts Receivable',
						code: '110201',
						type: AccountType.ASSET,
						category: AccountCategory.GENERAL,
						party_type: 'CUSTOMER',
					},
					{
						name: 'Staff Advances',
						code: '110202',
						type: AccountType.ASSET,
						category: AccountCategory.GENERAL,
					},
				],
			},
			{
				name: 'Loans Receivable',
				code: '1103',
				accounts: [
					{
						name: 'Loans Receivable',
						code: '110301',
						type: AccountType.ASSET,
						category: AccountCategory.GENERAL,
					},
				],
			},
			{
				name: 'Inter-Branch Clearing',
				code: '1104',
				accounts: [
					{
						name: 'Due from Branches',
						code: '110401',
						type: AccountType.ASSET,
						category: AccountCategory.GENERAL,
					},
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
					{
						name: 'Fixed Assets',
						code: '120101',
						type: AccountType.ASSET,
						category: AccountCategory.GENERAL,
					},
					{
						name: 'Accumulated Depreciation',
						code: '120102',
						type: AccountType.ASSET,
						category: AccountCategory.GENERAL,
					},
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
				name: 'Trade Payables',
				code: '2101',
				accounts: [
					{
						name: 'Purchase Payable',
						code: '210101',
						type: AccountType.LIABILITY,
						category: AccountCategory.GENERAL,
						party_type: 'SUPPLIER',
					},
				],
			},
			{
				name: 'Loans Payable',
				code: '2102',
				accounts: [
					{
						name: 'Loans Payable',
						code: '210201',
						type: AccountType.LIABILITY,
						category: AccountCategory.GENERAL,
					},
				],
			},
			{
				name: 'Payroll',
				code: '2103',
				accounts: [
					{
						name: 'Salary Payable',
						code: '210301',
						type: AccountType.LIABILITY,
						category: AccountCategory.GENERAL,
						party_type: 'EMPLOYEE',
					},
				],
			},
			{
				name: 'Inter-Branch Clearing',
				code: '2104',
				accounts: [
					{
						name: 'Due to Branches',
						code: '210401',
						type: AccountType.LIABILITY,
						category: AccountCategory.GENERAL,
					},
				],
			},
			{
				name: 'Investor Payable',
				code: '2105',
				accounts: [
					{
						name: 'Investor Profit Payable',
						code: '210501',
						type: AccountType.LIABILITY,
						category: AccountCategory.GENERAL,
						party_type: 'INVESTOR',
					},
				],
			},
		],
	},
	{
		name: 'Owner Equity',
		code: '31',
		type: AccountType.EQUITY,
		subgroups: [
			{
				name: 'Capital',
				code: '3101',
				accounts: [
					{
						name: "Owner's Equity",
						code: '310101',
						type: AccountType.EQUITY,
						category: AccountCategory.GENERAL,
					},
				],
			},
			{
				name: 'Investor Capital',
				code: '3102',
				accounts: [
					{
						name: 'Investor Capital',
						code: '310201',
						type: AccountType.EQUITY,
						category: AccountCategory.GENERAL,
					},
					{
						name: 'Investor Profit Distribution',
						code: '310202',
						type: AccountType.EQUITY,
						category: AccountCategory.GENERAL,
					},
				],
			},
		],
	},
	{
		name: 'Operating Revenue',
		code: '41',
		type: AccountType.REVENUE,
		subgroups: [
			{
				name: 'Sales',
				code: '4101',
				accounts: [
					{
						name: 'Sales Revenue',
						code: '410101',
						type: AccountType.REVENUE,
						category: AccountCategory.GENERAL,
					},
				],
			},
		],
	},
	{
		name: 'Operating Expenses',
		code: '51',
		type: AccountType.EXPENSE,
		subgroups: [
			{
				name: 'Cost of Sales',
				code: '5101',
				accounts: [
					{
						name: 'Purchases',
						code: '510101',
						type: AccountType.EXPENSE,
						category: AccountCategory.GENERAL,
					},
				],
			},
			{
				name: 'General Expenses',
				code: '5102',
				accounts: [
					{
						name: 'General Operating Expense',
						code: '510201',
						type: AccountType.EXPENSE,
						category: AccountCategory.GENERAL,
					},
					{
						name: 'Depreciation Expense',
						code: '510203',
						type: AccountType.EXPENSE,
						category: AccountCategory.GENERAL,
					},
					{
						name: 'Salary & Wages',
						code: '510202',
						type: AccountType.EXPENSE,
						category: AccountCategory.GENERAL,
					},
				],
			},
		],
	},
];

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
const DEFAULT_POSTING_RULES = [
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
	{ event_type: 'depreciation', condition_key: 'none', condition_value: null, debit_account: 'Depreciation Expense', credit_account: 'Accumulated Depreciation', priority: 10 },
	{ event_type: 'asset_acquisition', condition_key: 'payment_mode', condition_value: 'cash', debit_account: 'Fixed Assets', credit_account: 'Cash in Hand', priority: 10 },
	{ event_type: 'asset_acquisition', condition_key: 'payment_mode', condition_value: 'bank', debit_account: 'Fixed Assets', credit_account: 'Main Bank Account', priority: 20 },
	{ event_type: 'asset_acquisition', condition_key: 'payment_mode', condition_value: 'bkash', debit_account: 'Fixed Assets', credit_account: 'bKash Account', priority: 30 },
	{ event_type: 'asset_acquisition', condition_key: 'payment_mode', condition_value: 'nagad', debit_account: 'Fixed Assets', credit_account: 'Nagad Account', priority: 40 },
	{ event_type: 'fund_transfer', condition_key: 'transfer_scope', condition_value: 'initiate', debit_account: 'Due from Branches', credit_account: 'Cash in Hand', priority: 10 },
	{ event_type: 'fund_transfer', condition_key: 'transfer_scope', condition_value: 'receive', debit_account: 'Cash in Hand', credit_account: 'Due to Branches', priority: 20 },
	{ event_type: 'customer_payment', condition_key: 'payment_direction', condition_value: 'receive', debit_account: 'Cash in Hand', credit_account: 'Accounts Receivable', priority: 10 },
	{ event_type: 'customer_payment', condition_key: 'payment_direction', condition_value: 'pay', debit_account: 'Accounts Receivable', credit_account: 'Cash in Hand', priority: 20 },
	{ event_type: 'loan_disbursement', condition_key: 'loan_direction', condition_value: 'PAYABLE', debit_account: 'Cash in Hand', credit_account: 'Loans Payable', priority: 10 },
	{ event_type: 'loan_disbursement', condition_key: 'loan_direction', condition_value: 'RECEIVABLE', debit_account: 'Loans Receivable', credit_account: 'Cash in Hand', priority: 20 },
	{ event_type: 'loan_repayment', condition_key: 'loan_direction', condition_value: 'PAYABLE', debit_account: 'Loans Payable', credit_account: 'Cash in Hand', priority: 10 },
	{ event_type: 'loan_repayment', condition_key: 'loan_direction', condition_value: 'RECEIVABLE', debit_account: 'Cash in Hand', credit_account: 'Loans Receivable', priority: 20 },
	{ event_type: 'investor_contribution', condition_key: 'payment_mode', condition_value: 'cash', debit_account: 'Cash in Hand', credit_account: 'Investor Capital', priority: 10 },
	{ event_type: 'investor_contribution', condition_key: 'payment_mode', condition_value: 'bank', debit_account: 'Main Bank Account', credit_account: 'Investor Capital', priority: 20 },
	{ event_type: 'investor_contribution', condition_key: 'payment_mode', condition_value: 'bkash', debit_account: 'bKash Account', credit_account: 'Investor Capital', priority: 30 },
	{ event_type: 'investor_contribution', condition_key: 'payment_mode', condition_value: 'nagad', debit_account: 'Nagad Account', credit_account: 'Investor Capital', priority: 40 },
	{ event_type: 'investor_withdrawal', condition_key: 'payment_mode', condition_value: 'cash', debit_account: 'Investor Capital', credit_account: 'Cash in Hand', priority: 10 },
	{ event_type: 'investor_withdrawal', condition_key: 'payment_mode', condition_value: 'bank', debit_account: 'Investor Capital', credit_account: 'Main Bank Account', priority: 20 },
	{ event_type: 'investor_withdrawal', condition_key: 'payment_mode', condition_value: 'bkash', debit_account: 'Investor Capital', credit_account: 'bKash Account', priority: 30 },
	{ event_type: 'investor_withdrawal', condition_key: 'payment_mode', condition_value: 'nagad', debit_account: 'Investor Capital', credit_account: 'Nagad Account', priority: 40 },
	{ event_type: 'investor_profit_accrual', condition_key: 'none', condition_value: null, debit_account: 'Investor Profit Distribution', credit_account: 'Investor Profit Payable', priority: 10 },
	{ event_type: 'investor_profit_payout', condition_key: 'payment_mode', condition_value: 'cash', debit_account: 'Investor Profit Payable', credit_account: 'Cash in Hand', priority: 10 },
	{ event_type: 'investor_profit_payout', condition_key: 'payment_mode', condition_value: 'bank', debit_account: 'Investor Profit Payable', credit_account: 'Main Bank Account', priority: 20 },
	{ event_type: 'investor_profit_payout', condition_key: 'payment_mode', condition_value: 'bkash', debit_account: 'Investor Profit Payable', credit_account: 'bKash Account', priority: 30 },
	{ event_type: 'investor_profit_payout', condition_key: 'payment_mode', condition_value: 'nagad', debit_account: 'Investor Profit Payable', credit_account: 'Nagad Account', priority: 40 },
	{ event_type: 'cash_transaction', condition_key: 'reason_type', condition_value: 'PAYOUT', debit_account: 'General Operating Expense', credit_account: 'Cash in Hand', priority: 10 },
	{ event_type: 'cash_transaction', condition_key: 'reason_type', condition_value: 'LOAN', debit_account: 'Staff Advances', credit_account: 'Cash in Hand', priority: 20 },
	{ event_type: 'salary_accrual', condition_key: 'none', condition_value: null, debit_account: 'Salary & Wages', credit_account: 'Salary Payable', priority: 10 },
	{ event_type: 'salary_payment', condition_key: 'payment_mode', condition_value: 'cash', debit_account: 'Salary Payable', credit_account: 'Cash in Hand', priority: 10 },
	{ event_type: 'salary_payment', condition_key: 'payment_mode', condition_value: 'bank', debit_account: 'Salary Payable', credit_account: 'Main Bank Account', priority: 20 },
	{ event_type: 'salary_payment', condition_key: 'payment_mode', condition_value: 'bkash', debit_account: 'Salary Payable', credit_account: 'bKash Account', priority: 30 },
	{ event_type: 'salary_payment', condition_key: 'payment_mode', condition_value: 'nagad', debit_account: 'Salary Payable', credit_account: 'Nagad Account', priority: 40 },

	// ── DELIBERATELY ABSENT: fund_movement, inventory_adjustment ─────────────
	// Under periodic inventory these events have no journal entry. Adding a
	// condition_key:'none' rule here is worse than adding nothing, because
	// autoPostFromRules FALLS BACK to it - which is what posted Dr Main Bank /
	// Cr Cash in Hand for every warehouse transfer. See posting-contract.spec.ts.
];

/**
 * The template's pinned code if it is still free and still sits under the parent
 * we actually resolved, otherwise the next free slot. See the .ts twin.
 */
function resolveTemplateCode(preferred, parentCode, takenCodes, allocate) {
	const fitsParent = parentCode === null || preferred.startsWith(parentCode);
	if (fitsParent && !takenCodes.includes(preferred)) {
		return preferred;
	}
	return allocate(takenCodes);
}

async function upsertTemplateGroup(db, tenantId, name, type, preferredCode) {
	const existing = await db.accountGroup.findUnique({
		where: { tenant_id_name: { tenant_id: tenantId, name } },
		select: { code: true },
	});

	const code =
		existing?.code ||
		resolveTemplateCode(
			preferredCode,
			null,
			(
				await db.accountGroup.findMany({
					where: { tenant_id: tenantId },
					select: { code: true },
				})
			).map((row) => row.code),
			(taken) => nextGroupCode(type, taken),
		);

	return db.accountGroup.upsert({
		where: { tenant_id_name: { tenant_id: tenantId, name } },
		update: { type },
		create: { tenant_id: tenantId, name, code, type },
	});
}

async function upsertTemplateSubgroup(db, tenantId, group, name, preferredCode) {
	const existing = await db.accountSubgroup.findUnique({
		where: { group_id_name: { group_id: group.id, name } },
		select: { code: true },
	});

	const code =
		existing?.code ||
		resolveTemplateCode(
			preferredCode,
			group.code,
			(
				await db.accountSubgroup.findMany({
					where: { tenant_id: tenantId },
					select: { code: true },
				})
			).map((row) => row.code),
			(taken) => nextSubgroupCode(group.code, taken),
		);

	return db.accountSubgroup.upsert({
		where: { group_id_name: { group_id: group.id, name } },
		update: {},
		create: { tenant_id: tenantId, group_id: group.id, name, code },
	});
}

/**
 * Every caller re-parents its account under the template subgroup, so a code
 * stranded by a tenant's own move has to be reissued rather than reused.
 */
async function resolveTemplateAccountCode(db, tenantId, name, group, subgroup, preferredCode) {
	const existing = await db.account.findUnique({
		where: { tenant_id_name: { tenant_id: tenantId, name } },
		select: { code: true },
	});

	if (existing?.code && existing.code.startsWith(subgroup.code)) {
		return existing.code;
	}

	return resolveTemplateCode(
		preferredCode,
		subgroup.code,
		(
			await db.account.findMany({
				where: { tenant_id: tenantId },
				select: { code: true },
			})
		).map((row) => row.code),
		(taken) => nextAccountCode(group.code, subgroup.code, taken),
	);
}

async function bootstrapDefaultAccountingForTenant(db, tenantId) {
	for (const groupDefinition of DEFAULT_ACCOUNTING_TEMPLATE) {
		const group = await upsertTemplateGroup(
			db,
			tenantId,
			groupDefinition.name,
			groupDefinition.type,
			groupDefinition.code,
		);

		for (const subgroupDefinition of groupDefinition.subgroups) {
			const subgroup = await upsertTemplateSubgroup(
				db,
				tenantId,
				group,
				subgroupDefinition.name,
				subgroupDefinition.code,
			);

			for (const accountDefinition of subgroupDefinition.accounts) {
				const accountCode = await resolveTemplateAccountCode(
					db,
					tenantId,
					accountDefinition.name,
					group,
					subgroup,
					accountDefinition.code,
				);

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
						code: accountCode,
						type: accountDefinition.type,
						category: accountDefinition.category,
						party_type: accountDefinition.party_type ?? null,
					},
					create: {
						tenant_id: tenantId,
						group_id: group.id,
						subgroup_id: subgroup.id,
						name: accountDefinition.name,
						code: accountCode,
						type: accountDefinition.type,
						category: accountDefinition.category,
						party_type: accountDefinition.party_type ?? null,
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

	await ensureInterBranchAccounts(db, tenantId);
}

/**
 * Idempotently ensure inter-branch clearing accounts exist for a tenant.
 */
async function ensureInterBranchAccounts(db, tenantId) {
	// Shares the template helpers so a tenant that reaches this path first --
	// fund-transfers calls it directly -- still gets codes allocated, and gets
	// the same ones the template would have handed out.
	const assetGroup = await upsertTemplateGroup(db, tenantId, 'Current Assets', AccountType.ASSET, '11');
	const liabilityGroup = await upsertTemplateGroup(
		db,
		tenantId,
		'Current Liabilities',
		AccountType.LIABILITY,
		'21',
	);

	const dueFromSubgroup = await upsertTemplateSubgroup(
		db,
		tenantId,
		assetGroup,
		'Inter-Branch Clearing',
		'1104',
	);
	const dueToSubgroup = await upsertTemplateSubgroup(
		db,
		tenantId,
		liabilityGroup,
		'Inter-Branch Clearing',
		'2104',
	);

	const dueFromCode = await resolveTemplateAccountCode(
		db,
		tenantId,
		'Due from Branches',
		assetGroup,
		dueFromSubgroup,
		'110401',
	);

	await db.account.upsert({
		where: { tenant_id_name: { tenant_id: tenantId, name: 'Due from Branches' } },
		update: {
			group_id: assetGroup.id,
			subgroup_id: dueFromSubgroup.id,
			code: dueFromCode,
			type: AccountType.ASSET,
			category: AccountCategory.GENERAL,
		},
		create: {
			tenant_id: tenantId,
			group_id: assetGroup.id,
			subgroup_id: dueFromSubgroup.id,
			name: 'Due from Branches',
			code: dueFromCode,
			type: AccountType.ASSET,
			category: AccountCategory.GENERAL,
		},
	});

	const dueToCode = await resolveTemplateAccountCode(
		db,
		tenantId,
		'Due to Branches',
		liabilityGroup,
		dueToSubgroup,
		'210401',
	);

	await db.account.upsert({
		where: { tenant_id_name: { tenant_id: tenantId, name: 'Due to Branches' } },
		update: {
			group_id: liabilityGroup.id,
			subgroup_id: dueToSubgroup.id,
			code: dueToCode,
			type: AccountType.LIABILITY,
			category: AccountCategory.GENERAL,
		},
		create: {
			tenant_id: tenantId,
			group_id: liabilityGroup.id,
			subgroup_id: dueToSubgroup.id,
			name: 'Due to Branches',
			code: dueToCode,
			type: AccountType.LIABILITY,
			category: AccountCategory.GENERAL,
		},
	});
}

module.exports = {
	DEFAULT_ACCOUNTING_TEMPLATE,
	DEFAULT_POSTING_RULES,
	bootstrapDefaultAccountingForTenant,
	ensureInterBranchAccounts,
};