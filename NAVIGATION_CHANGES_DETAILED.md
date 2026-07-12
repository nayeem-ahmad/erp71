# Detailed Navigation Changes for Accounting Menu Restructuring

## Change 1: Add New Registry Entries (NAV_REGISTRY)

In `packages/shared-types/navigation.ts`, within the `NAV_REGISTRY` object, after the existing accounting entries, add these new lines (after `'accounting.transactions.loans'`):

```typescript
  'accounting.expenses': { id: 'accounting.expenses', kind: 'subgroup', icon: 'FolderOpen', labelKey: 'accounting.hub.expenses' },
  'accounting.expenses.entries': { id: 'accounting.expenses.entries', kind: 'link', icon: 'Receipt', labelKey: 'accounting.links.expenses.title', href: '/accounting/expenses' },
  'accounting.expenses.categories': { id: 'accounting.expenses.categories', kind: 'link', icon: 'FolderTree', labelKey: 'accounting.links.expenseCategories.title', href: '/accounting/expenses/categories' },
  'accounting.expenses.reports': { id: 'accounting.expenses.reports', kind: 'link', icon: 'BarChart3', labelKey: 'accounting.links.expenseReports.title', href: '/accounting/expenses/reports' },
  'accounting.loans': { id: 'accounting.loans', kind: 'link', icon: 'HandCoins', labelKey: 'accounting.links.loans.title', href: '/accounting/loans' },
```

## Change 2: Update DEFAULT_TENANT_NAV_LAYOUT

In `packages/shared-types/navigation.ts`, find the accounting section in `DEFAULT_TENANT_NAV_LAYOUT` array (around line 220-244).

### Find and Replace:

**Find this block:**
```typescript
  layoutNode('accounting.transactions', 'accounting', 5),
  layoutNode('accounting.transactions.expenses', 'accounting.transactions', 0),
  layoutNode('accounting.transactions.expense-categories', 'accounting.transactions', 1),
  layoutNode('accounting.transactions.expense-reports', 'accounting.transactions', 2),
  layoutNode('accounting.transactions.loans', 'accounting.transactions', 3),
  layoutNode('accounting.reconciliation', 'accounting', 6),
  layoutNode('accounting.reconciliation.posting-exceptions', 'accounting.reconciliation', 0),
  layoutNode('accounting.reconciliation.bank', 'accounting.reconciliation', 1),
  layoutNode('accounting.reports', 'accounting', 7),
```

**Replace with:**
```typescript
  layoutNode('accounting.expenses', 'accounting', 5),
  layoutNode('accounting.expenses.entries', 'accounting.expenses', 0),
  layoutNode('accounting.expenses.categories', 'accounting.expenses', 1),
  layoutNode('accounting.expenses.reports', 'accounting.expenses', 2),
  layoutNode('accounting.loans', 'accounting', 6),
  layoutNode('accounting.reconciliation', 'accounting', 7),
  layoutNode('accounting.reconciliation.posting-exceptions', 'accounting.reconciliation', 0),
  layoutNode('accounting.reconciliation.bank', 'accounting.reconciliation', 1),
  layoutNode('accounting.reports', 'accounting', 8),
```

**Also update subsequent sortOrders:**
```typescript
  // Change 'accounting.setup' sortOrder from 8 to 9:
  layoutNode('accounting.setup', 'accounting', 9),
```

## Change 3: Add Localization Label (English)

In `apps/frontend/src/lib/localization/messages/en/accounting.ts`, find the `hub` object within `accounting` and add:

**Find this:**
```typescript
        hub: {
            dailyOperations: 'Daily Operations',
            transactions: 'Transactions & Funds',
            reconciliation: 'Reconciliation',
            interBranch: 'Inter-branch',
        },
```

**Replace with:**
```typescript
        hub: {
            dailyOperations: 'Daily Operations',
            expenses: 'Expenses',
            reconciliation: 'Reconciliation',
            interBranch: 'Inter-branch',
        },
```

Note: You can optionally remove or keep the `transactions` key depending on whether it's used elsewhere in the codebase.

## Change 4: Add Localization Label (Bengali)

In `apps/frontend/src/lib/localization/messages/bn/accounting.ts`, find the `hub` object within `accounting` and add:

**Find this:**
```typescript
        hub: {
            dailyOperations: "দৈনিক কার্যক্রম",
            transactions: "লেনদেন ও তহবিল",
            reconciliation: "রিকনসিলিয়েশন",
            interBranch: "আন্তঃ-শাখা",
        },
```

**Replace with:**
```typescript
        hub: {
            dailyOperations: "দৈনিক কার্যক্রম",
            expenses: "ব্যয়",
            reconciliation: "রিকনসিলিয়েশন",
            interBranch: "আন্তঃ-শাখা",
        },
```

## Optional: Remove Old Registry Entries (Backward Compatibility)

After confirming the new structure works, you can remove the old entries from NAV_REGISTRY:

```typescript
// REMOVE THESE:
  'accounting.transactions': { id: 'accounting.transactions', kind: 'subgroup', icon: 'Wallet', labelKey: 'accounting.hub.transactions' },
  'accounting.transactions.expenses': { id: 'accounting.transactions.expenses', kind: 'link', icon: 'Receipt', labelKey: 'accounting.links.expenses.title', href: '/accounting/expenses' },
  'accounting.transactions.expense-categories': { id: 'accounting.transactions.expense-categories', kind: 'link', icon: 'FolderTree', labelKey: 'accounting.links.expenseCategories.title', href: '/accounting/expenses/categories' },
  'accounting.transactions.expense-reports': { id: 'accounting.transactions.expense-reports', kind: 'link', icon: 'BarChart3', labelKey: 'accounting.links.expenseReports.title', href: '/accounting/expenses/reports' },
  'accounting.transactions.loans': { id: 'accounting.transactions.loans', kind: 'link', icon: 'HandCoins', labelKey: 'accounting.links.loans.title', href: '/accounting/loans' },
```

## Verification

After making these changes, run:
- `npm run lint` or equivalent to verify no syntax errors
- `npm run build` to ensure compilation succeeds
- Test in both English and Bengali locales
- Verify the menu structure in the UI matches the expected result

## Summary of Changes by File

| File | Change | Type |
|------|--------|------|
| `packages/shared-types/navigation.ts` | Add 5 new NAV_REGISTRY entries for Expenses subgroup and Loans link | Addition |
| `packages/shared-types/navigation.ts` | Replace Transactions & Funds layout nodes with new Expenses subgroup and Loans link | Modification |
| `apps/frontend/src/lib/localization/messages/en/accounting.ts` | Replace `transactions` hub label with `expenses` | Modification |
| `apps/frontend/src/lib/localization/messages/bn/accounting.ts` | Replace `transactions` hub label (Bengali) with `expenses` | Modification |

