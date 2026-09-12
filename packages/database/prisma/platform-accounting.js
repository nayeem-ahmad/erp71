/**
 * CommonJS mirror of `platform-accounting.ts`.
 *
 * `@erp71/database` ships `index.js` as its `main` and `index.ts` as its
 * `types`, so every sibling here exists twice: the `.ts` is what typechecks and
 * the `.js` is what Node (and Jest, whose moduleFileExtensions puts `js` first)
 * actually loads. Keep the two in step — `platform-accounting.spec.ts` asserts
 * the invariants that matter if they drift.
 */
const { AccountCategory, AccountType } = require('./accounting.constants.js');
const { applyAccountingTemplate } = require('./bootstrap-accounting.js');

const PLATFORM_ACCOUNT = {
	CASH: 'Cash in Hand',
	BANK: 'Main Bank Account',
	BKASH: 'bKash Account',
	NAGAD: 'Nagad Account',
	GATEWAY_RECEIVABLE: 'Payment Gateway Receivable',
	SUBSCRIPTION_RECEIVABLE: 'Subscription Receivable',

	SUBSCRIPTION_REVENUE: 'Subscription Revenue',
	SETUP_FEE_REVENUE: 'Setup & Onboarding Fees',
	ADDON_REVENUE: 'Add-on Module Revenue',
	SMS_REVENUE: 'SMS Credit Revenue',
	AI_REVENUE: 'AI Credit Revenue',
	OTHER_REVENUE: 'Other Platform Revenue',
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
};

const PLATFORM_PAYMENT_ACCOUNTS = {
	CASH: PLATFORM_ACCOUNT.CASH,
	BANK: PLATFORM_ACCOUNT.BANK,
	BKASH: PLATFORM_ACCOUNT.BKASH,
	NAGAD: PLATFORM_ACCOUNT.NAGAD,
};

const PLATFORM_PAYMENT_METHODS = Object.keys(PLATFORM_PAYMENT_ACCOUNTS);

const asset = (name, code, category) => ({ name, code, type: AccountType.ASSET, category });
const liability = (name, code) => ({ name, code, type: AccountType.LIABILITY, category: AccountCategory.GENERAL });
const equity = (name, code) => ({ name, code, type: AccountType.EQUITY, category: AccountCategory.GENERAL });
const revenue = (name, code) => ({ name, code, type: AccountType.REVENUE, category: AccountCategory.GENERAL });
const expense = (name, code) => ({ name, code, type: AccountType.EXPENSE, category: AccountCategory.GENERAL });

const PLATFORM_ACCOUNTING_TEMPLATE = [
	{
		name: 'Current Assets',
		code: '11',
		type: AccountType.ASSET,
		subgroups: [
			{
				name: 'Cash and Bank',
				code: '1101',
				accounts: [
					asset(PLATFORM_ACCOUNT.CASH, '110101', AccountCategory.CASH),
					asset(PLATFORM_ACCOUNT.BANK, '110102', AccountCategory.BANK),
					asset(PLATFORM_ACCOUNT.BKASH, '110103', AccountCategory.CASH),
					asset(PLATFORM_ACCOUNT.NAGAD, '110104', AccountCategory.CASH),
				],
			},
			{
				name: 'Receivables',
				code: '1102',
				accounts: [
					asset(PLATFORM_ACCOUNT.SUBSCRIPTION_RECEIVABLE, '110201', AccountCategory.GENERAL),
					asset(PLATFORM_ACCOUNT.GATEWAY_RECEIVABLE, '110202', AccountCategory.GENERAL),
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
					asset('Computer & Office Equipment', '120101', AccountCategory.GENERAL),
					asset('Accumulated Depreciation', '120102', AccountCategory.GENERAL),
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
					liability(PLATFORM_ACCOUNT.ACCRUED_EXPENSES, '210101'),
					liability(PLATFORM_ACCOUNT.SALARY_PAYABLE, '210102'),
					liability(PLATFORM_ACCOUNT.REFERRAL_PAYABLE, '210103'),
					liability(PLATFORM_ACCOUNT.TAX_PAYABLE, '210104'),
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
					equity(PLATFORM_ACCOUNT.OWNER_CAPITAL, '310101'),
					equity(PLATFORM_ACCOUNT.RETAINED_EARNINGS, '310102'),
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
					revenue(PLATFORM_ACCOUNT.SUBSCRIPTION_REVENUE, '410101'),
					revenue(PLATFORM_ACCOUNT.ADDON_REVENUE, '410102'),
					revenue(PLATFORM_ACCOUNT.SETUP_FEE_REVENUE, '410103'),
				],
			},
			{
				name: 'Usage Revenue',
				code: '4102',
				accounts: [
					revenue(PLATFORM_ACCOUNT.SMS_REVENUE, '410201'),
					revenue(PLATFORM_ACCOUNT.AI_REVENUE, '410202'),
				],
			},
			{
				name: 'Other Revenue',
				code: '4103',
				accounts: [
					revenue(PLATFORM_ACCOUNT.OTHER_REVENUE, '410301'),
					revenue(PLATFORM_ACCOUNT.REFUNDS, '410302'),
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
					expense(PLATFORM_ACCOUNT.SERVER_HOSTING, '510101'),
					expense(PLATFORM_ACCOUNT.DOMAIN_SSL, '510102'),
					expense(PLATFORM_ACCOUNT.EMAIL_SERVICE, '510103'),
					expense(PLATFORM_ACCOUNT.THIRD_PARTY_SOFTWARE, '510104'),
				],
			},
			{
				name: 'Usage Costs',
				code: '5102',
				accounts: [
					expense(PLATFORM_ACCOUNT.SMS_GATEWAY, '510201'),
					expense(PLATFORM_ACCOUNT.AI_API, '510202'),
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
					expense(PLATFORM_ACCOUNT.SALARIES, '520101'),
					expense(PLATFORM_ACCOUNT.CONTRACTOR, '520102'),
				],
			},
			{
				name: 'Sales & Marketing',
				code: '5202',
				accounts: [
					expense(PLATFORM_ACCOUNT.MARKETING, '520201'),
					expense(PLATFORM_ACCOUNT.REFERRAL_COMMISSION, '520202'),
				],
			},
			{
				name: 'Administration',
				code: '5203',
				accounts: [
					expense(PLATFORM_ACCOUNT.OFFICE_RENT, '520301'),
					expense(PLATFORM_ACCOUNT.UTILITIES, '520302'),
					expense(PLATFORM_ACCOUNT.PROFESSIONAL_FEES, '520303'),
					expense(PLATFORM_ACCOUNT.TRAVEL, '520304'),
					expense(PLATFORM_ACCOUNT.PAYMENT_GATEWAY_CHARGES, '520305'),
					expense(PLATFORM_ACCOUNT.BANK_CHARGES, '520306'),
					expense(PLATFORM_ACCOUNT.OTHER_EXPENSE, '520307'),
				],
			},
		],
	},
];

const DEFAULT_PLATFORM_EXPENSE_CATEGORIES = [
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

async function seedPlatformExpenseCategories(db) {
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

async function bootstrapPlatformAccounting(db, tenantId) {
	await applyAccountingTemplate(db, tenantId, PLATFORM_ACCOUNTING_TEMPLATE);
}

module.exports = {
	PLATFORM_ACCOUNT,
	PLATFORM_ACCOUNTING_TEMPLATE,
	PLATFORM_PAYMENT_ACCOUNTS,
	PLATFORM_PAYMENT_METHODS,
	DEFAULT_PLATFORM_EXPENSE_CATEGORIES,
	seedPlatformExpenseCategories,
	bootstrapPlatformAccounting,
};
