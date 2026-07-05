import { z } from 'zod';

// ---------------------------------------------------------------------------
// Navigation layout (platform-admin editable tree)
// ---------------------------------------------------------------------------

export const NavScope = {
  TENANT: 'tenant',
  PLATFORM_ADMIN: 'platform_admin',
} as const;
export type NavScope = (typeof NavScope)[keyof typeof NavScope];

export const NAV_SCOPES = Object.values(NavScope);

export const NavNodeKind = {
  MODULE: 'module',
  SUBGROUP: 'subgroup',
  LINK: 'link',
} as const;
export type NavNodeKind = (typeof NavNodeKind)[keyof typeof NavNodeKind];

export interface NavRegistryEntry {
  id: string;
  kind: NavNodeKind;
  icon: string;
  labelKey: string;
  href?: string;
  exact?: boolean;
  advancedOnly?: boolean;
  premiumOnly?: boolean;
  soon?: boolean;
  /** Used by Sidebar permission / feature filters */
  moduleKey?: string;
  platformFeature?: 'help' | 'support';
  billingGated?: boolean;
  teamGated?: boolean;
}

export interface NavLayoutNode {
  id: string;
  parentId: string | null;
  sortOrder: number;
  visible: boolean;
}

export const navLayoutNodeSchema = z.object({
  id: z.string().min(1),
  parentId: z.string().nullable(),
  sortOrder: z.number().int().min(0),
  visible: z.boolean(),
});

export const navLayoutSchema = z.array(navLayoutNodeSchema);

export const NAV_REGISTRY: Record<string, NavRegistryEntry> = {
  dashboard: { id: 'dashboard', kind: 'module', icon: 'LayoutDashboard', labelKey: 'sidebar.modules.dashboard', href: '/dashboard' },
  sales: { id: 'sales', kind: 'module', icon: 'ShoppingBag', labelKey: 'sidebar.modules.sales', moduleKey: 'sales' },
  'sales.overview': { id: 'sales.overview', kind: 'link', icon: 'LayoutDashboard', labelKey: 'sidebar.items.overview', href: '/sales', exact: true },
  'sales.pos': { id: 'sales.pos', kind: 'link', icon: 'ShoppingCart', labelKey: 'sidebar.items.pos', href: '/sales/pos' },
  'sales.list': { id: 'sales.list', kind: 'link', icon: 'TrendingUp', labelKey: 'sidebar.items.sales', href: '/sales/list' },
  'sales.new': { id: 'sales.new', kind: 'link', icon: 'FileText', labelKey: 'sidebar.items.newSalesEntry', href: '/sales/new' },
  'sales.cashier-sessions': { id: 'sales.cashier-sessions', kind: 'link', icon: 'Clock', labelKey: 'sidebar.items.cashierSessions', href: '/sales/cashier-sessions' },
  'sales.receivables': { id: 'sales.receivables', kind: 'subgroup', icon: 'Wallet', labelKey: 'sales.hub.receivables' },
  'sales.receivables.customer-payments': { id: 'sales.receivables.customer-payments', kind: 'link', icon: 'Wallet', labelKey: 'sidebar.items.customerPayment', href: '/sales/customer-payments' },
  'sales.receivables.customer-ledger': { id: 'sales.receivables.customer-ledger', kind: 'link', icon: 'BookOpen', labelKey: 'sidebar.items.customerLedger', href: '/sales/customer-ledger' },
  'sales.receivables.due-aging': { id: 'sales.receivables.due-aging', kind: 'link', icon: 'Clock', labelKey: 'sidebar.items.dueAging', href: '/sales/customers/reports/due-aging' },
  'sales.order-flow': { id: 'sales.order-flow', kind: 'subgroup', icon: 'ClipboardList', labelKey: 'sales.hub.orderFlow' },
  'sales.order-flow.quotes': { id: 'sales.order-flow.quotes', kind: 'link', icon: 'FileText', labelKey: 'sidebar.items.salesQuotations', href: '/sales/quotes' },
  'sales.order-flow.orders': { id: 'sales.order-flow.orders', kind: 'link', icon: 'ClipboardList', labelKey: 'sidebar.items.salesOrders', href: '/sales/orders' },
  'sales.order-flow.delivery': { id: 'sales.order-flow.delivery', kind: 'link', icon: 'MapPin', labelKey: 'sidebar.items.delivery', href: '/sales/delivery' },
  'sales.order-flow.returns': { id: 'sales.order-flow.returns', kind: 'link', icon: 'ArrowLeftRight', labelKey: 'sidebar.items.salesReturns', href: '/sales/returns' },
  'sales.order-flow.warranty-claims': { id: 'sales.order-flow.warranty-claims', kind: 'link', icon: 'ShieldCheck', labelKey: 'sidebar.items.warrantyClaims', href: '/sales/warranty-claims' },
  'sales.storefront': { id: 'sales.storefront', kind: 'subgroup', icon: 'Globe', labelKey: 'sidebar.modules.storefront' },
  'sales.storefront.orders': { id: 'sales.storefront.orders', kind: 'link', icon: 'ShoppingBag', labelKey: 'sidebar.items.storefrontOrders', href: '/storefront', exact: true },
  'sales.storefront.settings': { id: 'sales.storefront.settings', kind: 'link', icon: 'Settings', labelKey: 'sidebar.items.storefrontSettings', href: '/storefront/settings' },
  'sales.customers': { id: 'sales.customers', kind: 'subgroup', icon: 'Users', labelKey: 'sales.hub.customersCrm' },
  'sales.customers.list': { id: 'sales.customers.list', kind: 'link', icon: 'Users', labelKey: 'sidebar.items.customers', href: '/sales/customers' },
  'sales.customers.loyalty': { id: 'sales.customers.loyalty', kind: 'link', icon: 'Gift', labelKey: 'sidebar.items.loyaltyPoints', href: '/sales/loyalty' },
  'sales.reports': { id: 'sales.reports', kind: 'subgroup', icon: 'BarChart3', labelKey: 'sales.hub.reports', advancedOnly: true },
  'sales.reports.summary': { id: 'sales.reports.summary', kind: 'link', icon: 'TrendingUp', labelKey: 'sidebar.items.salesSummary', href: '/sales/reports/summary', advancedOnly: true },
  'sales.reports.products': { id: 'sales.reports.products', kind: 'link', icon: 'Package', labelKey: 'sidebar.items.salesByProduct', href: '/sales/reports/products', advancedOnly: true },
  'sales.reports.consolidated': { id: 'sales.reports.consolidated', kind: 'link', icon: 'BarChart3', labelKey: 'sidebar.items.consolidated', href: '/sales/reports/consolidated', advancedOnly: true },
  'sales.reports.branch-report': { id: 'sales.reports.branch-report', kind: 'link', icon: 'BarChart3', labelKey: 'sidebar.items.branchReport', href: '/sales/reports/branch-report', advancedOnly: true },
  'sales.setup': { id: 'sales.setup', kind: 'subgroup', icon: 'Settings', labelKey: 'sales.hub.setup' },
  'sales.setup.customer-groups': { id: 'sales.setup.customer-groups', kind: 'link', icon: 'FolderTree', labelKey: 'sidebar.items.customerGroups', href: '/sales/customer-groups' },
  'sales.setup.price-lists': { id: 'sales.setup.price-lists', kind: 'link', icon: 'Tag', labelKey: 'sidebar.items.priceLists', href: '/sales/price-lists' },
  'sales.setup.territories': { id: 'sales.setup.territories', kind: 'link', icon: 'MapPin', labelKey: 'sidebar.items.territories', href: '/sales/territories' },
  'sales.setup.settings': { id: 'sales.setup.settings', kind: 'link', icon: 'Cog', labelKey: 'sidebar.items.salesSettings', href: '/settings/sales' },

  purchase: { id: 'purchase', kind: 'module', icon: 'Truck', labelKey: 'sidebar.modules.purchase', moduleKey: 'purchase' },
  'purchase.overview': { id: 'purchase.overview', kind: 'link', icon: 'LayoutDashboard', labelKey: 'sidebar.items.overview', href: '/purchases', exact: true },
  'purchase.list': { id: 'purchase.list', kind: 'link', icon: 'ClipboardList', labelKey: 'sidebar.items.purchases', href: '/purchases/list' },
  'purchase.payables': { id: 'purchase.payables', kind: 'subgroup', icon: 'Wallet', labelKey: 'purchases.hub.payables' },
  'purchase.payables.supplier-payments': { id: 'purchase.payables.supplier-payments', kind: 'link', icon: 'Wallet', labelKey: 'sidebar.items.supplierPayment', href: '/purchases/supplier-payments' },
  'purchase.payables.supplier-ledger': { id: 'purchase.payables.supplier-ledger', kind: 'link', icon: 'BookOpen', labelKey: 'sidebar.items.supplierLedger', href: '/purchases/supplier-ledger' },
  'purchase.order-flow': { id: 'purchase.order-flow', kind: 'subgroup', icon: 'ClipboardList', labelKey: 'purchases.hub.orderFlow' },
  'purchase.order-flow.orders': { id: 'purchase.order-flow.orders', kind: 'link', icon: 'FileText', labelKey: 'sidebar.items.purchaseOrders', href: '/purchases/orders' },
  'purchase.order-flow.quotations': { id: 'purchase.order-flow.quotations', kind: 'link', icon: 'FileSearch', labelKey: 'sidebar.items.purchaseQuotations', href: '/purchases/quotations' },
  'purchase.order-flow.returns': { id: 'purchase.order-flow.returns', kind: 'link', icon: 'Undo2', labelKey: 'sidebar.items.purchaseReturns', href: '/purchases/returns' },
  'purchase.reports': { id: 'purchase.reports', kind: 'subgroup', icon: 'BarChart3', labelKey: 'purchases.hub.reports', advancedOnly: true },
  'purchase.reports.summary': { id: 'purchase.reports.summary', kind: 'link', icon: 'TrendingUp', labelKey: 'sidebar.items.purchaseSummary', href: '/purchases/reports/summary', advancedOnly: true },
  'purchase.reports.by-product': { id: 'purchase.reports.by-product', kind: 'link', icon: 'Package', labelKey: 'sidebar.items.purchasesByProduct', href: '/purchases/reports/by-product', advancedOnly: true },
  'purchase.reports.by-supplier': { id: 'purchase.reports.by-supplier', kind: 'link', icon: 'Truck', labelKey: 'sidebar.items.purchasesBySupplier', href: '/purchases/reports/by-supplier', advancedOnly: true },
  'purchase.setup': { id: 'purchase.setup', kind: 'subgroup', icon: 'Settings', labelKey: 'purchases.hub.setup' },
  'purchase.setup.suppliers': { id: 'purchase.setup.suppliers', kind: 'link', icon: 'Truck', labelKey: 'sidebar.items.suppliers', href: '/purchases/suppliers' },

  accounting: { id: 'accounting', kind: 'module', icon: 'Calculator', labelKey: 'sidebar.modules.accounting', moduleKey: 'accounting' },
  'accounting.overview': { id: 'accounting.overview', kind: 'link', icon: 'LayoutDashboard', labelKey: 'sidebar.items.overview', href: '/accounting', exact: true },
  'accounting.vouchers': { id: 'accounting.vouchers', kind: 'link', icon: 'FileText', labelKey: 'accounting.links.vouchers.title', href: '/accounting/vouchers/new' },
  'accounting.vouchers-list': { id: 'accounting.vouchers-list', kind: 'link', icon: 'Receipt', labelKey: 'accounting.links.vouchersList.title', href: '/accounting/vouchers' },
  'accounting.journal': { id: 'accounting.journal', kind: 'link', icon: 'ClipboardList', labelKey: 'accounting.links.journal.title', href: '/accounting/journal' },
  'accounting.ledger': { id: 'accounting.ledger', kind: 'link', icon: 'BookOpen', labelKey: 'accounting.links.ledger.title', href: '/accounting/ledger' },
  'accounting.transactions': { id: 'accounting.transactions', kind: 'subgroup', icon: 'Wallet', labelKey: 'accounting.hub.transactions' },
  'accounting.transactions.expenses': { id: 'accounting.transactions.expenses', kind: 'link', icon: 'Receipt', labelKey: 'accounting.links.expenses.title', href: '/accounting/expenses' },
  'accounting.transactions.expense-categories': { id: 'accounting.transactions.expense-categories', kind: 'link', icon: 'FolderTree', labelKey: 'accounting.links.expenseCategories.title', href: '/accounting/expenses/categories' },
  'accounting.transactions.expense-reports': { id: 'accounting.transactions.expense-reports', kind: 'link', icon: 'BarChart3', labelKey: 'accounting.links.expenseReports.title', href: '/accounting/expenses/reports' },
  'accounting.transactions.loans': { id: 'accounting.transactions.loans', kind: 'link', icon: 'HandCoins', labelKey: 'accounting.links.loans.title', href: '/accounting/loans' },
  'accounting.reconciliation': { id: 'accounting.reconciliation', kind: 'subgroup', icon: 'GitMerge', labelKey: 'accounting.hub.reconciliation' },
  'accounting.reconciliation.posting-exceptions': { id: 'accounting.reconciliation.posting-exceptions', kind: 'link', icon: 'AlertTriangle', labelKey: 'accounting.links.postingExceptions.title', href: '/accounting/reconciliation' },
  'accounting.reconciliation.bank': { id: 'accounting.reconciliation.bank', kind: 'link', icon: 'GitMerge', labelKey: 'accounting.links.bankReconciliation.title', href: '/accounting/reconciliation/bank' },
  'accounting.reports': { id: 'accounting.reports', kind: 'subgroup', icon: 'BarChart3', labelKey: 'sidebar.sections.accountingReports' },
  'accounting.reports.pl': { id: 'accounting.reports.pl', kind: 'link', icon: 'TrendingUp', labelKey: 'accounting.links.pl.title', href: '/accounting/reports/pl' },
  'accounting.reports.balance-sheet': { id: 'accounting.reports.balance-sheet', kind: 'link', icon: 'LayoutDashboard', labelKey: 'accounting.links.balanceSheet.title', href: '/accounting/reports/balance-sheet' },
  'accounting.reports.cashbook': { id: 'accounting.reports.cashbook', kind: 'link', icon: 'BookOpen', labelKey: 'accounting.links.cashbook.title', href: '/accounting/reports/cashbook' },
  'accounting.reports.bankbook': { id: 'accounting.reports.bankbook', kind: 'link', icon: 'Landmark', labelKey: 'accounting.links.bankbook.title', href: '/accounting/reports/bankbook' },
  'accounting.reports.trial-balance': { id: 'accounting.reports.trial-balance', kind: 'link', icon: 'Scale', labelKey: 'accounting.links.trialBalance.title', href: '/accounting/reports/trial-balance' },
  'accounting.reports.comparative-pl': { id: 'accounting.reports.comparative-pl', kind: 'link', icon: 'BarChart3', labelKey: 'accounting.links.comparativePl.title', href: '/accounting/reports/comparative-pl', advancedOnly: true },
  'accounting.reports.ar-aging': { id: 'accounting.reports.ar-aging', kind: 'link', icon: 'Calculator', labelKey: 'accounting.links.arAging.title', href: '/accounting/reports/ar-aging' },
  'accounting.reports.ap-aging': { id: 'accounting.reports.ap-aging', kind: 'link', icon: 'Calculator', labelKey: 'accounting.links.apAging.title', href: '/accounting/reports/ap-aging' },
  'accounting.reports.vat-tax': { id: 'accounting.reports.vat-tax', kind: 'link', icon: 'FileText', labelKey: 'accounting.links.vatTax.title', href: '/accounting/reports/vat-tax' },
  'accounting.reports.budget-vs-actual': { id: 'accounting.reports.budget-vs-actual', kind: 'link', icon: 'Target', labelKey: 'accounting.links.budgetVsActual.title', href: '/accounting/reports/budget-vs-actual', advancedOnly: true },
  'accounting.reports.cash-flow': { id: 'accounting.reports.cash-flow', kind: 'link', icon: 'Waves', labelKey: 'accounting.links.cashFlow.title', href: '/accounting/reports/cash-flow', advancedOnly: true },
  'accounting.reports.financial-ratios': { id: 'accounting.reports.financial-ratios', kind: 'link', icon: 'Calculator', labelKey: 'accounting.links.financialRatios.title', href: '/accounting/reports/financial-ratios', advancedOnly: true },
  'accounting.setup': { id: 'accounting.setup', kind: 'subgroup', icon: 'Settings', labelKey: 'sidebar.sections.accountingSetup' },
  'accounting.setup.coa': { id: 'accounting.setup.coa', kind: 'link', icon: 'FolderTree', labelKey: 'accounting.links.coa.title', href: '/accounting/coa' },
  'accounting.setup.posting-rules': { id: 'accounting.setup.posting-rules', kind: 'link', icon: 'Settings', labelKey: 'accounting.links.postingRules.title', href: '/accounting/posting-rules' },
  'accounting.setup.fiscal-periods': { id: 'accounting.setup.fiscal-periods', kind: 'link', icon: 'Lock', labelKey: 'accounting.links.fiscalPeriods.title', href: '/accounting/fiscal-periods' },
  'accounting.setup.opening-balances': { id: 'accounting.setup.opening-balances', kind: 'link', icon: 'Upload', labelKey: 'accounting.links.openingBalances.title', href: '/accounting/opening-balances' },
  'accounting.setup.cost-centers': { id: 'accounting.setup.cost-centers', kind: 'link', icon: 'Building2', labelKey: 'accounting.links.costCenters.title', href: '/accounting/cost-centers' },
  'accounting.setup.fixed-assets': { id: 'accounting.setup.fixed-assets', kind: 'link', icon: 'Cpu', labelKey: 'accounting.links.fixedAssets.title', href: '/accounting/fixed-assets' },
  'accounting.setup.recurring-journals': { id: 'accounting.setup.recurring-journals', kind: 'link', icon: 'RefreshCw', labelKey: 'accounting.links.recurringJournals.title', href: '/accounting/recurring-journals' },
  'accounting.setup.recurring-vouchers': { id: 'accounting.setup.recurring-vouchers', kind: 'link', icon: 'RefreshCw', labelKey: 'accounting.links.recurringVouchers.title', href: '/accounting/recurring-vouchers' },
  'accounting.setup.voucher-templates': { id: 'accounting.setup.voucher-templates', kind: 'link', icon: 'Copy', labelKey: 'accounting.links.voucherTemplates.title', href: '/accounting/voucher-templates' },

  inventory: { id: 'inventory', kind: 'module', icon: 'Package', labelKey: 'sidebar.modules.inventory', moduleKey: 'inventory' },
  'inventory.overview': { id: 'inventory.overview', kind: 'link', icon: 'LayoutDashboard', labelKey: 'sidebar.items.overview', href: '/inventory', exact: true },
  'inventory.products': { id: 'inventory.products', kind: 'link', icon: 'Package', labelKey: 'sidebar.items.products', href: '/inventory/products' },
  'inventory.transfers': { id: 'inventory.transfers', kind: 'link', icon: 'Boxes', labelKey: 'sidebar.items.transfers', href: '/inventory/transfers' },
  'inventory.stock-takes': { id: 'inventory.stock-takes', kind: 'link', icon: 'ClipboardCheck', labelKey: 'sidebar.items.stockTakes', href: '/inventory/stock-takes' },
  'inventory.shrinkage': { id: 'inventory.shrinkage', kind: 'link', icon: 'AlertTriangle', labelKey: 'sidebar.items.shrinkage', href: '/inventory/shrinkage' },
  'inventory.labels': { id: 'inventory.labels', kind: 'link', icon: 'Tag', labelKey: 'sidebar.items.printLabels', href: '/inventory/labels' },
  'inventory.reports': { id: 'inventory.reports', kind: 'subgroup', icon: 'BarChart3', labelKey: 'inventory.hub.reports' },
  'inventory.reports.ledger': { id: 'inventory.reports.ledger', kind: 'link', icon: 'BookOpen', labelKey: 'sidebar.items.stockLedger', href: '/inventory/ledger' },
  'inventory.reports.reorder': { id: 'inventory.reports.reorder', kind: 'link', icon: 'TrendingUp', labelKey: 'sidebar.items.reorderReport', href: '/inventory/reports/reorder', advancedOnly: true },
  'inventory.reports.shrinkage': { id: 'inventory.reports.shrinkage', kind: 'link', icon: 'AlertTriangle', labelKey: 'sidebar.items.shrinkageReport', href: '/inventory/reports/shrinkage', advancedOnly: true },
  'inventory.reports.valuation': { id: 'inventory.reports.valuation', kind: 'link', icon: 'Calculator', labelKey: 'sidebar.items.valuation', href: '/inventory/reports/valuation', advancedOnly: true },
  'inventory.setup': { id: 'inventory.setup', kind: 'subgroup', icon: 'Settings', labelKey: 'inventory.hub.setup' },
  'inventory.setup.brands': { id: 'inventory.setup.brands', kind: 'link', icon: 'Tag', labelKey: 'sidebar.items.brands', href: '/inventory/brands' },
  'inventory.setup.categories': { id: 'inventory.setup.categories', kind: 'link', icon: 'FolderTree', labelKey: 'sidebar.items.categories', href: '/inventory/categories' },
  'inventory.setup.settings': { id: 'inventory.setup.settings', kind: 'link', icon: 'Settings', labelKey: 'sidebar.items.inventorySettings', href: '/inventory/settings' },

  manufacturing: { id: 'manufacturing', kind: 'module', icon: 'Factory', labelKey: 'sidebar.modules.manufacturing', href: '/manufacturing', moduleKey: 'manufacturing' },

  crm: { id: 'crm', kind: 'module', icon: 'Users', labelKey: 'sidebar.modules.crm', moduleKey: 'crm' },
  'crm.overview': { id: 'crm.overview', kind: 'link', icon: 'LayoutDashboard', labelKey: 'sidebar.items.overview', href: '/crm', exact: true },
  'crm.leads': { id: 'crm.leads', kind: 'link', icon: 'UserPlus', labelKey: 'sidebar.items.crmLeads', href: '/crm/leads', premiumOnly: true },
  'crm.customers': { id: 'crm.customers', kind: 'link', icon: 'Users', labelKey: 'sidebar.items.crmCustomers', href: '/crm/customers' },

  hr: { id: 'hr', kind: 'module', icon: 'UserCog', labelKey: 'sidebar.modules.hr', moduleKey: 'hr' },
  'hr.overview': { id: 'hr.overview', kind: 'link', icon: 'LayoutDashboard', labelKey: 'sidebar.items.overview', href: '/hr', exact: true },
  'hr.employees': { id: 'hr.employees', kind: 'link', icon: 'Users', labelKey: 'sidebar.items.employees', href: '/hr/employees' },
  'hr.organization': { id: 'hr.organization', kind: 'subgroup', icon: 'Layers', labelKey: 'hr.hub.organization' },
  'hr.organization.departments': { id: 'hr.organization.departments', kind: 'link', icon: 'Layers', labelKey: 'sidebar.items.departments', href: '/hr/employees/departments' },
  'hr.organization.designations': { id: 'hr.organization.designations', kind: 'link', icon: 'BadgeCheck', labelKey: 'sidebar.items.designations', href: '/hr/employees/designations' },
  'hr.operations': { id: 'hr.operations', kind: 'subgroup', icon: 'Clock', labelKey: 'hr.hub.operations' },
  'hr.operations.attendance': { id: 'hr.operations.attendance', kind: 'link', icon: 'Clock', labelKey: 'sidebar.items.attendance', href: '/hr/attendance' },
  'hr.operations.leaves': { id: 'hr.operations.leaves', kind: 'link', icon: 'CalendarOff', labelKey: 'sidebar.items.leaves', href: '/hr/leaves' },
  'hr.operations.salary-payments': { id: 'hr.operations.salary-payments', kind: 'link', icon: 'Banknote', labelKey: 'sidebar.items.salaryPayments', href: '/hr/salary-payments' },

  'account-settings': { id: 'account-settings', kind: 'module', icon: 'Building2', labelKey: 'sidebar.modules.accountSettings', moduleKey: 'account-settings' },
  'account-settings.overview': { id: 'account-settings.overview', kind: 'link', icon: 'UserCog', labelKey: 'sidebar.items.myAccount', href: '/settings', exact: true },
  'account-settings.team': { id: 'account-settings.team', kind: 'link', icon: 'Users', labelKey: 'sidebar.items.teamPermissions', href: '/team', teamGated: true },
  'account-settings.audit-logs': { id: 'account-settings.audit-logs', kind: 'link', icon: 'ScrollText', labelKey: 'sidebar.items.auditLogs', href: '/settings/audit-logs', teamGated: true },
  'account-settings.localization': { id: 'account-settings.localization', kind: 'link', icon: 'Globe', labelKey: 'sidebar.items.localization', href: '/settings/localization' },
  'account-settings.branding': { id: 'account-settings.branding', kind: 'link', icon: 'Palette', labelKey: 'sidebar.items.branding', href: '/settings/branding' },
  'account-settings.tax': { id: 'account-settings.tax', kind: 'link', icon: 'Receipt', labelKey: 'sidebar.items.taxVat', href: '/settings/tax' },
  'account-settings.loyalty': { id: 'account-settings.loyalty', kind: 'link', icon: 'Gift', labelKey: 'sidebar.items.loyaltyProgram', href: '/settings/loyalty' },
  'account-settings.sms': { id: 'account-settings.sms', kind: 'link', icon: 'MessageSquare', labelKey: 'sidebar.items.smsNotifications', href: '/settings/sms' },
  'account-settings.report-emails': { id: 'account-settings.report-emails', kind: 'link', icon: 'BarChart3', labelKey: 'sidebar.items.reportEmails', href: '/settings/reports' },
  'account-settings.counters': { id: 'account-settings.counters', kind: 'link', icon: 'Monitor', labelKey: 'sidebar.items.posCounters', href: '/settings/counters' },
  'account-settings.sales': { id: 'account-settings.sales', kind: 'link', icon: 'ShoppingBag', labelKey: 'sidebar.items.salesSettings', href: '/settings/sales' },
  'account-settings.payment-methods': { id: 'account-settings.payment-methods', kind: 'link', icon: 'CreditCard', labelKey: 'sidebar.items.paymentMethods', href: '/settings/payment-methods' },
  'account-settings.discount-codes': { id: 'account-settings.discount-codes', kind: 'link', icon: 'Tag', labelKey: 'sidebar.items.discountCodes', href: '/settings/discount-codes' },
  'account-settings.data': { id: 'account-settings.data', kind: 'link', icon: 'Database', labelKey: 'sidebar.items.dataManagement', href: '/settings/data' },
  'account-settings.billing': { id: 'account-settings.billing', kind: 'link', icon: 'CreditCard', labelKey: 'sidebar.modules.billing', href: '/billing', billingGated: true },
  'account-settings.sms-credits': { id: 'account-settings.sms-credits', kind: 'link', icon: 'MessageSquare', labelKey: 'sidebar.items.smsCredits', href: '/sms-credits' },
  'account-settings.ai-credits': { id: 'account-settings.ai-credits', kind: 'link', icon: 'Sparkles', labelKey: 'sidebar.items.aiCredits', href: '/ai-credits' },

  support: { id: 'support', kind: 'module', icon: 'MessageSquare', labelKey: 'sidebar.items.support', href: '/support', moduleKey: 'support', platformFeature: 'support' },
  admin: { id: 'admin', kind: 'module', icon: 'ShieldCheck', labelKey: 'sidebar.modules.admin', moduleKey: 'admin' },
  'admin.overview': { id: 'admin.overview', kind: 'link', icon: 'LayoutDashboard', labelKey: 'sidebar.items.overview', href: '/admin' },
  'admin.tenant-management': { id: 'admin.tenant-management', kind: 'subgroup', icon: 'Crown', labelKey: 'sidebar.sections.tenantManagement' },
  'admin.tenant-management.tenants': { id: 'admin.tenant-management.tenants', kind: 'link', icon: 'Building2', labelKey: 'sidebar.items.tenants', href: '/admin/tenants' },
  'admin.tenant-management.ledger': { id: 'admin.tenant-management.ledger', kind: 'link', icon: 'BookOpen', labelKey: 'sidebar.items.tenantLedger', href: '/admin/tenants/ledger' },
  'admin.users': { id: 'admin.users', kind: 'link', icon: 'Users', labelKey: 'sidebar.items.users', href: '/admin/users' },
  'admin.referrals': { id: 'admin.referrals', kind: 'link', icon: 'Gift', labelKey: 'sidebar.items.referrals', href: '/admin/referrals' },
  'admin.feedback': { id: 'admin.feedback', kind: 'link', icon: 'MessageSquare', labelKey: 'sidebar.items.feedback', href: '/admin/feedback' },
  'admin.support': { id: 'admin.support', kind: 'link', icon: 'MessageSquare', labelKey: 'sidebar.items.adminSupport', href: '/admin/support' },
  'admin.system-health': { id: 'admin.system-health', kind: 'link', icon: 'Activity', labelKey: 'sidebar.items.systemHealth', href: '/admin/system-health' },
  'admin.status': { id: 'admin.status', kind: 'link', icon: 'Globe', labelKey: 'sidebar.items.platformStatus', href: '/status' },
  'admin.platform-settings': { id: 'admin.platform-settings', kind: 'subgroup', icon: 'Settings', labelKey: 'sidebar.sections.platformSettings' },
  'admin.platform-settings.sms': { id: 'admin.platform-settings.sms', kind: 'link', icon: 'MessageSquare', labelKey: 'sidebar.items.platformSettingsSms', href: '/admin/platform-settings/sms' },
  'admin.platform-settings.email': { id: 'admin.platform-settings.email', kind: 'link', icon: 'Mail', labelKey: 'sidebar.items.platformSettingsEmail', href: '/admin/platform-settings/email' },
  'admin.platform-settings.whatsapp': { id: 'admin.platform-settings.whatsapp', kind: 'link', icon: 'MessageCircle', labelKey: 'sidebar.items.platformSettingsWhatsapp', href: '/admin/platform-settings/whatsapp' },
  'admin.platform-settings.payments': { id: 'admin.platform-settings.payments', kind: 'link', icon: 'CreditCard', labelKey: 'sidebar.items.platformSettingsPayments', href: '/admin/platform-settings/payments' },
  'admin.platform-settings.general': { id: 'admin.platform-settings.general', kind: 'link', icon: 'Settings', labelKey: 'sidebar.items.platformSettingsGeneral', href: '/admin/platform-settings/general' },
  'admin.platform-settings.tenant-features': { id: 'admin.platform-settings.tenant-features', kind: 'link', icon: 'ToggleLeft', labelKey: 'sidebar.items.platformSettingsTenantFeatures', href: '/admin/platform-settings/tenant-features' },
  'admin.platform-settings.ai': { id: 'admin.platform-settings.ai', kind: 'link', icon: 'Sparkles', labelKey: 'sidebar.items.platformSettingsAi', href: '/admin/platform-settings/ai' },
  'admin.platform-settings.navigation': { id: 'admin.platform-settings.navigation', kind: 'link', icon: 'LayoutList', labelKey: 'sidebar.items.platformSettingsNavigation', href: '/admin/platform-settings/navigation' },
  'admin.platform-settings.plans': { id: 'admin.platform-settings.plans', kind: 'link', icon: 'BadgePercent', labelKey: 'sidebar.items.platformSettingsPlans', href: '/admin/platform-settings/plans' },

  help: { id: 'help', kind: 'module', icon: 'HelpCircle', labelKey: 'sidebar.modules.help', href: '/help', moduleKey: 'help', platformFeature: 'help' },
};

function layoutNode(id: string, parentId: string | null, sortOrder: number, visible = true): NavLayoutNode {
  return { id, parentId, sortOrder, visible };
}

/** Default tenant sidebar tree — mirrors the original hardcoded Sidebar structure. */
export const DEFAULT_TENANT_NAV_LAYOUT: NavLayoutNode[] = [
  layoutNode('dashboard', null, 0),
  layoutNode('sales', null, 1),
  layoutNode('sales.overview', 'sales', 0),
  layoutNode('sales.list', 'sales', 1),
  layoutNode('sales.order-flow.returns', 'sales', 2),
  layoutNode('sales.receivables.customer-payments', 'sales', 3),
  layoutNode('sales.pos', 'sales', 4),
  layoutNode('sales.new', 'sales', 5),
  layoutNode('sales.order-flow', 'sales', 6),
  layoutNode('sales.order-flow.quotes', 'sales.order-flow', 0),
  layoutNode('sales.order-flow.orders', 'sales.order-flow', 1),
  layoutNode('sales.order-flow.delivery', 'sales.order-flow', 2),
  layoutNode('sales.order-flow.warranty-claims', 'sales.order-flow', 3),
  layoutNode('sales.reports', 'sales', 7),
  layoutNode('sales.reports.summary', 'sales.reports', 0),
  layoutNode('sales.reports.products', 'sales.reports', 1),
  layoutNode('sales.reports.consolidated', 'sales.reports', 2),
  layoutNode('sales.reports.branch-report', 'sales.reports', 3),
  layoutNode('sales.receivables.customer-ledger', 'sales.reports', 4),
  layoutNode('sales.receivables.due-aging', 'sales.reports', 5),
  layoutNode('sales.customers.loyalty', 'sales.reports', 6),
  layoutNode('sales.setup', 'sales', 8),
  layoutNode('sales.setup.customer-groups', 'sales.setup', 0),
  layoutNode('sales.setup.price-lists', 'sales.setup', 1),
  layoutNode('sales.setup.territories', 'sales.setup', 2),
  layoutNode('sales.customers.list', 'sales.setup', 3),
  layoutNode('sales.cashier-sessions', 'sales.setup', 4),
  layoutNode('sales.storefront.settings', 'sales.setup', 5),
  layoutNode('sales.setup.settings', 'sales.setup', 6),

  layoutNode('purchase', null, 2),
  layoutNode('purchase.overview', 'purchase', 0),
  layoutNode('purchase.list', 'purchase', 1),
  layoutNode('purchase.payables', 'purchase', 2),
  layoutNode('purchase.payables.supplier-payments', 'purchase.payables', 0),
  layoutNode('purchase.payables.supplier-ledger', 'purchase.payables', 1),
  layoutNode('purchase.order-flow', 'purchase', 3),
  layoutNode('purchase.order-flow.orders', 'purchase.order-flow', 0),
  layoutNode('purchase.order-flow.quotations', 'purchase.order-flow', 1),
  layoutNode('purchase.order-flow.returns', 'purchase.order-flow', 2),
  layoutNode('purchase.reports', 'purchase', 4),
  layoutNode('purchase.reports.summary', 'purchase.reports', 0),
  layoutNode('purchase.reports.by-product', 'purchase.reports', 1),
  layoutNode('purchase.reports.by-supplier', 'purchase.reports', 2),
  layoutNode('purchase.setup', 'purchase', 5),
  layoutNode('purchase.setup.suppliers', 'purchase.setup', 0),

  layoutNode('accounting', null, 3),
  layoutNode('accounting.overview', 'accounting', 0),
  layoutNode('accounting.vouchers', 'accounting', 1),
  layoutNode('accounting.vouchers-list', 'accounting', 2),
  layoutNode('accounting.journal', 'accounting', 3),
  layoutNode('accounting.ledger', 'accounting', 4),
  layoutNode('accounting.transactions', 'accounting', 5),
  layoutNode('accounting.transactions.expenses', 'accounting.transactions', 0),
  layoutNode('accounting.transactions.expense-categories', 'accounting.transactions', 1),
  layoutNode('accounting.transactions.expense-reports', 'accounting.transactions', 2),
  layoutNode('accounting.transactions.loans', 'accounting.transactions', 3),
  layoutNode('accounting.reconciliation', 'accounting', 6),
  layoutNode('accounting.reconciliation.posting-exceptions', 'accounting.reconciliation', 0),
  layoutNode('accounting.reconciliation.bank', 'accounting.reconciliation', 1),
  layoutNode('accounting.reports', 'accounting', 7),
  layoutNode('accounting.reports.pl', 'accounting.reports', 0),
  layoutNode('accounting.reports.balance-sheet', 'accounting.reports', 1),
  layoutNode('accounting.reports.cashbook', 'accounting.reports', 2),
  layoutNode('accounting.reports.bankbook', 'accounting.reports', 3),
  layoutNode('accounting.reports.trial-balance', 'accounting.reports', 4),
  layoutNode('accounting.reports.comparative-pl', 'accounting.reports', 5),
  layoutNode('accounting.reports.ar-aging', 'accounting.reports', 6),
  layoutNode('accounting.reports.ap-aging', 'accounting.reports', 7),
  layoutNode('accounting.reports.vat-tax', 'accounting.reports', 8),
  layoutNode('accounting.reports.budget-vs-actual', 'accounting.reports', 9),
  layoutNode('accounting.reports.cash-flow', 'accounting.reports', 10),
  layoutNode('accounting.reports.financial-ratios', 'accounting.reports', 11),
  layoutNode('accounting.setup', 'accounting', 8),
  layoutNode('accounting.setup.coa', 'accounting.setup', 0),
  layoutNode('accounting.setup.posting-rules', 'accounting.setup', 1),
  layoutNode('accounting.setup.fiscal-periods', 'accounting.setup', 2),
  layoutNode('accounting.setup.opening-balances', 'accounting.setup', 3),
  layoutNode('accounting.setup.cost-centers', 'accounting.setup', 4),
  layoutNode('accounting.setup.fixed-assets', 'accounting.setup', 5),
  layoutNode('accounting.setup.recurring-journals', 'accounting.setup', 6),
  layoutNode('accounting.setup.recurring-vouchers', 'accounting.setup', 7),
  layoutNode('accounting.setup.voucher-templates', 'accounting.setup', 8),

  layoutNode('inventory', null, 4),
  layoutNode('inventory.overview', 'inventory', 0),
  layoutNode('inventory.products', 'inventory', 1),
  layoutNode('inventory.transfers', 'inventory', 2),
  layoutNode('inventory.stock-takes', 'inventory', 3),
  layoutNode('inventory.shrinkage', 'inventory', 4),
  layoutNode('inventory.labels', 'inventory', 5),
  layoutNode('inventory.reports', 'inventory', 6),
  layoutNode('inventory.reports.ledger', 'inventory.reports', 0),
  layoutNode('inventory.reports.reorder', 'inventory.reports', 1),
  layoutNode('inventory.reports.shrinkage', 'inventory.reports', 2),
  layoutNode('inventory.reports.valuation', 'inventory.reports', 3),
  layoutNode('inventory.setup', 'inventory', 7),
  layoutNode('inventory.setup.brands', 'inventory.setup', 0),
  layoutNode('inventory.setup.categories', 'inventory.setup', 1),
  layoutNode('inventory.setup.settings', 'inventory.setup', 2),

  layoutNode('crm', null, 5),
  layoutNode('crm.overview', 'crm', 0),
  layoutNode('crm.leads', 'crm', 1),
  layoutNode('crm.customers', 'crm', 2),

  layoutNode('manufacturing', null, 6),

  layoutNode('hr', null, 7),
  layoutNode('hr.overview', 'hr', 0),
  layoutNode('hr.employees', 'hr', 1),
  layoutNode('hr.organization', 'hr', 2),
  layoutNode('hr.organization.departments', 'hr.organization', 0),
  layoutNode('hr.organization.designations', 'hr.organization', 1),
  layoutNode('hr.operations', 'hr', 3),
  layoutNode('hr.operations.attendance', 'hr.operations', 0),
  layoutNode('hr.operations.leaves', 'hr.operations', 1),
  layoutNode('hr.operations.salary-payments', 'hr.operations', 2),

  layoutNode('account-settings', null, 8),
  layoutNode('account-settings.overview', 'account-settings', 0),
  layoutNode('account-settings.team', 'account-settings', 1),
  layoutNode('account-settings.audit-logs', 'account-settings', 2),
  layoutNode('account-settings.localization', 'account-settings', 3),
  layoutNode('account-settings.branding', 'account-settings', 4),
  layoutNode('account-settings.tax', 'account-settings', 5),
  layoutNode('account-settings.loyalty', 'account-settings', 6),
  layoutNode('account-settings.sms', 'account-settings', 7),
  layoutNode('account-settings.report-emails', 'account-settings', 8),
  layoutNode('account-settings.counters', 'account-settings', 9),
  layoutNode('account-settings.sales', 'account-settings', 10),
  layoutNode('account-settings.payment-methods', 'account-settings', 11),
  layoutNode('account-settings.discount-codes', 'account-settings', 12),
  layoutNode('account-settings.data', 'account-settings', 13),
  layoutNode('account-settings.billing', 'account-settings', 14),
  layoutNode('account-settings.sms-credits', 'account-settings', 15),
  layoutNode('account-settings.ai-credits', 'account-settings', 16),

  layoutNode('support', null, 9),
  layoutNode('admin', null, 10),
  layoutNode('admin.overview', 'admin', 0),
  layoutNode('admin.tenant-management', 'admin', 1),
  layoutNode('admin.tenant-management.tenants', 'admin.tenant-management', 0),
  layoutNode('admin.tenant-management.ledger', 'admin.tenant-management', 1),
  layoutNode('admin.users', 'admin', 2),
  layoutNode('admin.feedback', 'admin', 3),
  layoutNode('admin.support', 'admin', 4),
  layoutNode('help', null, 11),
];

/** Platform-admin console sidebar (admin module only). */
export const DEFAULT_PLATFORM_ADMIN_NAV_LAYOUT: NavLayoutNode[] = [
  layoutNode('admin', null, 0),
  layoutNode('admin.overview', 'admin', 0),
  layoutNode('admin.tenant-management', 'admin', 1),
  layoutNode('admin.tenant-management.tenants', 'admin.tenant-management', 0),
  layoutNode('admin.tenant-management.ledger', 'admin.tenant-management', 1),
  layoutNode('admin.users', 'admin', 2),
  layoutNode('admin.referrals', 'admin', 3),
  layoutNode('admin.feedback', 'admin', 4),
  layoutNode('admin.support', 'admin', 5),
  layoutNode('admin.system-health', 'admin', 6),
  layoutNode('admin.status', 'admin', 7),
  layoutNode('admin.platform-settings', 'admin', 8),
  layoutNode('admin.platform-settings.sms', 'admin.platform-settings', 0),
  layoutNode('admin.platform-settings.email', 'admin.platform-settings', 1),
  layoutNode('admin.platform-settings.whatsapp', 'admin.platform-settings', 2),
  layoutNode('admin.platform-settings.payments', 'admin.platform-settings', 3),
  layoutNode('admin.platform-settings.general', 'admin.platform-settings', 4),
  layoutNode('admin.platform-settings.tenant-features', 'admin.platform-settings', 5),
  layoutNode('admin.platform-settings.ai', 'admin.platform-settings', 6),
  layoutNode('admin.platform-settings.navigation', 'admin.platform-settings', 7),
  layoutNode('admin.platform-settings.plans', 'admin.platform-settings', 8),
  layoutNode('help', null, 1),
];

export function getDefaultNavLayout(scope: NavScope): NavLayoutNode[] {
  return scope === NavScope.PLATFORM_ADMIN
    ? DEFAULT_PLATFORM_ADMIN_NAV_LAYOUT.map((node) => ({ ...node }))
    : DEFAULT_TENANT_NAV_LAYOUT.map((node) => ({ ...node }));
}

const CONTAINER_KINDS = new Set<NavNodeKind>([NavNodeKind.MODULE, NavNodeKind.SUBGROUP]);

export function validateNavLayout(
  layout: NavLayoutNode[],
  registry: Record<string, NavRegistryEntry> = NAV_REGISTRY,
): { valid: true } | { valid: false; errors: string[] } {
  const errors: string[] = [];
  const ids = new Set<string>();

  for (const node of layout) {
    if (ids.has(node.id)) {
      errors.push(`Duplicate layout node id "${node.id}"`);
      continue;
    }
    ids.add(node.id);

    const entry = registry[node.id];
    if (!entry) {
      errors.push(`Unknown nav id "${node.id}"`);
    }
  }

  for (const node of layout) {
    if (node.parentId === null) continue;
    if (!ids.has(node.parentId)) {
      errors.push(`Node "${node.id}" references missing parent "${node.parentId}"`);
      continue;
    }
    const parent = registry[node.parentId];
    if (!parent || !CONTAINER_KINDS.has(parent.kind)) {
      errors.push(`Parent "${node.parentId}" of "${node.id}" is not a module or subgroup`);
    }
  }

  for (const node of layout) {
    const entry = registry[node.id];
    if (!entry) continue;
    if (node.parentId === null && entry.kind === NavNodeKind.LINK) {
      errors.push(`Link "${node.id}" cannot be a root node`);
    }
    if (node.parentId === null && entry.kind === NavNodeKind.SUBGROUP) {
      errors.push(`Subgroup "${node.id}" cannot be a root node`);
    }
  }

  const childrenByParent = new Map<string | null, string[]>();
  for (const node of layout) {
    const list = childrenByParent.get(node.parentId) ?? [];
    list.push(node.id);
    childrenByParent.set(node.parentId, list);
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();

  function visit(id: string) {
    if (visited.has(id)) return;
    if (visiting.has(id)) {
      errors.push(`Cycle detected involving "${id}"`);
      return;
    }
    visiting.add(id);
    for (const childId of childrenByParent.get(id) ?? []) {
      visit(childId);
    }
    visiting.delete(id);
    visited.add(id);
  }

  for (const node of layout) {
    if (node.parentId === null) visit(node.id);
  }

  return errors.length === 0 ? { valid: true } : { valid: false, errors };
}

export function parseNavLayoutJson(raw: string | null | undefined, scope: NavScope): NavLayoutNode[] {
  if (!raw?.trim()) return getDefaultNavLayout(scope);
  try {
    const parsed = navLayoutSchema.parse(JSON.parse(raw)) as NavLayoutNode[];
    const result = validateNavLayout(parsed);
    if (!result.valid) return getDefaultNavLayout(scope);
    return parsed;
  } catch {
    return getDefaultNavLayout(scope);
  }
}

export const NAV_LAYOUT_SETTING_KEYS: Record<NavScope, string> = {
  [NavScope.TENANT]: 'tenant_layout',
  [NavScope.PLATFORM_ADMIN]: 'platform_admin_layout',
};