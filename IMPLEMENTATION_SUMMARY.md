# Accounting Menu Restructuring - Implementation Summary

## Approved Changes

Based on tenant feedback, the following navigation changes were approved:

### 1. Create new "Expenses" subgroup under Accounting module
- Move Expenses, Expense Categories, and Expense Reports under a new dedicated "Expenses" subgroup
- Remove these items from the "Transactions & Funds" group

### 2. Move "Loans" directly under Accounting
- Move Loans from under "Transactions & Funds" to be a direct link under the Accounting module

### 3. Remove "Transactions & Funds" group
- After moving Expenses and Loans out, the group becomes empty and should be removed

## Files to Modify

### 1. `packages/shared-types/navigation.ts`

#### Registry Entries to Add:
```typescript
'accounting.expenses': { id: 'accounting.expenses', kind: 'subgroup', icon: 'FolderOpen', labelKey: 'accounting.hub.expenses' },
'accounting.expenses.entries': { id: 'accounting.expenses.entries', kind: 'link', icon: 'Receipt', labelKey: 'accounting.links.expenses.title', href: '/accounting/expenses' },
'accounting.expenses.categories': { id: 'accounting.expenses.categories', kind: 'link', icon: 'FolderTree', labelKey: 'accounting.links.expenseCategories.title', href: '/accounting/expenses/categories' },
'accounting.expenses.reports': { id: 'accounting.expenses.reports', kind: 'link', icon: 'BarChart3', labelKey: 'accounting.links.expenseReports.title', href: '/accounting/expenses/reports' },
'accounting.loans': { id: 'accounting.loans', kind: 'link', icon: 'HandCoins', labelKey: 'accounting.links.loans.title', href: '/accounting/loans' },
```

#### Registry Entries to Remove (or keep for backward compat):
- `'accounting.transactions'` (the subgroup)
- `'accounting.transactions.expenses'`
- `'accounting.transactions.expense-categories'`
- `'accounting.transactions.expense-reports'`
- `'accounting.transactions.loans'`

#### DEFAULT_TENANT_NAV_LAYOUT Changes (Accounting section):

**Replace these lines:**
```typescript
layoutNode('accounting.transactions', 'accounting', 5),
layoutNode('accounting.transactions.expenses', 'accounting.transactions', 0),
layoutNode('accounting.transactions.expense-categories', 'accounting.transactions', 1),
layoutNode('accounting.transactions.expense-reports', 'accounting.transactions', 2),
layoutNode('accounting.transactions.loans', 'accounting.transactions', 3),
layoutNode('accounting.reconciliation', 'accounting', 6),
layoutNode('accounting.reports', 'accounting', 7),
layoutNode('accounting.setup', 'accounting', 8),
```

**With:**
```typescript
layoutNode('accounting.expenses', 'accounting', 5),
layoutNode('accounting.expenses.entries', 'accounting.expenses', 0),
layoutNode('accounting.expenses.categories', 'accounting.expenses', 1),
layoutNode('accounting.expenses.reports', 'accounting.expenses', 2),
layoutNode('accounting.loans', 'accounting', 6),
layoutNode('accounting.reconciliation', 'accounting', 7),
layoutNode('accounting.reports', 'accounting', 8),
layoutNode('accounting.setup', 'accounting', 9),
```

### 2. `apps/frontend/src/lib/localization/messages/en/accounting.ts`

Add new hub label in the `accounting.hub` section:
```typescript
hub: {
    dailyOperations: 'Daily Operations',
    expenses: 'Expenses',
    reconciliation: 'Reconciliation',
    interBranch: 'Inter-branch',
},
```

Note: The `transactions: 'Transactions & Funds'` entry can be kept for potential backward compatibility or removed if not used elsewhere.

### 3. `apps/frontend/src/lib/localization/messages/bn/accounting.ts`

Add Bengali translation for the new hub label:
```typescript
hub: {
    dailyOperations: "দৈনিক কার্যক্রম",
    expenses: "ব্যয়",
    reconciliation: "রিকনসিলিয়েশন",
    interBranch: "আন্তঃ-শাখা",
},
```

## Navigation Tree Structure (After Implementation)

```
Accounting (module)
├── Overview
├── Vouchers (New entry)
├── Vouchers List
├── Journal
├── Ledger
├── Expenses (NEW SUBGROUP)
│   ├── Expenses (entries)
│   ├── Expense Categories
│   └── Expense Reports
├── Loans (MOVED - now direct link)
├── Reconciliation
│   ├── Posting Exceptions
│   └── Bank Reconciliation
├── Reports
│   ├── Profit & Loss
│   ├── Balance Sheet
│   ├── Cashbook
│   ├── Bankbook
│   ├── Trial Balance
│   ├── Comparative P&L
│   ├── AR Aging
│   ├── AP Aging
│   ├── VAT / Tax Report
│   ├── Budget vs. Actual
│   ├── Cash Flow
│   └── Financial Ratios
└── Setup
    ├── Chart of Accounts
    ├── Posting Rules
    ├── Fiscal Periods
    ├── Opening Balances
    ├── Cost Centers
    ├── Fixed Assets
    ├── Recurring Journals
    ├── Recurring Vouchers
    └── Voucher Templates
```

## Testing Checklist

- [ ] Verify "Expenses" subgroup appears in Accounting menu
- [ ] Verify Expenses, Expense Categories, and Expense Reports appear under Expenses subgroup
- [ ] Verify "Loans" appears as a direct link under Accounting (not under any subgroup)
- [ ] Verify "Transactions & Funds" subgroup is no longer visible
- [ ] Verify menu ordering is correct (Expenses before Reconciliation, Loans before Reconciliation)
- [ ] Test in both English and Bengali locales
- [ ] Verify no broken links or routing issues
- [ ] Verify navigation permission checks still work correctly

## Notes

- No backend code changes required
- No data migrations required
- This is purely a navigation/UI restructuring
- The href values for the links remain unchanged
- All existing functionality is preserved, only the menu structure changes
- The localization keys already exist in the system (accounting.links.expenses.title, etc.)

