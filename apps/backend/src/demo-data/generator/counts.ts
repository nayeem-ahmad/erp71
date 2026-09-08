/**
 * The tally a demo-data batch reports back.
 *
 * Kept as a flat key list rather than a hand-written interface so adding a
 * module means adding one name here — the empty initialiser, the type and the
 * frontend's grouping all derive from it, and none of them can drift apart.
 */

export const DEMO_COUNT_KEYS = [
    // Core trade — always generated.
    'products', 'customers', 'suppliers', 'purchases', 'sales', 'creditSales',
    'customerPayments', 'supplierPayments', 'expenses', 'salesReturns',
    'purchaseReturns', 'transfers', 'shrinkages', 'stockTakes', 'cashierSessions',

    // Sales pipeline.
    'quotations', 'salesOrders', 'orderDeposits', 'deliveryOrders',
    'storefrontOrders', 'warrantyClaims', 'loyaltyTransactions',

    // Purchasing pipeline.
    'purchaseQuotations', 'purchaseOrders', 'productDemands',

    // CRM.
    'customerGroups', 'territories', 'priceLists', 'discountCodes', 'leads',
    'leadConversations', 'crmContacts', 'customerInteractions', 'crmActivities',
    'crmFollowUps', 'crmCampaigns',

    // HR.
    'departments', 'designations', 'employees', 'holidays', 'workSchedules',
    'attendanceRecords', 'leaveRequests', 'payrollRuns', 'salaryAccruals',
    'salaryPayments', 'expenseClaims',

    // Finance.
    'costCenters', 'budgets', 'fixedAssets', 'depreciationEntries', 'loans',
    'loanPayments', 'investors', 'investorTransactions', 'fundTransfers',
    'cashTransactions',

    // Operations.
    'bomRecipes', 'productionJobs', 'projects', 'projectTasks', 'notifications',
    'supportThreads',

    // How many deliberate oddities were planted (details on the batch itself).
    'anomalies',
] as const;

export type DemoCountKey = (typeof DEMO_COUNT_KEYS)[number];

export type DemoCounts = Record<DemoCountKey, number>;

export function emptyCounts(): DemoCounts {
    const counts = {} as DemoCounts;
    for (const key of DEMO_COUNT_KEYS) counts[key] = 0;
    return counts;
}
