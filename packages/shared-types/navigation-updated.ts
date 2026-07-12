// This is a temporary file showing the key navigation registry changes

// ADD these new entries to NAV_REGISTRY:
/*
  'accounting.expenses': { id: 'accounting.expenses', kind: 'subgroup', icon: 'FolderOpen', labelKey: 'accounting.hub.expenses' },
  'accounting.expenses.entries': { id: 'accounting.expenses.entries', kind: 'link', icon: 'Receipt', labelKey: 'accounting.links.expenses.title', href: '/accounting/expenses' },
  'accounting.expenses.categories': { id: 'accounting.expenses.categories', kind: 'link', icon: 'FolderTree', labelKey: 'accounting.links.expenseCategories.title', href: '/accounting/expenses/categories' },
  'accounting.expenses.reports': { id: 'accounting.expenses.reports', kind: 'link', icon: 'BarChart3', labelKey: 'accounting.links.expenseReports.title', href: '/accounting/expenses/reports' },
  'accounting.loans': { id: 'accounting.loans', kind: 'link', icon: 'HandCoins', labelKey: 'accounting.links.loans.title', href: '/accounting/loans' },
*/

// DELETE these from NAV_REGISTRY (or keep for backward compat):
/*
  'accounting.transactions': (delete this subgroup)
  'accounting.transactions.expenses': (delete)
  'accounting.transactions.expense-categories': (delete)
  'accounting.transactions.expense-reports': (delete)
  'accounting.transactions.loans': (delete)
*/

// UPDATE DEFAULT_TENANT_NAV_LAYOUT
// CHANGE these lines in the accounting section:
/*
OLD:
  layoutNode('accounting.transactions', 'accounting', 5),
  layoutNode('accounting.transactions.expenses', 'accounting.transactions', 0),
  layoutNode('accounting.transactions.expense-categories', 'accounting.transactions', 1),
  layoutNode('accounting.transactions.expense-reports', 'accounting.transactions', 2),
  layoutNode('accounting.transactions.loans', 'accounting.transactions', 3),
  layoutNode('accounting.reconciliation', 'accounting', 6),

NEW:
  layoutNode('accounting.expenses', 'accounting', 5),
  layoutNode('accounting.expenses.entries', 'accounting.expenses', 0),
  layoutNode('accounting.expenses.categories', 'accounting.expenses', 1),
  layoutNode('accounting.expenses.reports', 'accounting.expenses', 2),
  layoutNode('accounting.loans', 'accounting', 6),
  layoutNode('accounting.reconciliation', 'accounting', 7),

ALSO UPDATE subsequent sortOrders:
  layoutNode('accounting.reports', 'accounting', 8),
  layoutNode('accounting.setup', 'accounting', 9),
*/
